# Speech I/O Integration Summary

**Date**: 2026-07-08  
**Status**: INTEGRATION COMPLETE (pending build validation)

---

## Components Added

### Android Native Plugins

**NativeTTSPlugin.kt** (`android/app/src/main/java/com/hiva/runtime/speech/`)
- PocketTTS via sherpa-onnx for text-to-speech
- Anna voice (VCTK p228 speaker)
- 24kHz sample rate output
- Capacitor bridge methods: `synthesize(text)`, `isAvailable()`
- Models loaded on app start from internal storage
- Returns Float32 audio samples to WebView

**NativeSTTPlugin.kt** (`android/app/src/main/java/com/hiva/runtime/speech/`)
- Moonshine Tiny for speech-to-text (English only)
- 16kHz mono audio input via AudioRecord
- Microphone permission handling
- Capacitor bridge methods: `startListening()`, `stopListening()`, `isAvailable()`
- Event listeners: `onListeningStarted`, `onTranscript`

### WebView Service Bridges

**nativeTTSService.ts** (`src/services/`)
- Interfaces with NativeTTSPlugin via Capacitor
- Converts Float32 samples to AudioBuffer for Web Audio API playback
- Graceful degradation if native unavailable

**nativeSTTService.ts** (`src/services/`)
- Interfaces with NativeSTTPlugin via Capacitor
- State management: idle → listening → processing → result → error
- Event subscription for transcript callbacks

### Updated Existing Services

**ttsService.ts**
- **Before**: Web Speech API only
- **After**: Native TTS (PocketTTS) primary, Web Speech API fallback
- Same API surface (no breaking changes)
- Automatically selects native when available

**sttService.ts**
- **Before**: Web Speech Recognition API only
- **After**: Native STT (Moonshine) primary, Web Speech Recognition fallback
- Same API surface (no breaking changes)
- Automatically selects native when available

---

## Dependencies Added

### Gradle (android/app/build.gradle)

```gradle
// ONNX Runtime upgraded to 1.27.0 (unified version)
implementation "com.microsoft.onnxruntime:onnxruntime-android:1.27.0"

// sherpa-onnx for TTS (PocketTTS)
implementation files('libs/sherpa-onnx-1.13.4.aar')

// moonshine-voice for STT
implementation "ai.moonshine:moonshine-voice:0.0.65"
```

**AAR copied**: `android/app/libs/sherpa-onnx-1.13.4.aar` (47 MB)

---

## Models Downloaded

### TTS Models (`android/app/src/main/assets/models/tts/`)

- `encoder.onnx`: 70 MB
- `lm_main.int8.onnx`: 61 MB (int8 quantized)
- `decoder.int8.onnx`: 22 MB (int8 quantized)
- `text_conditioner.onnx`: 16 MB
- `lm_flow.int8.onnx`: 9.6 MB (int8 quantized)
- `vocab.json`: 68 KB
- `token_scores.json`: 121 KB
- `anna_voice.safetensors`: 251 KB

**Total TTS**: ~190 MB

### STT Models (`android/app/src/main/assets/models/stt/`)

- `encode.ort`: 24 MB
- `preprocess.ort`: 6.6 MB
- `uncached_decode.ort`: 111 MB (non-streaming variant)

**Total STT**: ~141 MB

**Combined assets**: 330 MB (within 700 MB budget)

---

## Resource Impact

### Storage
- Models in assets: 330 MB
- sherpa-onnx AAR: 47 MB (includes 31 MB ARM64 native libs)
- moonshine-voice SDK: ~10 MB (estimate)
- **Total new footprint**: ~387 MB

### Memory (Runtime)
- **Unknown until device testing**
- Conservative estimates:
  - PocketTTS inference: 200-400 MB peak
  - Moonshine inference: 150-300 MB peak
  - Recommended: Sequential execution (unload when not in use)

### ONNX Runtime Conflict Resolution
- **Upgraded** from 1.17.0 to 1.27.0 uniformly
- sherpa-onnx bundles ONNX Runtime 1.27.0 (21.7 MB)
- moonshine-voice uses same runtime (compatible)
- **Action required**: Revalidate NativeRetriever (EmbeddingGemma) numerical correctness after upgrade

---

## Integration Flow

### Text-to-Speech
1. User action triggers `ttsService.speak(text)`
2. Service checks `nativeTTSService.isAvailable()`
3. If native available:
   - Call `NativeTTSPlugin.synthesize(text)`
   - Receive Float32 samples + sample rate
   - Convert to AudioBuffer
   - Play via Web Audio API
4. If native unavailable:
   - Fallback to Web Speech API (SpeechSynthesis)

### Speech-to-Text
1. User action triggers `sttService.start()`
2. Service checks `nativeSTTService.isAvailable()`
3. If native available:
   - Request microphone permission
   - Call `NativeSTTPlugin.startListening()`
   - AudioRecord captures 16kHz mono PCM
   - User stops recording
   - Call `NativeSTTPlugin.stopListening()`
   - Moonshine transcribes audio
   - Return transcript
