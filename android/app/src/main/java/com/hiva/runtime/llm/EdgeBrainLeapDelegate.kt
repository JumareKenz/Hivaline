package com.hiva.runtime.llm

import ai.liquid.leap.Conversation
import ai.liquid.leap.GenerationOptions
import ai.liquid.leap.LeapClient
import ai.liquid.leap.ModelLoadingOptions
import ai.liquid.leap.ModelRunner
import ai.liquid.leap.message.GenerationFinishReason
import ai.liquid.leap.message.MessageResponse
import android.content.Context
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.io.File

/**
 * LEAP/LFM2.5-350M inference delegate for EdgeBrainPlugin.
 *
 * API chain (verified against leap-sdk-0.6.0.aar decompiled class signatures):
 *   LeapClient (singleton object, NOT constructor)
 *     .loadModel(path, ModelLoadingOptions) : suspend -> ModelRunner
 *     .createConversation(systemPrompt) : Conversation
 *     .generateResponse(userContent, GenerationOptions) : Flow<MessageResponse>
 *
 * All message types are in ai.liquid.leap.message.*:
 *   MessageResponse (interface), MessageResponse.Chunk, MessageResponse.Complete,
 *   MessageResponse.FunctionCalls, MessageResponse.ReasoningChunk,
 *   GenerationFinishReason (enum: STOP, CONSTRAINT, INTERRUPTED, EXCEED_CONTEXT, ERROR),
 *   GenerationStats (completionTokens: Long, tokenPerSecond: Float)
 *
 * ModelRunner.unload() is a suspend function — called inside scope.launch in destroy/unload.
 *
 * Token-limit enforcement:
 *   GenerationOptions has NO maxTokens field (confirmed). Ceiling enforced via
 *   transformWhile { chunkCount < maxChunks }. LEAP handles Flow cancellation
 *   cleanly (native inference teardown on upstream cancellation).
 *
 * SAFETY: Primary clinical safety gate (checkGrounding ≥70% term-match) lives in
 *   TypeScript (conversationEngine.ts:513) and is independent of this class.
 *   groundednessSignal is secondary — logged for monitoring only.
 *
 * JSON schema / maxLength note:
 *   LEAP SDK enforces structural JSON constraints (field presence, enum values, types)
 *   but maxLength on string fields may be silently ignored depending on SDK version.
 *   The transformWhile ceiling (maxChunks) is therefore the primary token gate.
 *   Schema field order: groundedness_signal → source_chunk_ids → answer_text
 *   ensures the cheap fields are committed first; if the ceiling fires during
 *   answer_text generation the salvage path can still recover both.
 */
