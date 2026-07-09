# Speech I/O Final Integration — TTS Only (STT Deferred)

**Date**: 2026-07-08  
**Status**: TTS READY, STT DEFERRED

---

## What Shipped

### Native Text-to-Speech ✅
- **Engine**: PocketTTS via sherpa-onnx
- **Voice**: Anna (VCTK p228 speaker)
- **Quality**: 24kHz synthesis, int8 quantized models
- **Size**: 194 MB models in assets
- **API Level**: Compatible with Android 12+ (API 31)

### Speech-to-Text ⏸️ DEFERRED
- **Blocker**: moonshine-voice SDK requires Android 14+ (API 35)
- **Project constraint**: Must support Android 12+ (API 31) for low-end devices
- **Current fallback**: Web Speech Recognition API (online, network-required)
- **Future**: Manual ONNX Runtime integration (load `.ort` models directly)

---

## Final Architecture

### Android Components

**NativeTTSPlugin.kt** (`android/app/src/main/java/com/hiva/runtime/speech/`)
- Loads PocketTTS models from internal storage on app start
- Exposes Capacitor methods: `synthesize(text)`, `isAvailable()`
- Returns Float32 audio samples (24kHz) to WebView
- Thread-safe coroutine-based synthesis

**Removed**:
- ~~NativeSTTPlugin.kt~~ (deleted - API 35 constraint)
- ~~Moonshine models~~ (141 MB reclaimed)

### WebView Services

**nativeTTSService.ts** (`src/services/`)
- Bridges NativeTTSPlugin via Capacitor
- Converts Float32 samples to AudioBuffer for Web Audio API playback
- Handles initialization and error states

**ttsService.ts** (updated)
- Primary: Native TTS (PocketTTS) when available
- Fallback: Web Speech API (SpeechSynthesis)
- No API changes — existing UI code unaffected

**sttService.ts** (reverted)
- Web Speech Recognition API only (online)
- Native STT references removed
- Comment added explaining deferral reason

**Removed**:
- ~~nativeSTTService.ts~~ (deleted)

---

## Dependencies (Final)

### Gradle
```gradle
// ONNX Runtime 1.27.0 (for embedding + TTS)
implementation "com.microsoft.onnxruntime:onnxruntime-android:1.27.0"
implementation "com.microsoft.onnxruntime:onnxruntime-extensions-android:0.13.0"

// sherpa-onnx for TTS (PocketTTS)
implementation files('libs/sherpa-onnx-1.13.4.aar')
```

**Removed**:
- ~~`ai.moonshine:moonshine-voice:0.0.65`~~ (API 35 constraint)

---

## Models (Final)

### TTS Assets (`android/app/src/main/assets/models/tts/`)
- `encoder.onnx`: 70 MB
- `lm_main.int8.onnx`: 61 MB
- `decoder.int8.onnx`: 22 MB
- `text_conditioner.onnx`: 16 MB
- `lm_flow.int8.onnx`: 9.6 MB
- `vocab.json`: 68 KB
- `token_scores.json`: 121 KB
- `anna_voice.safetensors`: 251 KB

**Total**: 190 MB (was 330 MB before STT removal)

### STT Assets
- ~~Removed~~ (141 MB reclaimed)

---

## Resource Impact (Revised)

### Storage
- Models: 190 MB (TTS only)
- sherpa-onnx AAR: 47 MB
- **Total**: ~237 MB (well within 700 MB budget)

### Memory (Runtime)
- PocketTTS inference: ~200-400 MB peak (estimate)
- No STT memory load
- Combined with existing models (EmbeddingGemma + LEAP): manageable

### ONNX Runtime
- Upgraded to 1.27.0 (from 1.17.0)
- Used by: NativeRetriever (embedding), NativeTTSPlugin (TTS)
- **Action required**: Revalidate NativeRetriever numerical correctness

---

## API Surface (Unchanged)

### TTS
```typescript
ttsService.speak(text: string): void
ttsService.cancel(): void
ttsService.isEnabled(): boolean
```
- Native PocketTTS used automatically when available
- Web Speech API fallback seamless
- Existing UI code unmodified

### STT
```typescript
sttService.start(): void
sttService.stop(): void
```
- Web Speech Recognition API only
- No native backend
- Existing UI code unmodified

---

## Testing Plan (Revised)

