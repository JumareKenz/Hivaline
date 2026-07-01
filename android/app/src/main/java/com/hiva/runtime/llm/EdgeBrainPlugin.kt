package com.hiva.runtime.llm

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.io.File

/**
 * Capacitor plugin wrapping llama.cpp for on-device LLM inference.
 * Model: Qwen2.5-1.5B-Instruct (Q4_0_4_4 GGUF, ~990 MB)
 *
 * The model file lives in the app's internal files directory at
 * files/models/edge-brain/model.gguf — placed there by a one-time
 * asset copy or download on first launch.
 */
@CapacitorPlugin(name = "EdgeBrain")
class EdgeBrainPlugin : Plugin() {

    companion object {
        private const val TAG = "EdgeBrain"
        private const val MODEL_DIR = "models/edge-brain"
        private const val MODEL_FILE = "model.gguf"

        // Generation defaults
        private const val DEFAULT_MAX_TOKENS = 256
        private const val DEFAULT_TEMPERATURE = 0.1f
        private const val DEFAULT_TOP_P = 0.9f
        private const val DEFAULT_REPEAT_PENALTY = 1.1f

        init {
            System.loadLibrary("llama")
            System.loadLibrary("edgebrain_jni")
        }
    }

    private var modelPtr: Long = 0L
    private var contextPtr: Long = 0L
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    @PluginMethod
    fun loadModel(call: PluginCall) {
        scope.launch {
            try {
                val modelPath = getModelPath()
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
                Log.i(TAG, "Model loaded in ${elapsed}ms")

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
                    contextPtr,
                    prompt,
                    maxTokens,
                    temperature,
                    topP,
                    repeatPenalty,
                    stopSequences
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
        val result = JSObject()
        result.put("loaded", modelPtr != 0L && contextPtr != 0L)
        call.resolve(result)
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        if (contextPtr != 0L) {
            nativeFreeContext(contextPtr)
            contextPtr = 0L
        }
        if (modelPtr != 0L) {
            nativeFreeModel(modelPtr)
            modelPtr = 0L
        }
        Log.i(TAG, "Model unloaded")
        val result = JSObject()
        result.put("success", true)
        call.resolve(result)
    }

    @PluginMethod
    fun getModelInfo(call: PluginCall) {
        val modelPath = getModelPath()
        val file = File(modelPath)
        val result = JSObject()
        result.put("exists", file.exists())
        result.put("path", modelPath)
        result.put("sizeMB", if (file.exists()) file.length() / (1024 * 1024) else 0)
        result.put("loaded", modelPtr != 0L)
        call.resolve(result)
    }

    override fun handleOnDestroy() {
        scope.cancel()
        if (contextPtr != 0L) nativeFreeContext(contextPtr)
        if (modelPtr != 0L) nativeFreeModel(modelPtr)
        contextPtr = 0L
        modelPtr = 0L
    }

    private fun getModelPath(): String {
        val filesDir = context.filesDir
        return File(filesDir, "$MODEL_DIR/$MODEL_FILE").absolutePath
    }

    // JNI bindings to llama.cpp wrapper
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