class EdgeBrainLeapDelegate(
    private val context: Context,
    private val scope: CoroutineScope,
) {
    companion object {
        private const val TAG = "EdgeBrainLeap"
        private const val LEAP_MODEL_DIR = "models/lfm25"
        private const val LEAP_MODEL_FILE = "model.gguf"

        // --- SAMPLING PARAMETERS — update after Step D.4 empirical grid test ---
        private const val TEMPERATURE = 0.1f
        private const val TOP_P = 0.9f
        private const val MIN_P = 0.05f
        private const val REPETITION_PENALTY = 1.1f

        private const val CPU_THREADS = 4

        // Chunk ceiling enforced via transformWhile.
        // LEAP emits one Chunk per decoded token. jsonSchemaConstraint normally causes
        // CONSTRAINT/STOP before this ceiling fires.
        // Default raised to 2048 — the JS layer sends maxTokens=512, which was
        // firing before answer_text could finish. 2048 gives the full JSON room
        // to close even for a 600-char answer_text.
        private const val DEFAULT_MAX_CHUNKS = 2048

        private const val TRANSLATION_SYSTEM_PROMPT =
            "You are a medical translation assistant. Translate the user's query to English. " +
            "Output ONLY the English translation. Preserve medical terms exactly. " +
            "No explanations, no prefixes, no quotation marks."
    }

    private fun languageCodeToName(code: String): String = when (code) {
        "ha" -> "Hausa"
        "yo" -> "Yoruba"
        "ig" -> "Igbo"
        "pid" -> "Nigerian Pidgin"
        else -> "non-English"
    }

    // ModelRunner returned by LeapClient.loadModel() — stored for model lifetime.
    private var modelRunner: ModelRunner? = null

    // JSON schema for GenerationOptions.jsonSchemaConstraint — built once, reused.
    private val mediChatJsonSchema: String = buildMediChatJsonSchema()

    fun loadModel(call: PluginCall) {
        scope.launch {
            try {
                val path = modelPath()
                val destFile = File(path)

                // Copy bundled model from assets on first launch
                if (!destFile.exists()) {
                    Log.i(TAG, "Model not found in files, checking assets...")
                    val assetPath = "$LEAP_MODEL_DIR/$LEAP_MODEL_FILE"
                    try {
                        destFile.parentFile?.mkdirs()
                        context.assets.open(assetPath).use { input ->
                            destFile.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }
                        Log.i(TAG, "Copied bundled model from assets (${destFile.length() / (1024 * 1024)}MB)")
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to copy from assets: ${e.message}, will try download...")
                        call.reject("LEAP model file not found at: $path")
                        return@launch
                    }
                }

                val startTime = System.currentTimeMillis()

                // LeapClient is a Kotlin singleton object — use LeapClient, not LeapClient().
                val runner = LeapClient.loadModel(
                    path,
                    ModelLoadingOptions(
                        cpuThreads = CPU_THREADS,
                        randomSeed = 42L,
                    )
                )
                modelRunner = runner
                val elapsed = System.currentTimeMillis() - startTime
                Log.i(TAG, "LEAP model loaded in ${elapsed}ms: $path")

                val result = JSObject()
                result.put("success", true)
                result.put("loadTimeMs", elapsed)
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "loadModel failed", e)
                call.reject("LEAP model load error: ${e.message}")
            }
        }
    }

    fun generate(call: PluginCall) {
        val runner = modelRunner
        if (runner == null) {
            call.reject("Model not loaded. Call loadModel() first.")
            return
        }

        val systemPrompt = call.getString("systemPrompt")
        val userContent = call.getString("userContent")
        if (systemPrompt.isNullOrEmpty() || userContent.isNullOrEmpty()) {
            call.reject("systemPrompt and userContent are required for LEAP backend")
            return
        }

        val maxChunks = call.getInt("maxTokens", DEFAULT_MAX_CHUNKS)!!
        val temperature = call.getFloat("temperature", TEMPERATURE)!!
        val topP = call.getFloat("topP", TOP_P)!!
        val repetitionPenalty = call.getFloat("repeatPenalty", REPETITION_PENALTY)!!

        scope.launch {
            try {
                val startTime = System.currentTimeMillis()

                // Fresh Conversation per call — evidence differs per query; reusing
                // would accumulate incorrect history across unrelated clinical queries.
                val conversation = runner.createConversation(systemPrompt)

                // ISSUE-4 DEBUG: log exact schema sent to LEAP so we can confirm
                // maxLength and field order in logcat.
                Log.d(TAG, "SCHEMA_DEBUG: jsonSchemaConstraint=$mediChatJsonSchema")

                val genOptions = GenerationOptions(
                    temperature = temperature,
                    topP = topP,
                    minP = MIN_P,
                    repetitionPenalty = repetitionPenalty,
                    jsonSchemaConstraint = mediChatJsonSchema,
                    // Disable LFM2's default Pythonic tool-call parser. Without this,
                    // imperative phrasing ("calculate", "look up", "search for") can
                    // cause the model to emit tool-call tokens intercepted into
                    // MessageResponse.FunctionCalls instead of MessageResponse.Chunk,
                    // producing empty answerText. No functions are registered here.
                    functionCallParser = null,
                )

                val flow = conversation.generateResponse(userContent, genOptions)

                val outputBuilder = StringBuilder()
                var chunkCount = 0
                var finishReason: GenerationFinishReason? = null
                var completionTokens = 0L
                var tokensPerSecond = 0f

                flow.transformWhile { response ->
                    emit(response)
                    when (response) {
                        is MessageResponse.Chunk -> {
                            chunkCount++
                            chunkCount < maxChunks
                        }
                        is MessageResponse.Complete -> false
                        is MessageResponse.FunctionCalls -> true  // should not arrive
                        else -> true
                    }
                }.collect { response ->
                    when (response) {
                        is MessageResponse.Chunk ->
                            outputBuilder.append(response.text)

                        is MessageResponse.Complete -> {
                            finishReason = response.finishReason
                            completionTokens = response.stats?.completionTokens ?: 0L
                            tokensPerSecond = response.stats?.tokenPerSecond ?: 0f
                        }

                        // FunctionCalls should never arrive (functionCallParser=null).
                        is MessageResponse.FunctionCalls ->
                            Log.e(TAG, "Unexpected FunctionCalls despite functionCallParser=null — " +
                                    "check LEAP SDK version. Chunk text lost.")

                        else -> {}
                    }
                }

                // D.1 instrumentation: INTERRUPTED means the ceiling fired before
                // schema constraint closed the JSON. If this fires on >3/30 golden
                // queries, raise DEFAULT_MAX_CHUNKS or tighten the system prompt.
                if (finishReason == GenerationFinishReason.INTERRUPTED) {
                    Log.w(TAG, "FINISH_INTERRUPTED: ceiling ($maxChunks chunks) fired — JSON may be truncated.")
                }
                if (chunkCount >= maxChunks && finishReason == null) {
                    Log.w(TAG, "Token ceiling hit ($maxChunks chunks) before Complete.")
                }

                val elapsed = System.currentTimeMillis() - startTime
                Log.i(TAG, "Generated in ${elapsed}ms | chunks=$chunkCount | " +
                        "completionTokens=$completionTokens | tok/s=$tokensPerSecond | " +
                        "finishReason=$finishReason")

                // Strip markdown code fences that LFM2.5 sometimes wraps around JSON output.
                // Pattern: ```json\n{...}\n``` or ```\n{...}\n```
                val rawOutput = outputBuilder.toString()
                val rawJson = rawOutput
                    .replace(Regex("^```(?:json)?\\s*", RegexOption.MULTILINE), "")
                    .replace(Regex("```\\s*$", RegexOption.MULTILINE), "")
                    .trim()

                // ISSUE-4 DEBUG: log the full raw output so we can inspect JSON
                // completeness in logcat whenever parsing is attempted.
                Log.d(TAG, "RAW_OUTPUT: finishReason=$finishReason chunks=$chunkCount raw=$rawJson")

                val parsed = runCatching {
                    Json.decodeFromString(MediChatResponse.serializer(), rawJson)
                }.getOrNull()

                val answerText: String
                val groundednessSignal: String
                val sourceChunkIds: List<String>

                if (parsed != null) {
                    answerText = if (parsed.groundednessSignal == GroundednessSignal.INSUFFICIENT) {
                        "INSUFFICIENT_EVIDENCE"
                    } else {
                        parsed.answerText
                    }
                    groundednessSignal = parsed.groundednessSignal.name
                    sourceChunkIds = parsed.sourceChunkIds

                    if (parsed.groundednessSignal == GroundednessSignal.PARTIAL) {
                        Log.w(TAG, "GROUNDING_PARTIAL: model self-reports partial")
                    }
                } else {
                    // JSON parse failed — likely truncated mid-string by token ceiling.
                    // Log the full raw output first so we can diagnose recurrences.
                    Log.w(TAG, "PARSE_FAIL: JSON parse failed. finishReason=$finishReason chunks=$chunkCount")
                    Log.w(TAG, "PARSE_FAIL raw output: $rawJson")

                    // Salvage attempt 1: try to extract answer_text from partial JSON
                    // before falling back to INSUFFICIENT. Regex tolerates a missing
                    // closing quote/brace — captures everything after "answer_text":".
                    val salvaged = runCatching {
                        val m = Regex(""""answer_text"\s*:\s*"((?:[^"\\]|\\.)*)""").find(rawJson)
                        m?.groupValues?.get(1)?.takeIf { it.isNotBlank() }
                    }.getOrNull()

                    if (salvaged != null) {
                        // We have partial answer text; pass it up and let the JS
                        // checkGrounding() term-match decide if it's usable.
                        Log.w(TAG, "PARSE_FAIL salvaged answer_text (${salvaged.length} chars): ${salvaged.take(80)}")
                        answerText = salvaged
                        // Can't trust groundedness_signal if JSON was truncated;
                        // leave it to the JS checkGrounding() gate.
                        groundednessSignal = "PARTIAL"
                        sourceChunkIds = emptyList()
                    } else {
                        // Salvage attempt 2: check if rawJson is plain "INSUFFICIENT_EVIDENCE"
                        // (model ignored schema and returned raw text).
                        if (rawJson.trim().startsWith("INSUFFICIENT_EVIDENCE")) {
                            Log.w(TAG, "PARSE_FAIL: model returned plain INSUFFICIENT_EVIDENCE text (no JSON)")
                            answerText = "INSUFFICIENT_EVIDENCE"
                            groundednessSignal = "INSUFFICIENT"
                            sourceChunkIds = emptyList()
                        } else {
                            // Nothing salvageable — pass raw text up; JS grounding check runs.
                            Log.w(TAG, "PARSE_FAIL: no salvageable content, passing raw text to JS grounding check")
                            answerText = rawJson.trim()
                            groundednessSignal = "PARTIAL"
                            sourceChunkIds = emptyList()
                        }
                    }
                }

                val sourceArray = JSArray()
                sourceChunkIds.forEach { sourceArray.put(it) }

                val result = JSObject()
                result.put("text", answerText)
                result.put("tokenCount", if (completionTokens > 0) completionTokens.toInt() else chunkCount)
                result.put("durationMs", elapsed)
                result.put("tokensPerSecond", tokensPerSecond.toDouble())
                result.put("groundednessSignal", groundednessSignal)
                result.put("sourceChunkIds", sourceArray)
                result.put("finishReason", finishReason?.name ?: "UNKNOWN")
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "generate failed", e)
                call.reject("LEAP generation error: ${e.message}")
            }
        }
    }

    fun isModelLoaded(call: PluginCall) {
        val result = JSObject()
        result.put("loaded", modelRunner != null)
        call.resolve(result)
    }

    fun unloadModel(call: PluginCall) {
        scope.launch {
            runCatching { modelRunner?.unload() }
            modelRunner = null
            Log.i(TAG, "LEAP model unloaded")
            val result = JSObject()
            result.put("success", true)
            call.resolve(result)
        }
    }

    fun translate(call: PluginCall) {
        val runner = modelRunner
        if (runner == null) {
            call.reject("Model not loaded. Call loadModel() first.")
            return
        }
        val text = call.getString("text")
        val sourceLang = call.getString("sourceLanguage") ?: "unknown"
        if (text.isNullOrEmpty()) {
            call.reject("text is required")
            return
        }
        val maxChunks = call.getInt("maxTokens", 128)!!
        val temperature = call.getFloat("temperature", 0.1f)!!

        scope.launch {
            try {
                val startTime = System.currentTimeMillis()

                val conversation = runner.createConversation(TRANSLATION_SYSTEM_PROMPT)
                val genOptions = GenerationOptions(
                    temperature = temperature,
                    topP = TOP_P,
                    minP = MIN_P,
                    repetitionPenalty = REPETITION_PENALTY,
                    // No jsonSchemaConstraint — raw translation string expected.
                    // functionCallParser=null: translation queries ("translate this Hausa
                    // medical query") can superficially resemble commands; intercepted
                    // tool-call tokens would produce empty translatedText.
                    functionCallParser = null,
                )

                val langName = languageCodeToName(sourceLang)
                val userContent = "Translate this $langName medical query to English:\n$text"

                val outputBuilder = StringBuilder()
                var chunkCount = 0

                conversation.generateResponse(userContent, genOptions)
                    .transformWhile { response ->
                        emit(response)
                        when (response) {
                            is MessageResponse.Chunk -> {
                                chunkCount++
                                chunkCount < maxChunks
                            }
                            is MessageResponse.Complete -> false
                            else -> true
                        }
                    }
                    .collect { response ->
                        if (response is MessageResponse.Chunk) {
                            outputBuilder.append(response.text)
                        }
                    }

                val elapsed = System.currentTimeMillis() - startTime
                Log.i(TAG, "Translation completed in ${elapsed}ms | chunks=$chunkCount")

                val result = JSObject()
                result.put("translatedText", outputBuilder.toString().trim())
                result.put("durationMs", elapsed)
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "translate failed", e)
                call.reject("LEAP translation error: ${e.message}")
            }
        }
    }

    fun getModelInfo(call: PluginCall) {
        val path = modelPath()
        val file = File(path)
        val result = JSObject()
        result.put("exists", file.exists())
        result.put("path", path)
        result.put("sizeMB", if (file.exists()) file.length() / (1024 * 1024) else 0)
        result.put("loaded", modelRunner != null)
        call.resolve(result)
    }

    fun destroy() {
        scope.launch {
            runCatching { modelRunner?.unload() }
            modelRunner = null
        }
    }

    private fun modelPath(): String =
        File(context.filesDir, "$LEAP_MODEL_DIR/$LEAP_MODEL_FILE").absolutePath

    /**
     * JSON Schema for LEAP's jsonSchemaConstraint (decode-time enforcement).
     * Must stay in sync with MediChatResponse.kt.
     *
     * Field order: groundedness_signal → source_chunk_ids → answer_text.
     * The two cheap fields are committed before the long answer_text string
     * starts, so if the token ceiling fires during answer_text generation the
     * salvage regex in the else-branch can still recover the partial answer.
     *
     * maxLength: 600 is included but LEAP SDK may silently ignore it depending
     * on version. The token ceiling (maxChunks) is the authoritative gate.
     */
    private fun buildMediChatJsonSchema(): String =
        buildJsonObject {
            put("type", "object")
            putJsonObject("properties") {
                putJsonObject("groundedness_signal") {
                    put("type", "string")
                    putJsonArray("enum") {
                        add(JsonPrimitive("GROUNDED"))
                        add(JsonPrimitive("PARTIAL"))
                        add(JsonPrimitive("INSUFFICIENT"))
                    }
                }
                putJsonObject("source_chunk_ids") {
                    put("type", "array")
                    putJsonObject("items") { put("type", "string") }
                }
                putJsonObject("answer_text") {
                    put("type", "string")
                    put("maxLength", 600)
                }
            }
            putJsonArray("required") {
                add(JsonPrimitive("groundedness_signal"))
                add(JsonPrimitive("source_chunk_ids"))
                add(JsonPrimitive("answer_text"))
            }
            put("additionalProperties", false)
        }.toString()
}