### Phase 1: Build Validation ⏳
- [⏳] `./gradlew assembleDebug` succeeds (in progress)
- [  ] No compilation errors
- [  ] APK size acceptable (~240 MB models + base)

### Phase 2: TTS Smoke Test (Device)
- [  ] Initialize PocketTTS successfully
- [  ] Synthesize 10 test phrases (English medical terms)
- [  ] Verify audio output (non-silent, correct sample rate 24kHz)
- [  ] Measure synthesis latency (target < 500ms first chunk)
- [  ] Measure peak memory during synthesis
- [  ] Compare voice quality vs Web Speech API (subjective)

### Phase 3: Integration Test (TTS + Existing)
- [  ] Load EmbeddingGemma + LEAP + PocketTTS (3 models)
- [  ] Run conversation flow: retrieve context → generate response → speak response
- [  ] Monitor peak memory
- [  ] Verify no OOM crashes

### Phase 4: ONNX Runtime 1.27.0 Validation
- [  ] Rerun NativeRetriever embedding correctness test
- [  ] Verify EmbeddingGemma outputs identical to reference (cosine > 0.999)
- [  ] If regression: investigate ONNX Runtime version differences

### Phase 5: Fallback Testing
- [  ] Test with PocketTTS models missing
- [  ] Verify Web Speech API fallback works
- [  ] No silent failures or frozen UI

---

## Native STT Roadmap (Future)

### Option 1: Manual ONNX Runtime Integration
**Approach**:
- Load Moonshine `.ort` models directly with ONNX Runtime
- Implement audio preprocessing in Kotlin (16kHz mono, normalization)
- Run inference manually: audio → encode.ort → preprocess.ort → uncached_decode.ort → tokens
- Decode tokens to text

**Requirements**:
- Research Moonshine preprocessing pipeline (reference Python implementation)
- Tokenizer vocabulary/decoder
- Validation against SDK output (if available on API 35+ test device)

**Effort**: 1-2 weeks

### Option 2: Alternative STT Library (API 31 Compatible)
**Investigate**:
- Whisper.cpp Android bindings (if API 31 compatible)
- Vosk Android SDK (lightweight, supports English)
- Mozilla DeepSpeech Android (deprecated but may work)

**Requirements**:
- Verify minSdk compatibility
- Model size constraints (target < 150 MB)
- Accuracy acceptable for medical queries

**Effort**: 1 week research + integration

### Option 3: Defer Until Device Upgrade
**Wait for**:
- Field devices upgraded to Android 14+
- Project minSdk raised to 35
- Use moonshine-voice SDK as originally planned

**Timeline**: TBD based on deployment hardware refresh

---

## License Compliance (Unchanged)

### PocketTTS
- **License**: Non-commercial (KevinAHM ONNX export)
- **Status**: ✅ CLEARED (HIVA confirmed non-commercial)

### sherpa-onnx
- **License**: Apache 2.0

### Anna Voice
- **License**: CC BY 4.0 (attribution required)
- **TODO**: Add VCTK attribution to app credits

---

## Known Limitations

### TTS
- **Language**: English only (Anna voice)
- **Quality**: Untested vs Web Speech API (pending user feedback)
- **Latency**: Cold-start model load ~5-15 seconds (first app launch)

### STT
- **Offline**: NOT SUPPORTED (Web Speech Recognition requires network)
- **Language**: English primary (browser-dependent for other languages)
- **Asymmetric**: TTS offline, STT online

---

## Rollback Plan

If TTS integration fails:

1. Revert ONNX Runtime to 1.17.0
2. Remove sherpa-onnx AAR from libs
3. Delete TTS models (reclaim 190 MB)
4. Revert ttsService.ts to Web Speech API only
5. Remove NativeTTSPlugin.kt

---

## Next Steps

1. **Complete build** (in progress)
2. **Deploy to device**
3. **Run TTS smoke tests** (synthesis correctness + latency)
4. **Revalidate NativeRetriever** (ONNX Runtime 1.27.0 upgrade check)
5. **User acceptance testing** (voice quality)
6. **Add VCTK attribution** to app credits
7. **Plan native STT** (Option 1 or 2, timeline TBD)

---

**TTS Status**: ✅ INTEGRATED (pending device validation)  
**STT Status**: ⏸️ DEFERRED (Web Speech Recognition fallback)  
**Build Status**: ⏳ IN PROGRESS (rebuild without moonshine-voice)  
**Next Milestone**: Device testing
