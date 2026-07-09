package com.hiva.runtime.speech

import android.content.Context
import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * NativeTTSPlugin — PocketTTS offline text-to-speech via sherpa-onnx
 *
 * Lifecycle:
 * - init() called on app start: copies models from assets to internal storage, initializes TTS engine
 * - synthesize(text) generates audio samples as Float32Array
 * - Audio playback handled by WebView layer (Web Audio API or native AudioTrack)
 * - Models loaded once, kept resident for low-latency synthesis
 */
@CapacitorPlugin(name = "NativeTTS")
class NativeTTSPlugin : Plugin() {
    private var tts: OfflineTts? = null
    private val scope = CoroutineScope(Dispatchers.Default)

    companion object {
        private const val TAG = "NativeTTS"
        private const val MODELS_DIR = "models/tts"
        private const val SAMPLE_RATE = 24000 // PocketTTS default
    }

    override fun load() {
        super.load()
        scope.launch {
            try {
                initializeTTS()
                Log.i(TAG, "PocketTTS initialized successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize PocketTTS: ${e.message}", e)
            }
        }
    }

    private suspend fun initializeTTS() = withContext(Dispatchers.IO) {
        val context = activity.applicationContext
        val modelsDir = prepareModels(context)

        // PocketTTS model configuration (all 7 model files + cache capacity)
        val pocketConfig = OfflineTtsPocketModelConfig(
            lmFlow = "$modelsDir/lm_flow.int8.onnx",
            lmMain = "$modelsDir/lm_main.int8.onnx",
            encoder = "$modelsDir/encoder.onnx",
            decoder = "$modelsDir/decoder.int8.onnx",
            textConditioner = "$modelsDir/text_conditioner.onnx",
            vocabJson = "$modelsDir/vocab.json",
            tokenScoresJson = "$modelsDir/token_scores.json",
            voiceEmbeddingCacheCapacity = 1  // Cache 1 voice (Anna)
        )

        val modelConfig = OfflineTtsModelConfig(
            pocket = pocketConfig,
            numThreads = 2,
            debug = false,
            provider = "cpu"
        )

        val ttsConfig = OfflineTtsConfig(
            model = modelConfig,
            ruleFsts = "",  // No text normalization rules
            maxNumSentences = 1  // Process one sentence at a time
        )

        // Initialize TTS with config and asset manager
        tts = OfflineTts(context.assets, ttsConfig)

        // Verify sample rate
        val actualSampleRate = tts?.sampleRate() ?: 0
        if (actualSampleRate != SAMPLE_RATE) {
            Log.w(TAG, "Expected sample rate $SAMPLE_RATE, got $actualSampleRate")
        }
    }

    private fun prepareModels(context: Context): String {
        val outputDir = File(context.filesDir, MODELS_DIR)
        if (outputDir.exists() && outputDir.list()?.size ?: 0 >= 7) {
            // Models already copied (7 files: 5 onnx + 2 json + 1 safetensors)
            return outputDir.absolutePath
        }

        outputDir.mkdirs()

        // Copy all model files from assets
        val assetManager = context.assets
        val modelFiles = listOf(
            "encoder.onnx",
            "decoder.int8.onnx",
            "lm_main.int8.onnx",
            "lm_flow.int8.onnx",
            "text_conditioner.onnx",
            "vocab.json",
            "token_scores.json",
            "anna_voice.safetensors"
        )

        for (fileName in modelFiles) {
            val assetPath = "$MODELS_DIR/$fileName"
            val outputFile = File(outputDir, fileName)

            if (!outputFile.exists()) {
                assetManager.open(assetPath).use { input ->
                    FileOutputStream(outputFile).use { output ->
                        input.copyTo(output)
                    }
                }
                Log.d(TAG, "Copied $fileName (${outputFile.length() / 1024} KB)")
            }
        }

        return outputDir.absolutePath
    }

    @PluginMethod
    fun synthesize(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrBlank()) {
            call.reject("Text parameter required")
            return
        }

        scope.launch {
            try {
                val audioData = synthesizeAudio(text)
                call.resolve(
                    com.getcapacitor.JSObject().apply {
                        put("samples", audioData.toTypedArray())
                        put("sampleRate", SAMPLE_RATE)
                        put("numSamples", audioData.size)
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Synthesis failed: ${e.message}", e)
                call.reject("Synthesis failed: ${e.message}", e)
            }
        }
    }

    private suspend fun synthesizeAudio(text: String): FloatArray = withContext(Dispatchers.Default) {
        val engine = tts ?: throw IllegalStateException("TTS not initialized")

        // Generate audio with Anna voice
        val audio = engine.generate(
            text = text,
            sid = 0,  // Speaker ID (0 for default/anna)
            speed = 1.0f
        )

        if (audio.samples.isEmpty()) {
            throw IllegalStateException("TTS generated empty audio")
        }

        Log.d(TAG, "Synthesized ${audio.samples.size} samples (${audio.samples.size / SAMPLE_RATE}s)")
        return@withContext audio.samples
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(
            com.getcapacitor.JSObject().apply {
                put("available", tts != null)
                put("sampleRate", SAMPLE_RATE)
            }
        )
    }

    override fun handleOnDestroy() {
        tts?.release()
        tts = null
        super.handleOnDestroy()
    }
}