4. If native unavailable:
   - Fallback to Web Speech Recognition API

---

## API Surface (Unchanged)

### TTS
```typescript
ttsService.speak(text: string): void
ttsService.cancel(): void
ttsService.isEnabled(): boolean
ttsService.setEnabled(enabled: boolean): void
```

### STT
```typescript
sttService.start(): void
sttService.stop(): void
sttService.abort(): void
sttService.isSupported(): boolean
sttService.getTranscript(): string
sttService.subscribe(listener: STTListener): () => void
```

**No breaking changes** — existing UI code works unchanged.

---

## License Compliance

### PocketTTS
- **License**: Non-commercial (from KevinAHM ONNX export)
- **Status**: ✅ CLEARED (HIVA MediChat confirmed non-commercial)

### Moonshine
- **License**: Apache 2.0 (commercial use allowed)

### sherpa-onnx
- **License**: Apache 2.0

### Anna Voice (VCTK)
- **License**: CC BY 4.0 (attribution required)
- **Attribution added**: (TBD in app credits/about screen)

---

## Testing Requirements

### Phase 1: Build Validation (In Progress)
- [⏳] `./gradlew assembleDebug` succeeds
- [  ] No Kotlin compilation errors
- [  ] No ONNX Runtime version conflicts
- [  ] APK size within acceptable limits

### Phase 2: Smoke Tests (Device)
**TTS**:
- [  ] Initialize PocketTTS successfully
- [  ] Synthesize 10 test phrases (English medical terms)
- [  ] Verify audio output (non-silent, correct sample rate)
- [  ] Measure synthesis latency (target < 500ms first chunk)
- [  ] Measure peak memory during synthesis

**STT**:
- [  ] Initialize Moonshine successfully
- [  ] Request microphone permission (grant)
- [  ] Capture 5-second audio clip
- [  ] Transcribe pre-recorded English speech
- [  ] Verify transcript accuracy (WER < 10%)
- [  ] Measure transcription latency (target < 2s for 5s audio)
- [  ] Measure peak memory during transcription

### Phase 3: Integration Tests (Combined)
- [  ] Load all 4 models simultaneously (EmbeddingGemma + LEAP + PocketTTS + Moonshine)
- [  ] Run end-to-end conversation:
  - Speak query (STT)
  - Retrieve context (embedding + ObjectBox)
  - Generate response (LEAP)
  - Speak response (TTS)
- [  ] Monitor peak memory (target < 2GB total)
- [  ] Monitor latency per step
- [  ] Verify no OOM crashes
- [  ] Verify no thermal throttling

### Phase 4: Fallback Validation
- [  ] Test with native TTS unavailable (model files missing)
- [  ] Verify Web Speech API fallback works
- [  ] Test with native STT unavailable
- [  ] Verify Web Speech Recognition fallback works
- [  ] Confirm no silent failures or frozen UI

### Phase 5: Numerical Correctness (ONNX Runtime 1.27.0)
- [  ] Rerun NativeRetriever embedding correctness test
- [  ] Verify EmbeddingGemma outputs identical to reference
- [  ] Confirm cosine similarity > 0.999 for all test phrases
- [  ] If regression: investigate ONNX Runtime 1.17.0 → 1.27.0 differences

---

## Known Limitations

### Language Support
- **TTS**: English only (PocketTTS with Anna voice)
  - Nigerian languages: NOT SUPPORTED
  - Workaround: Use Web Speech API with browser's multilingual voices
- **STT**: English only (Moonshine Tiny)
  - Hausa/Yoruba/Igbo/Pidgin: NOT SUPPORTED
  - Future: Consider Whisper Tiny multilingual (39M params, +74MB)

### Voice Quality
- **Untested**: No A/B comparison with Web Speech API voices yet
- **Subjective**: Voice quality evaluation pending user feedback

### Model Loading Time
- **First launch**: Models copied from assets to internal storage (~330 MB)
- **Estimated**: 5-15 seconds cold-start delay
- **Subsequent launches**: Models loaded from internal storage

---

## Next Steps

1. **Await build completion** (in progress)
2. **Fix compilation errors** if any
3. **Deploy to device**
4. **Run smoke tests** (synthesis + transcription correctness)
5. **Run integration tests** (combined resource profiling)
6. **Revalidate NativeRetriever** (ONNX Runtime 1.27.0 upgrade)
7. **Measure latency/memory** (actual vs estimates)
8. **User acceptance testing** (voice quality, accuracy)
9. **Add VCTK attribution** to app credits

---

## Rollback Plan

If integration fails:

1. **Revert ONNX Runtime** to 1.17.0
2. **Remove speech dependencies** from build.gradle
3. **Delete model assets** (reclaim 330 MB)
4. **Revert ttsService.ts/sttService.ts** to Web Speech API only
5. **Remove NativeTTSPlugin.kt/NativeSTTPlugin.kt**

---

**Integration Status**: ✅ CODE COMPLETE  
**Build Status**: ⏳ IN PROGRESS  
**Device Testing**: ⏸️ PENDING BUILD SUCCESS
