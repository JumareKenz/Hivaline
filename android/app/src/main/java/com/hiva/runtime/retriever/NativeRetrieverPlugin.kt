package com.hiva.runtime.retriever

import android.content.Context
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hiva.runtime.BuildConfig
import io.objectbox.Box
import io.objectbox.BoxStore
import io.objectbox.annotation.Entity
import io.objectbox.annotation.HnswIndex
import io.objectbox.annotation.Id
import io.objectbox.kotlin.boxFor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipFile
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import kotlin.math.sqrt

@Entity
data class ClinicalChunk(
    @Id var dbId: Long = 0,
    var chunkId: String = "",
    var rawText: String = "",
    var displayTitle: String = "",
    var chunkType: String = "",
    @HnswIndex(
        dimensions = 384,
        neighborsPerNode = 16,
        indexingSearchCount = 200,
    )
    var embedding: FloatArray? = null,
)

/**
 * NativeRetriever — ObjectBox + E5-small-v2 HNSW retrieval plugin.
 *
 * Architecture:
 *   - Document vectors: pre-computed by compiler (E5-small-v2, 384-dim,
 *     L2-normalized), loaded from index/embeddings.bin.
 *   - Query vectors: computed on-device at search time using E5-small-v2
 *     ONNX with BERT WordPiece tokenizer and "query: " prefix.
 *   - Search: ObjectBox HNSW nearest-neighbor on L2-normalized 384-dim vectors.
 *
 * Capacitor methods:
 *   loadBundle(path)     -> { success, chunkCount, embeddingDims }
 *   search(query, topK)  -> { results: [{chunkId, rawText, displayTitle, chunkType, score}] }
 *   isReady()            -> { ready }
 *   unload()             -> { success }
 */
