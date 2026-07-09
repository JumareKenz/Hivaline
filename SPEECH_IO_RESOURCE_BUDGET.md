# Speech I/O Resource Budget — Final Measurements

**Date**: 2026-07-08  
**Configuration**: PocketTTS (Anna voice) + Moonshine Tiny (English-only)  
**Device Budget**: 700 MB acceptable

---

## Measured Model Sizes

### PocketTTS (int8 quantized)

**Download**: `sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2`
- Compressed: 94 MB
- **Extracted: 194 MB** (storage requirement)

**Model files**:
- `encoder.onnx`: 70 MB
- `lm_main.int8.onnx`: 61 MB (int8 quantized)
- `decoder.int8.onnx`: 22 MB (int8 quantized)
- `text_conditioner.onnx`: 16 MB
- `lm_flow.int8.onnx`: 9.6 MB (int8 quantized)
- `vocab.json` + `token_scores.json`: ~189 KB

**Anna voice embedding**: 
- Source: `kyutai/tts-voices/vctk/p228_023.wav.1e68beda@240.safetensors`
- Size: 250 KB (0.25 MB)

**Total PocketTTS**: 194 MB + 0.25 MB = **194.25 MB**

### Moonshine Tiny (8-bit quantized)

**Download**: From `UsefulSensors/moonshine/ort/tiny`
- `encode.ort`: 23.2 MB
- `cached_decode.ort`: 106.8 MB
- `preprocess.ort`: 6.5 MB
- `uncached_decode.ort`: 110.6 MB

**Deployment options**:
1. **Streaming (all 4 files)**: 247.0 MB
2. **Non-streaming (3 files)**: 23.2 + 6.5 + 110.6 = **140.3 MB**

**Selected**: Non-streaming (140.3 MB) — sufficient for query transcription, lower footprint

**Total Moonshine**: **140.3 MB**

### sherpa-onnx Android Library

**AAR**: `sherpa-onnx-1.13.4.aar`
- Total: 47 MB
- ARM64 native libs: ~31 MB
  - `libonnxruntime.so`: 21.7 MB
  - `libsherpa-onnx-jni.so`: 4.7 MB
  - `libsherpa-onnx-c-api.so`: 4.4 MB

**Total sherpa-onnx**: **47 MB**

### moonshine-voice Android SDK

**Maven artifact**: `ai.moonshine:moonshine-voice:0.0.65`
- Estimated: 5-10 MB (SDK only, models separate)
- Uses ONNX Runtime (may overlap with existing `onnxruntime-android:1.17.0`)

**Total moonshine-voice**: **~10 MB** (estimate)

---

## Total New Footprint

### Storage Requirements (APK/Assets)
- PocketTTS models: 194 MB
- Anna voice: 0.25 MB
- Moonshine Tiny: 140 MB
- sherpa-onnx AAR: 47 MB
- moonshine-voice SDK: ~10 MB

**Total storage**: **391 MB**

**Remaining budget**: 700 MB - 391 MB = **309 MB headroom** ✅

### Existing Runtime Context
- EmbeddingGemma-300M (q8): ~300 MB
- LEAP/LFM2.5-350M: ~350-700 MB (estimate)
- ObjectBox + HNSW indices: bundle-dependent
- ONNX Runtime: 21 MB (existing)

**Combined storage estimate**: 391 MB (new) + 300 MB (embedding) + 500 MB (LEAP est.) = **~1.2 GB total**

---

## Resource Conflicts

### ONNX Runtime Duplication

**Current project**: `com.microsoft.onnxruntime:onnxruntime-android:1.17.0`
- Already in `android/app/build.gradle`
- Size: ~21 MB ARM64

**sherpa-onnx bundles**: ONNX Runtime 1.27.0 (21.7 MB in AAR)

**Conflict resolution**:
1. **Option A**: Use sherpa-onnx's bundled ONNX Runtime 1.27.0
   - Remove existing `onnxruntime-android:1.17.0` dependency
   - Upgrade `onnxruntime-extensions-android` to 1.27.0-compatible version
   - **Risk**: NativeRetriever (EmbeddingGemma) may need revalidation with ONNX Runtime 1.27.0
2. **Option B**: Force sherpa-onnx to use existing ONNX Runtime 1.17.0
   - Exclude `libonnxruntime.so` from sherpa-onnx AAR
   - **Risk**: Version mismatch, sherpa-onnx may require 1.27.0 features
3. **Option C**: Keep both (duplicate ~21 MB)
   - Accept 21 MB duplication
   - No risk to existing features

**Recommendation**: Option A — upgrade to ONNX Runtime 1.27.0 uniformly
- Revalidate NativeRetriever numerical correctness after upgrade
- Benefits: Latest ONNX Runtime features, no duplication

**moonshine-voice**: Uses ONNX Runtime (likely compatible with 1.27.0)

---

## Memory Budget (Runtime)

**Unknown**: Peak memory usage for PocketTTS and Moonshine inference.

**Assumptions** (conservative):
- PocketTTS inference: ~200-400 MB peak (model weights + activations)
- Moonshine inference: ~150-300 MB peak (encoder + decoder activations)
- Combined peak (if simultaneous): ~350-700 MB

**Existing runtime**:
- EmbeddingGemma inference: ~300 MB (estimate)
- LEAP inference: ~400-800 MB (estimate)

**Worst-case simultaneous load**: 1.2-1.8 GB RAM

**Mitigation**:
- Sequential execution: Unload TTS/STT models when not in use
- Only load STT during voice input, only load TTS during response playback
- Keep embedding + generation models resident

---

## License Constraints

### PocketTTS Model License

**Source**: KevinAHM/pocket-tts-onnx-export (community export)
**Upstream**: kyutai/pocket-tts

**README states**: "Before you use it, please read its LICENSE. It is for non-commercial."

**CRITICAL**: PocketTTS int8 ONNX models from sherpa-onnx release are **NON-COMMERCIAL LICENSE**.

**Implications**:
- HIVA MediChat deployment scope must be non-commercial OR
- License terms must be verified with Kyutai for commercial use OR
- Alternative TTS engine required for commercial deployment

**Action required**: Verify HIVA MediChat deployment is non-commercial OR obtain commercial license from Kyutai.

### Moonshine License

**Source**: UsefulSensors/moonshine
**License**: Apache 2.0 (permissive, commercial use allowed) ✅

### sherpa-onnx License

**License**: Apache 2.0 ✅

### Anna Voice License

**Source**: kyutai/tts-voices (VCTK dataset, p228 speaker)
**VCTK License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Commercial use allowed ✅
- Attribution required

---

## Final Verdict

### ✅ FITS WITHIN BUDGET
- Storage: 391 MB < 700 MB (309 MB headroom)
- Memory: Unknown, requires device testing

### ⚠️ LICENSE BLOCKER
**PocketTTS non-commercial license** must be resolved before deployment.

**Options**:
1. Confirm HIVA MediChat is non-commercial project → proceed
2. Contact Kyutai for commercial license → wait for approval
3. Switch to alternative TTS (Piper, VITS, Kokoro) with commercial-friendly license

### 📋 NEXT STEPS

1. **Resolve license** (blocker)
2. **Upgrade ONNX Runtime** to 1.27.0 across project
3. **Download models** to `android/app/src/main/assets/`
4. **Build smoke tests** (isolated synthesis + transcription)
5. **Integrate Kotlin plugins** (NativeTTSPlugin, NativeSTTPlugin)
6. **Device testing** (memory profiling, latency measurement)

---

**Budget Status**: ✅ APPROVED (pending license resolution)  
**Ready for implementation**: NO (license must be resolved first)
