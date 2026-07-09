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

// ObjectBox entity: 256-dim EmbeddingGemma vectors, HNSW-indexed
// M=16, efConstruction=200 per compiler handoff recommendations.
@Entity
data class ClinicalChunk(
    @Id var dbId: Long = 0,
    var chunkId: String = "",
    var rawText: String = "",
    var displayTitle: String = "",
    var chunkType: String = "",
    @HnswIndex(
        dimensions = 256,
        neighborsPerNode = 16,
        indexingSearchCount = 200,
    )
    var embedding: FloatArray? = null,
)

/**
 * NativeRetriever — ObjectBox + EmbeddingGemma-300M HNSW retrieval plugin.
 *
 * Architecture:
 *   - Document vectors: pre-computed by compiler (EmbeddingGemma-300M, 256-dim,
 *     Matryoshka-truncated, L2-normalized), loaded from index/embeddings.bin.
 *   - Query vectors: computed on-device at search time using EmbeddingGemma-300M
 *     ONNX (q8) with SentencePiece tokenizer and asymmetric query prefix.
 *   - Search: ObjectBox HNSW nearest-neighbor on L2-normalized 256-dim vectors.
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
        private const val EMBEDDING_MODEL_DIR = "models/embedding-gemma"
        private const val FUSED_MODEL_FILE = "embeddinggemma_fused_q8.onnx"
        private const val OBJECTBOX_DIR = "objectbox-native-retriever"
        private const val EXPECTED_EMBEDDING_DIMS = 256
        private const val TOP_K_DEFAULT = 5
        private const val EXPECTED_EMBEDDING_MODEL = "google/embeddinggemma-300m"
        private const val HNSW_EF_SEARCH = 64  // HNSW search-time ef parameter
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var boxStore: BoxStore? = null
    private var chunkBox: Box<ClinicalChunk>? = null
    private var ortSession: OrtSession? = null
    private var ortEnv: OrtEnvironment? = null
    private var isReady = false
    private var queryPrefix: String = "task: search result | query: "  // B.6: read from manifest

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

                // 1. Validate manifest embedding model compatibility
                val retrievalCaps = parseRetrievalCapabilities(path)
                val bundleModel = retrievalCaps.optString("embeddingModel", "")
                if (bundleModel.isEmpty()) {
                    call.reject("Bundle manifest missing retrievalCapabilities.embeddingModel")
                    return@launch
                }
                if (!bundleModel.contains("embeddinggemma", ignoreCase = true) &&
                    bundleModel != EXPECTED_EMBEDDING_MODEL) {
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
                    Log.i(TAG, "Query prefix: '$queryPrefix'")
                } else {
                    Log.w(TAG, "No queryPrefix in manifest, using default: '$queryPrefix'")
                }

                // 2. Initialize fused ONNX model (tokenizer + EmbeddingGemma)
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

                val prefixedQuery = "$queryPrefix$query"  // B.6: asymmetric prefix from manifest
                val queryVec = embedQuery(session, prefixedQuery)

                // B.8: HNSW search with efSearch=64 (if API supports override)
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
        val ready = fusedModel.exists() && fusedModel.length() > 100_000_000

        call.resolve(JSObject().apply {
            put("downloaded", ready)
            put("path", dir.absolutePath)
            put("sizeMB", if (ready) fusedModel.length() / (1024 * 1024) else 0)
        })
    }

    // --- downloadEmbeddingModel ---

    @PluginMethod
    fun downloadEmbeddingModel(call: PluginCall) {
        // Download the fused ONNX model (tokenizer + EmbeddingGemma baked in)
        // This should be hosted on the user's CDN or HuggingFace
        val baseUrl = call.getString("url")
            ?: "https://huggingface.co/Kenzlejaze/hiva-models/resolve/main"  // EmbeddingGemma-300M ONNX

        scope.launch {
            try {
                val dir = modelDir()
                dir.mkdirs()

                val dest = File(dir, FUSED_MODEL_FILE)
                if (dest.exists() && dest.length() > 100_000_000) {
                    Log.i(TAG, "Fused model already present (${dest.length() / (1024 * 1024)}MB)")
                    call.resolve(JSObject().apply {
                        put("success", true)
                        put("path", dir.absolutePath)
                        put("sizeMB", dest.length() / (1024 * 1024))
                    })
                    return@launch
                }

                val url = "$baseUrl/$FUSED_MODEL_FILE"
                Log.i(TAG, "Downloading fused model from $url...")
                downloadFile(url, dest)
                Log.i(TAG, "Downloaded ${dest.length() / (1024 * 1024)}MB")

                call.resolve(JSObject().apply {
                    put("success", true)
                    put("path", dir.absolutePath)
                    put("sizeMB", dest.length() / (1024 * 1024))
                })
            } catch (e: Exception) {
                Log.e(TAG, "downloadEmbeddingModel failed", e)
                call.reject("Download failed: ${e.message}")
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
            // Register onnxruntime-extensions for SentencePiece custom ops
            registerCustomOpLibrary(getExtensionsLibPath())
        }
        ortSession = env.createSession(fusedModelFile.absolutePath, opts)
        Log.i(TAG, "Fused ONNX session ready: ${fusedModelFile.name}")
    }

    private fun getExtensionsLibPath(): String {
        // onnxruntime-extensions-android AAR extracts libortextensions.so to:
        // context.applicationInfo.nativeLibraryDir/libortextensions.so
        val libDir = context.applicationInfo.nativeLibraryDir
        val libPath = File(libDir, "libortextensions.so").absolutePath
        if (!File(libPath).exists()) {
            throw IllegalStateException("libortextensions.so not found at $libPath")
        }
        return libPath
    }

    /**
     * Embed a query string using fused EmbeddingGemma-300M ONNX model.
     *
     * Pipeline (fully fused in ONNX):
     *   Raw text -> SentencePiece tokenization -> Gemma3TextModel -> mean pooling ->
     *   Dense(768->3072) -> Dense(3072->768) -> L2 Normalize -> sentence_embedding [1, 768]
     *
     * Post-processing (on-device):
     *   Truncate 768 -> 256 (Matryoshka) -> re-normalize L2 (MANDATORY)
     *
     * B.7: Spot-check normalization after truncation.
     */
    private suspend fun embedQuery(
        session: OrtSession,
        text: String,
    ): FloatArray = withContext(Dispatchers.IO) {
        val env = ortEnv ?: throw IllegalStateException("ORT env not available")

        // Fused model takes raw text as input
        val textInput = OnnxTensor.createTensor(env, arrayOf(text))

        val results = session.run(mapOf("text" to textInput))
        textInput.close()

        // Extract sentence_embedding output [1, 768]
        // Output order: [last_hidden_state, sentence_embedding]
        val sentenceEmbOutput = results.get("sentence_embedding")
            .orElseGet { results.get(1) } as OnnxTensor
        val fullVec = (sentenceEmbOutput.value as Array<FloatArray>)[0]
        results.close()

        if (fullVec.size < EXPECTED_EMBEDDING_DIMS) {
            throw IllegalStateException("Model output ${fullVec.size}D, need >=$EXPECTED_EMBEDDING_DIMS")
        }

        // B.3: Matryoshka truncation (768 -> 256) + re-normalization
        // CRITICAL: Slicing a normalized 768-dim vector to 256 dims drops norm to ~0.605
        // Re-normalization is MANDATORY or ObjectBox HNSW search returns wrong neighbors
        val vec = fullVec.copyOf(EXPECTED_EMBEDDING_DIMS)
        normalizeInPlace(vec)

        // B.7: Verify normalization (spot-check)
        val norm = l2Norm(vec)
        if (norm < 0.99f || norm > 1.01f) {
            Log.w(TAG, "Query vec norm=$norm after re-norm (expected ~1.0)")
        }

        vec
    }

    // --- Private: Bundle parsing ---

    private suspend fun parseRetrievalCapabilities(hivPath: String): JSONObject =
        withContext(Dispatchers.IO) {
            ZipFile(hivPath).use { zip ->
                val entry = zip.getEntry("manifest.json")
                    ?: throw IllegalArgumentException(".hiv missing manifest.json")
                val json = JSONObject(zip.getInputStream(entry).bufferedReader().readText())
                json.optJSONObject("retrievalCapabilities")
                    ?: throw IllegalArgumentException("manifest missing retrievalCapabilities")
            }
        }

    /**
     * Import pre-computed 256-dim EmbeddingGemma vectors from index/embeddings.bin.
     *
     * Binary format:
     *   [int32 N] [int32 D] [N * D * float32 vectors]
     *   Vectors are L2-normalized by the compiler.
     *
     * Chunk IDs from index/embeddings_index.json (JSON array, same order).
     * Metadata from content/chunks.jsonl.
     */
    private suspend fun importPrecomputedVectors(
        hivPath: String,
        box: Box<ClinicalChunk>,
    ): Int = withContext(Dispatchers.IO) {
        ZipFile(hivPath).use { zip ->
            // Read embeddings.bin
            val embEntry = zip.getEntry("index/embeddings.bin")
                ?: throw IllegalArgumentException(".hiv missing index/embeddings.bin")
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

            // Read chunk ID index
            val idxEntry = zip.getEntry("index/embeddings_index.json")
                ?: throw IllegalArgumentException(".hiv missing index/embeddings_index.json")
            val idxArr = org.json.JSONArray(
                zip.getInputStream(idxEntry).bufferedReader().readText()
            )
            if (idxArr.length() != n) {
                throw IllegalArgumentException("Count mismatch: bin=$n, index=${idxArr.length()}")
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
                val id = idxArr.getString(i)
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
        return MyObjectBox.builder()
            .androidContext(ctx)
            .directory(dir)
            .build()
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

    private suspend fun downloadFile(url: String, dest: File) = withContext(Dispatchers.IO) {
        val tmp = File(dest.parent, "${dest.name}.tmp")
        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 180_000
        conn.instanceFollowRedirects = true
        conn.connect()
        if (conn.responseCode != 200) {
            conn.disconnect()
            throw RuntimeException("HTTP ${conn.responseCode} for ${dest.name}")
        }
        conn.inputStream.use { input ->
            tmp.outputStream().use { output ->
                input.copyTo(output, bufferSize = 65536)
            }
        }
        conn.disconnect()
        if (!tmp.renameTo(dest)) {
            throw RuntimeException("Failed to rename ${tmp.name} to ${dest.name}")
        }
    }
}
