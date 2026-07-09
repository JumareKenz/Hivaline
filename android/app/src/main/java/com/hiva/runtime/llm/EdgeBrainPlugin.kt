package com.hiva.runtime.llm

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hiva.runtime.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File

/**
 * Capacitor plugin for on-device LLM inference.
 *
 * Routes to one of two backends based on the USE_LEAP_BACKEND build flag:
 *   false (default) → llama.cpp / JNI / Qwen2.5-1.5B  [original path, untouched]
 *   true            → LEAP SDK / LFM2.5-350M fine-tune [new path, EdgeBrainLeapDelegate]
 *
 * Both backends expose the same Capacitor method surface so the TypeScript
 * edgeBrainService.ts requires no structural changes. The LEAP path adds two
 * extra fields to the generate result (groundednessSignal, sourceChunkIds) that
 * the TS layer can consume optionally.
 *
 * DO NOT switch USE_LEAP_BACKEND to true until Step D parallel-run validation
 * has passed (golden-set regression, adversarial INSUFFICIENT_EVIDENCE tests,
 * latency/resource test, and translation regression test).
 */
@CapacitorPlugin(name = "EdgeBrain")
class EdgeBrainPlugin : Plugin() {

    companion object {
        private const val TAG = "EdgeBrain"

        // --- Qwen / llama.cpp path constants (unchanged) ---
        private const val MODEL_DIR = "models/edge-brain"
        private const val MODEL_FILE = "model.gguf"
        private const val DEFAULT_MAX_TOKENS = 256
        private const val DEFAULT_TEMPERATURE = 0.1f
        private const val DEFAULT_TOP_P = 0.9f
        private const val DEFAULT_REPEAT_PENALTY = 1.1f

        init {
            if (!BuildConfig.USE_LEAP_BACKEND) {
                System.loadLibrary("llama")
                System.loadLibrary("edgebrain_jni")
            }
        }
    }

    // Qwen / JNI state (active only when USE_LEAP_BACKEND = false)
    private var modelPtr: Long = 0L
    private var contextPtr: Long = 0L

    // LEAP delegate (active only when USE_LEAP_BACKEND = true)
    private var leapDelegate: EdgeBrainLeapDelegate? = null

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // -------------------------------------------------------------------------
    // Capacitor plugin lifecycle
    // -------------------------------------------------------------------------