@CapacitorPlugin(name = "NativeRetriever")
class NativeRetrieverPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeRetriever"
        private const val EMBEDDING_MODEL_DIR = "models/e5-small-v2"
        private const val FUSED_MODEL_FILE = "e5_small_v2_fused.onnx"
        private const val OBJECTBOX_DIR = "objectbox-native-retriever"
        private const val EXPECTED_EMBEDDING_DIMS = 384
        private const val TOP_K_DEFAULT = 5
        private const val EXPECTED_EMBEDDING_MODEL = "intfloat/e5-small-v2"
        private const val HNSW_EF_SEARCH = 64
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var boxStore: BoxStore? = null
    private var chunkBox: Box<ClinicalChunk>? = null
    private var ortSession: OrtSession? = null
    private var ortEnv: OrtEnvironment? = null
    private var isReady = false
    private var queryPrefix: String = "query: "

    private fun modelDir(): File = File(context.filesDir, EMBEDDING_MODEL_DIR)

    override fun load() {
        if (!BuildConfig.USE_NATIVE_RETRIEVER) {
            Log.i(TAG, "NativeRetriever disabled (USE_NATIVE_RETRIEVER=false)")
        } else {
            Log.i(TAG, "NativeRetriever enabled — waiting for loadBundle()")
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        ortSession?.close()
        ortEnv?.close()
        boxStore?.close()
        isReady = false
    }

    // --- loadBundle ---

    @PluginMethod
    fun loadBundle(call: PluginCall) {
        if (!BuildConfig.USE_NATIVE_RETRIEVER) {
            call.resolve(JSObject().apply { put("success", false); put("chunkCount", 0); put("embeddingDims", 0) })
            return
        }

        val path = call.getString("path")
        if (path.isNullOrEmpty()) {
            call.reject("path is required")
            return
        }

        scope.launch {
            try {
                val startMs = System.currentTimeMillis()

                // 1. Validate manifest embedding compatibility
                val retrievalCaps = parseRetrievalCapabilities(path)

                // Validate dimensions from manifest match runtime expectation
                val bundleDims = retrievalCaps.optInt("embeddingDims", 0)
                if (bundleDims > 0 && bundleDims != EXPECTED_EMBEDDING_DIMS) {
                    call.reject(
                        "Embedding dimension mismatch: bundle=$bundleDims, " +
                        "runtime=$EXPECTED_EMBEDDING_DIMS. Incompatible embedding space."
                    )
                    return@launch
                }

                // Validate model identifier if present (future compiler versions)
                val bundleModel = retrievalCaps.optString("embeddingModel", "")
                if (bundleModel.isNotEmpty() && bundleModel != EXPECTED_EMBEDDING_MODEL) {
                    call.reject(
                        "Embedding model mismatch: bundle='$bundleModel', " +
                        "runtime='$EXPECTED_EMBEDDING_MODEL'. Mismatched embedding space."
                    )
                    return@launch
                }

                // Read asymmetric query prefix from manifest
                val manifestPrefix = retrievalCaps.optString("queryPrefix", "")
                if (manifestPrefix.isNotEmpty()) {
                    queryPrefix = manifestPrefix
                    Log.i(TAG, "Query prefix from manifest: '$queryPrefix'")
                } else {
                    Log.i(TAG, "No queryPrefix in manifest, using default: '$queryPrefix'")
                }

                // 2. Initialize fused ONNX model (tokenizer + E5-small-v2)
                val dir = modelDir()
                val fusedModelFile = File(dir, FUSED_MODEL_FILE)
                if (!fusedModelFile.exists()) {
                    call.reject("Fused model not found: ${fusedModelFile.absolutePath}")
                    return@launch
                }
                initOnnx(fusedModelFile)

                // 3. Open ObjectBox
                val store = openBoxStore(context)
                boxStore = store
                chunkBox = store.boxFor<ClinicalChunk>()
                chunkBox!!.removeAll()

                // 4. Import pre-computed vectors
                val count = importPrecomputedVectors(path, chunkBox!!)

                isReady = true
                val elapsed = System.currentTimeMillis() - startMs
                Log.i(TAG, "loadBundle: $count chunks (${EXPECTED_EMBEDDING_DIMS}D) in ${elapsed}ms")

                call.resolve(JSObject().apply {
                    put("success", true)
                    put("chunkCount", count)
                    put("embeddingDims", EXPECTED_EMBEDDING_DIMS)
                })
            } catch (e: Exception) {
                Log.e(TAG, "loadBundle failed", e)
                isReady = false
                call.reject("loadBundle error: ${e.message}")
            }
        }
    }

    // --- search ---

    @PluginMethod
    fun search(call: PluginCall) {
        if (!BuildConfig.USE_NATIVE_RETRIEVER || !isReady) {
            call.resolve(JSObject().apply { put("results", JSArray()) })
            return
        }

        val query = call.getString("query")
        if (query.isNullOrEmpty()) {
            call.reject("query is required")
            return
        }
        val topK = call.getInt("topK", TOP_K_DEFAULT)!!

        scope.launch {
            try {
                val session = ortSession ?: throw IllegalStateException("ONNX not ready")
                val box = chunkBox ?: throw IllegalStateException("ObjectBox not ready")

                // E5-small-v2 is English-only — reject non-Latin-script queries
                // at the embedder boundary (mirrors compiler-side assertion)
                assertEnglishText(query)

                val prefixedQuery = "$queryPrefix$query"
                val queryVec = embedQuery(session, prefixedQuery)

                val results = box.query(ClinicalChunk_.embedding.nearestNeighbors(queryVec, topK))
                    .build()
                    .findWithScores()

                val arr = JSArray()
                for (scored in results) {
                    val chunk = scored.get()
                    arr.put(JSObject().apply {
                        put("chunkId", chunk.chunkId)
                        put("rawText", chunk.rawText)
                        put("displayTitle", chunk.displayTitle)
                        put("chunkType", chunk.chunkType)
                        put("score", scored.score)
                    })
                }

                call.resolve(JSObject().apply { put("results", arr) })
            } catch (e: Exception) {
                Log.e(TAG, "search failed", e)
                call.reject("search error: ${e.message}")
            }
        }
    }

    // --- isReady ---

    @PluginMethod
    fun isReady(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("ready", BuildConfig.USE_NATIVE_RETRIEVER && isReady)
        })
    }

    // --- isEmbeddingModelDownloaded ---

    @PluginMethod
    fun isEmbeddingModelDownloaded(call: PluginCall) {
        val dir = modelDir()
        val fusedModel = File(dir, FUSED_MODEL_FILE)
        // E5-small-v2 fused model is ~67MB (vs 300MB for EmbeddingGemma)
        val ready = fusedModel.exists() && fusedModel.length() > 30_000_000

        call.resolve(JSObject().apply {
            put("downloaded", ready)
            put("path", dir.absolutePath)
            put("sizeMB", if (ready) fusedModel.length() / (1024 * 1024) else 0)
        })
    }

    // --- downloadEmbeddingModel ---

    @PluginMethod
    fun downloadEmbeddingModel(call: PluginCall) {
        scope.launch {
            try {
                val dir = modelDir()
                dir.mkdirs()

                val dest = File(dir, FUSED_MODEL_FILE)
                if (dest.exists() && dest.length() > 30_000_000) {
                    Log.i(TAG, "E5 model already present (${dest.length() / (1024 * 1024)}MB)")
                    call.resolve(JSObject().apply {
                        put("success", true)
                        put("path", dir.absolutePath)
                        put("sizeMB", dest.length() / (1024 * 1024))
                    })
                    return@launch
                }

                // Copy bundled model from APK assets (no network download needed)
                val assetPath = "$EMBEDDING_MODEL_DIR/$FUSED_MODEL_FILE"
                Log.i(TAG, "Copying E5 model from assets: $assetPath")
                context.assets.open(assetPath).use { input ->
                    dest.outputStream().use { output ->
                        input.copyTo(output, bufferSize = 65536)
                    }
                }
                Log.i(TAG, "E5 model copied from assets (${dest.length() / (1024 * 1024)}MB)")

                call.resolve(JSObject().apply {
                    put("success", true)
                    put("path", dir.absolutePath)
                    put("sizeMB", dest.length() / (1024 * 1024))
                })
            } catch (e: Exception) {
                Log.e(TAG, "downloadEmbeddingModel failed", e)
                call.reject("Model copy failed: ${e.message}")
            }
        }
    }

    // --- unload ---

    @PluginMethod
    fun unload(call: PluginCall) {
        ortSession?.close()
        ortSession = null
        ortEnv?.close()
        ortEnv = null
        chunkBox = null
        boxStore?.close()
        boxStore = null
        isReady = false
        call.resolve(JSObject().apply { put("success", true) })
    }

    // --- Private: ONNX (Fused Model) ---

    private suspend fun initOnnx(fusedModelFile: File) = withContext(Dispatchers.IO) {
        if (ortSession != null) return@withContext
        val env = OrtEnvironment.getEnvironment()
        ortEnv = env
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(2)
            // onnxruntime-extensions provides BertTokenizer op for fused E5 model
            registerCustomOpLibrary(getExtensionsLibPath())
        }
        ortSession = env.createSession(fusedModelFile.absolutePath, opts)
        Log.i(TAG, "Fused ONNX session ready: ${fusedModelFile.name}")
    }

    private fun getExtensionsLibPath(): String {
        val libDir = context.applicationInfo.nativeLibraryDir
        val libPath = File(libDir, "libortextensions.so").absolutePath
        if (File(libPath).exists()) return libPath

        // Fallback: on newer Android with extractNativeLibs=false, try alternate paths
        val altPaths = listOf(
            "$libDir!/lib/arm64-v8a/libortextensions.so",
            "/data/app/${context.packageName}/lib/arm64/libortextensions.so",
        )
        for (alt in altPaths) {
            if (File(alt).exists()) return alt
        }

        // Last resort: load via System to ensure it's mapped, then use nativeLibraryDir
        try {
            System.loadLibrary("ortextensions")
            Log.i(TAG, "Loaded libortextensions via System.loadLibrary")
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "System.loadLibrary(ortextensions) failed: ${e.message}")
        }

        // Return the canonical path even if exists() fails — ORT may resolve it internally
        return libPath
    }

    /**
     * Embed a query string using fused E5-small-v2 ONNX model.
     *
     * Pipeline (fully fused in ONNX):
     *   Raw text -> WordPiece tokenization -> BERT encoder -> mean pooling ->
     *   L2 Normalize -> sentence_embedding [1, 384]
     *
     * No post-processing needed — 384 is the native output dimension.
     */
    private suspend fun embedQuery(
        session: OrtSession,
        text: String,
    ): FloatArray = withContext(Dispatchers.IO) {
        val env = ortEnv ?: throw IllegalStateException("ORT env not available")

        val textInput = OnnxTensor.createTensor(env, arrayOf(text))

        val results = session.run(mapOf("text" to textInput))
        textInput.close()

        val sentenceEmbOutput = results.get("sentence_embedding")
            .orElseGet { results.get(1) } as OnnxTensor
        val vec = (sentenceEmbOutput.value as Array<FloatArray>)[0]
        results.close()

        if (vec.size != EXPECTED_EMBEDDING_DIMS) {
            throw IllegalStateException(
                "Model output ${vec.size}D, expected ${EXPECTED_EMBEDDING_DIMS}D"
            )
        }

        // E5 output should already be L2-normalized; verify and correct if needed
        val norm = l2Norm(vec)
        if (norm < 0.99f || norm > 1.01f) {
            Log.w(TAG, "E5 output norm=$norm, re-normalizing")
            normalizeInPlace(vec)
        }

        vec
    }

    // --- Private: Bundle parsing ---

    private suspend fun parseRetrievalCapabilities(hivPath: String): JSONObject =
        withContext(Dispatchers.IO) {
            ZipFile(hivPath).use { zip ->
                val entry = zip.getEntry("manifest.json")
                    ?: throw IllegalArgumentException(".hiva missing manifest.json")
                val json = JSONObject(zip.getInputStream(entry).bufferedReader().readText())
                // retrievalCapabilities is optional — older bundles omit it.
                // Return empty object so dimension/model checks are skipped.
                json.optJSONObject("retrievalCapabilities") ?: JSONObject()
            }
        }

    /**
     * Import pre-computed vectors from index/embeddings.bin.
     *
     * Binary format: [int32 N] [int32 D] [N * D * float32 vectors]
     * Vectors are L2-normalized by the compiler.
     */
    private suspend fun importPrecomputedVectors(
        hivPath: String,
        box: Box<ClinicalChunk>,
    ): Int = withContext(Dispatchers.IO) {
        ZipFile(hivPath).use { zip ->
            // Read embeddings.bin
            val embEntry = zip.getEntry("index/embeddings.bin")
                ?: throw IllegalArgumentException(".hiva missing index/embeddings.bin")
            val embBytes = zip.getInputStream(embEntry).readBytes()
            val buf = ByteBuffer.wrap(embBytes).order(ByteOrder.LITTLE_ENDIAN)

            val n = buf.getInt()
            val d = buf.getInt()
            Log.i(TAG, "embeddings.bin: N=$n, D=$d")

            if (d != EXPECTED_EMBEDDING_DIMS) {
                throw IllegalArgumentException(
                    "Dimension mismatch: bundle=$d, runtime=$EXPECTED_EMBEDDING_DIMS"
                )
            }

            // Spot-check L2 normalization on first vector
            val checkPos = buf.position()
            var normSq = 0.0f
            for (i in 0 until d) normSq += buf.getFloat(checkPos + i * 4).let { it * it }
            val norm = sqrt(normSq.toDouble()).toFloat()
            if (norm < 0.95f || norm > 1.05f) {
                Log.w(TAG, "L2 norm spot-check FAILED: norm=$norm")
            } else {
                Log.i(TAG, "L2 normalization OK: norm=$norm")
            }

            // Read chunk ID index — supports both formats:
            //   Format A (legacy): JSONArray ["id0", "id1", ...]
            //   Format B (compiler v3.0): JSONObject {"index": {"0": "id0", "1": "id1", ...}}
            val idxEntry = zip.getEntry("index/embeddings_index.json")
                ?: throw IllegalArgumentException(".hiva missing index/embeddings_index.json")
            val idxRaw = zip.getInputStream(idxEntry).bufferedReader().readText()
            val idxArr: Array<String>

            val trimmed = idxRaw.trimStart()
            if (trimmed.startsWith("[")) {
                // Format A: plain JSON array
                val arr = org.json.JSONArray(trimmed)
                idxArr = Array(arr.length()) { i -> arr.getString(i) }
            } else {
                // Format B: {"index": {"0": "id", "1": "id", ...}}
                val obj = JSONObject(trimmed)
                val indexObj = obj.getJSONObject("index")
                idxArr = Array(indexObj.length()) { i -> indexObj.getString(i.toString()) }
            }

            if (idxArr.size != n) {
                throw IllegalArgumentException("Count mismatch: bin=$n, index=${idxArr.size}")
            }

            // Read chunk metadata
            val meta = mutableMapOf<String, ChunkMeta>()
            zip.getEntry("content/chunks.jsonl")?.let { chunksEntry ->
                zip.getInputStream(chunksEntry).bufferedReader().forEachLine { line ->
                    if (line.isBlank()) return@forEachLine
                    try {
                        val j = JSONObject(line)
                        val id = j.optString("id").takeIf { it.isNotEmpty() } ?: return@forEachLine
                        val raw = j.optString("raw_text").ifEmpty {
                            synthesizeRawText(j.optJSONObject("content")?.optJSONObject("en"))
                        }
                        meta[id] = ChunkMeta(
                            raw,
                            j.optString("display_title").ifEmpty { id },
                            j.optString("type"),
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "Skipping chunk: ${e.message}")
                    }
                }
            }

            // Bulk insert
            buf.position(8)
            val entities = ArrayList<ClinicalChunk>(n)
            for (i in 0 until n) {
                val id = idxArr[i]
                val vec = FloatArray(d) { buf.getFloat() }
                val m = meta[id]
                entities.add(ClinicalChunk(
                    chunkId = id,
                    rawText = m?.rawText ?: "",
                    displayTitle = m?.displayTitle ?: id,
                    chunkType = m?.chunkType ?: "",
                    embedding = vec,
                ))
            }
            box.put(entities)
            Log.i(TAG, "Imported $n vectors into HNSW index")
            n
        }
    }

    // --- Helpers ---

    private data class ChunkMeta(val rawText: String, val displayTitle: String, val chunkType: String)

    private fun openBoxStore(ctx: Context): BoxStore {
        val dir = File(ctx.filesDir, OBJECTBOX_DIR)
        dir.mkdirs()
        return try {
            MyObjectBox.builder()
                .androidContext(ctx)
                .directory(dir)
                .build()
        } catch (e: Exception) {
            // Schema mismatch (e.g. HNSW dimension change) — delete and recreate
            Log.w(TAG, "ObjectBox open failed (${e.message}), resetting database")
            dir.deleteRecursively()
            dir.mkdirs()
            MyObjectBox.builder()
                .androidContext(ctx)
                .directory(dir)
                .build()
        }
    }

    /**
     * Reject queries with significant non-Latin script content.
     * E5-small-v2 has no meaningful multilingual training — embedding non-English
     * text silently degrades retrieval quality without any visible error.
     */
    private fun assertEnglishText(text: String) {
        val nonLatinCount = text.count { ch ->
            ch.code > 0x024F && !ch.isWhitespace() && !ch.isDigit() &&
            ch !in '!'..'/' && ch !in ':'..'@' && ch !in '['..'`' && ch !in '{'..'~'
        }
        val totalNonSpace = text.count { !it.isWhitespace() }
        if (totalNonSpace > 0 && nonLatinCount.toFloat() / totalNonSpace > 0.3f) {
            throw IllegalArgumentException(
                "E5-small-v2 requires English text. Query contains ${nonLatinCount}/" +
                "${totalNonSpace} non-Latin characters. Translate before embedding."
            )
        }
    }

    private fun l2Norm(v: FloatArray): Float {
        var s = 0.0f
        for (x in v) s += x * x
        return sqrt(s.toDouble()).toFloat()
    }

    private fun normalizeInPlace(v: FloatArray) {
        val n = l2Norm(v)
        if (n > 1e-10f) for (i in v.indices) v[i] /= n
    }

    private fun synthesizeRawText(en: JSONObject?): String {
        if (en == null) return ""
        val parts = mutableListOf<String>()
        for (f in listOf("answer", "description", "procedure", "definition", "instruction")) {
            val v = en.optString(f)
            if (v.isNotEmpty()) { parts.add(v); break }
        }
        for (f in listOf("indication", "contraindication", "side_effects", "monitoring",
            "referral_criteria", "danger_signs", "prevention", "notes")) {
            val v = en.optString(f)
            if (v.isNotEmpty()) parts.add(v)
        }
        return parts.joinToString("\n\n")
    }

}