    override fun load() {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate = EdgeBrainLeapDelegate(context, scope)
            Log.i(TAG, "EdgeBrain using LEAP/LFM2.5-350M backend")
        } else {
            Log.i(TAG, "EdgeBrain using llama.cpp/Qwen backend")
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate?.destroy()
        } else {
            if (contextPtr != 0L) nativeFreeContext(contextPtr)
            if (modelPtr != 0L) nativeFreeModel(modelPtr)
            contextPtr = 0L
            modelPtr = 0L
        }
    }

    // -------------------------------------------------------------------------
    // Plugin methods — delegate based on flag
    // -------------------------------------------------------------------------

    @PluginMethod
    fun loadModel(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.loadModel(call)
            return
        }
        // Original Qwen / llama.cpp path — unchanged
        scope.launch {
            try {
                val modelPath = getQwenModelPath()
                if (!File(modelPath).exists()) {
                    call.reject("Model file not found at: $modelPath")
                    return@launch
                }
                val startTime = System.currentTimeMillis()
                modelPtr = nativeLoadModel(modelPath)
                if (modelPtr == 0L) {
                    call.reject("Failed to load model")
                    return@launch
                }
                contextPtr = nativeCreateContext(modelPtr, 4096)
                if (contextPtr == 0L) {
                    nativeFreeModel(modelPtr)
                    modelPtr = 0L
                    call.reject("Failed to create inference context")
                    return@launch
                }
                val elapsed = System.currentTimeMillis() - startTime
                Log.i(TAG, "Qwen model loaded in ${elapsed}ms")
                val result = JSObject()
                result.put("success", true)
                result.put("loadTimeMs", elapsed)
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "loadModel failed", e)
                call.reject("Model load error: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.generate(call)
            return
        }
        // Original Qwen / llama.cpp path — unchanged
        if (modelPtr == 0L || contextPtr == 0L) {
            call.reject("Model not loaded. Call loadModel() first.")
            return
        }
        val prompt = call.getString("prompt")
        if (prompt.isNullOrEmpty()) {
            call.reject("prompt is required")
            return
        }
        val maxTokens = call.getInt("maxTokens", DEFAULT_MAX_TOKENS)!!
        val temperature = call.getFloat("temperature", DEFAULT_TEMPERATURE)!!
        val topP = call.getFloat("topP", DEFAULT_TOP_P)!!
        val repeatPenalty = call.getFloat("repeatPenalty", DEFAULT_REPEAT_PENALTY)!!
        val stopSequences = call.getArray("stopSequences")
            ?.toList<String>()
            ?.toTypedArray()
            ?: arrayOf("<|im_end|>", "<|endoftext|>")

        scope.launch {
            try {
                val startTime = System.currentTimeMillis()
                val output = nativeGenerate(
                    contextPtr, prompt, maxTokens,
                    temperature, topP, repeatPenalty, stopSequences
                )
                val elapsed = System.currentTimeMillis() - startTime
                val tokenCount = nativeGetLastTokenCount()
                val tokensPerSecond = if (elapsed > 0) (tokenCount * 1000.0 / elapsed) else 0.0
                Log.i(TAG, "Generated $tokenCount tokens in ${elapsed}ms (${String.format("%.1f", tokensPerSecond)} tok/s)")
                val result = JSObject()
                result.put("text", output)
                result.put("tokenCount", tokenCount)
                result.put("durationMs", elapsed)
                result.put("tokensPerSecond", tokensPerSecond)
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "generate failed", e)
                call.reject("Generation error: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.isModelLoaded(call)
            return
        }
        val result = JSObject()
        result.put("loaded", modelPtr != 0L && contextPtr != 0L)
        call.resolve(result)
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.unloadModel(call)
            return
        }
        if (contextPtr != 0L) {
            nativeFreeContext(contextPtr)
            contextPtr = 0L
        }
        if (modelPtr != 0L) {
            nativeFreeModel(modelPtr)
            modelPtr = 0L
        }
        Log.i(TAG, "Qwen model unloaded")
        val result = JSObject()
        result.put("success", true)
        call.resolve(result)
    }

    @PluginMethod
    fun translate(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.translate(call)
            return
        }
        // Qwen/JNI path — dedicated translation prompt, no grounding schema
        if (modelPtr == 0L || contextPtr == 0L) {
            call.reject("Model not loaded. Call loadModel() first.")
            return
        }
        val text = call.getString("text")
        val sourceLang = call.getString("sourceLanguage") ?: "unknown"
        if (text.isNullOrEmpty()) {
            call.reject("text is required")
            return
        }
        val maxTokens = call.getInt("maxTokens", 128)!!
        val temperature = call.getFloat("temperature", 0.1f)!!
        val prompt = buildTranslationPrompt(text, sourceLang)
        val stopSequences = arrayOf("<|im_end|>", "\n\n", "Translation:")

        scope.launch {
            try {
                val startTime = System.currentTimeMillis()
                val output = nativeGenerate(
                    contextPtr, prompt, maxTokens,
                    temperature, DEFAULT_TOP_P, DEFAULT_REPEAT_PENALTY, stopSequences
                )
                val elapsed = System.currentTimeMillis() - startTime
                val result = JSObject()
                result.put("translatedText", output.trim())
                result.put("durationMs", elapsed)
                call.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "translate failed", e)
                call.reject("Translation error: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun getModelInfo(call: PluginCall) {
        if (BuildConfig.USE_LEAP_BACKEND) {
            leapDelegate!!.getModelInfo(call)
            return
        }
        val modelPath = getQwenModelPath()
        val file = File(modelPath)
        val result = JSObject()
        result.put("exists", file.exists())
        result.put("path", modelPath)
        result.put("sizeMB", if (file.exists()) file.length() / (1024 * 1024) else 0)
        result.put("loaded", modelPtr != 0L)
        call.resolve(result)
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun getQwenModelPath(): String {
        return File(context.filesDir, "$MODEL_DIR/$MODEL_FILE").absolutePath
    }

    private fun buildTranslationPrompt(text: String, sourceLanguage: String): String {
        val langName = when (sourceLanguage) {
            "ha" -> "Hausa"
            "yo" -> "Yoruba"
            "ig" -> "Igbo"
            "pid" -> "Nigerian Pidgin"
            else -> "non-English"
        }
        return "<|im_start|>system\n" +
            "You are a medical translation assistant. Translate the $langName query to English. " +
            "Output ONLY the English translation. Preserve medical terms exactly. " +
            "No explanations, no prefixes.\n<|im_end|>\n" +
            "<|im_start|>user\n$text\n<|im_end|>\n" +
            "<|im_start|>assistant\n"
    }

    // JNI bindings — only linked/called when USE_LEAP_BACKEND = false
    private external fun nativeLoadModel(path: String): Long
    private external fun nativeCreateContext(modelPtr: Long, contextSize: Int): Long
    private external fun nativeFreeModel(modelPtr: Long)
    private external fun nativeFreeContext(contextPtr: Long)
    private external fun nativeGenerate(
        contextPtr: Long,
        prompt: String,
        maxTokens: Int,
        temperature: Float,
        topP: Float,
        repeatPenalty: Float,
        stopSequences: Array<String>
    ): String
    private external fun nativeGetLastTokenCount(): Int
}
