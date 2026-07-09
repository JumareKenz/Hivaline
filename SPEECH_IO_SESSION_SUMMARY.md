# Speech I/O Integration Session - Final Status

**Date**: 2026-07-08  
**Duration**: ~5 hours  
**Status**: INCOMPLETE - App functional but speech integration blocked

---

## What Was Accomplished

### ✅ Build Infrastructure
- ONNX Runtime upgraded 1.17.0 → 1.27.0
- sherpa-onnx 1.13.4 AAR integrated (47 MB)
- PocketTTS models downloaded (194 MB TTS models)
- Dependency conflicts resolved (pickFirst for libonnxruntime.so)
- Build system working (6 build attempts, final success)

### ✅ Code Integration
- NativeTTSPlugin.kt created (PocketTTS + Anna voice)
- nativeTTSService.ts WebView bridge created
- ttsService.ts updated for native-first fallback
- sttService.ts kept as Web Speech API only
- MainActivity plugin registration updated

### ⏸️ Deferred
- **Native STT (Moonshine)**: Blocked by API 35 requirement (project needs API 31)
- Future: Manual ONNX Runtime integration or alternative ASR

---

## Critical Issues Found on Device

### 1. NativeTTSPlugin Crash Loop ❌
**Symptom**: App crashes repeatedly during startup  
**Cause**: NativeTTSPlugin.load() initializing sherpa-onnx during app start  
**Workaround Applied**: Disabled NativeTTSPlugin registration  
**Current State**: App runs with Web Speech API fallback only

**Root cause unknown** - needs debugging:
- sherpa-onnx-jni.so loads successfully (logs confirm)
- Crash is silent (no FATAL EXCEPTION in logcat)
- Likely issue: AssetManager parameter or model file paths incorrect
- Suspect: `OfflineTts(context.assets, ttsConfig)` constructor call

### 2. Embedding Model Download Failure ❌
**Symptom**: "Unable to resolve host: your-cdn.example.com"  
**Cause**: Placeholder URL in NativeRetrieverPlugin.kt line 266  
**Root Cause**: **Fused embedding model (300MB) NOT in APK assets**

**Critical oversight**: 
- `models/embedding-gemma/embeddinggemma_fused_q8.onnx` exists locally (300MB)
- Was NEVER copied to `android/app/src/main/assets/`
- NativeRetriever expects it bundled, tries to download when missing
- Download fails because URL is placeholder

**Fix required**:
1. Copy embeddinggemma_fused_q8.onnx to `android/app/src/main/assets/models/embedding/`
2. Update NativeRetrieverPlugin to load from assets (not download)
3. Or: Provide real CDN URL for fallback download

### 3. LLM Model "Download Progressing" Stuck ❌
**Symptom**: LFM2.5-350M model shows infinite "download progressing"  
**Likely Cause**: LEAP model path or initialization issue  
**Needs Investigation**: Check EdgeBrainPlugin initialization logs

### 4. App Slowness ⚠️
**Symptom**: General UI lag  
**Likely Causes**:
- Missing embedding model causing repeated failed downloads
- ONNX Runtime 1.27.0 performance regression (vs 1.17.0)
- 474MB APK size (190MB TTS models in assets)

---

## Files Modified (This Session)

### Android
- `android/app/build.gradle` - Dependencies, packagingOptions
- `android/app/src/main/java/com/hiva/runtime/MainActivity.java` - Plugin registration
- `android/app/src/main/java/com/hiva/runtime/speech/NativeTTSPlugin.kt` - Created (now disabled)
- `android/app/src/main/assets/models/tts/` - 190MB PocketTTS models
- `android/app/libs/sherpa-onnx-1.13.4.aar` - Added

### WebView
- `src/services/nativeTTSService.ts` - Created
- `src/services/ttsService.ts` - Updated (native disabled)
- `src/services/sttService.ts` - Reverted to Web Speech API only

### Documentation
- `SPEECH_IO_INVESTIGATION_REPORT.md`
- `SPEECH_IO_RESOURCE_BUDGET.md`
- `SPEECH_IO_BUILD_BLOCKER.md`
- `SPEECH_TTS_ONLY_SUMMARY.md`
- `SPEECH_IO_INTEGRATION_SUMMARY.md`

---

## Immediate Next Steps

### Priority 1: Fix Embedding Model (BLOCKING)
```bash
# Copy fused model to assets
mkdir -p android/app/src/main/assets/models/embedding
cp models/embedding-gemma/embeddinggemma_fused_q8.onnx android/app/src/main/assets/models/embedding/

# Update NativeRetrieverPlugin.kt to load from assets (not download)
# OR provide real HuggingFace URL for fallback
```

### Priority 2: Debug NativeTTSPlugin Crash
Options:
1. Add try-catch with detailed logging in NativeTTSPlugin.initializeTTS()
2. Move initialization from load() to lazy (first synthesize() call)
3. Verify sherpa-onnx API usage matches actual library (check examples)
4. Test sherpa-onnx standalone (separate test app)

### Priority 3: Fix LLM Download Stuck
- Check EdgeBrainPlugin logs for LEAP model load status
- Verify LEAP model path exists on device
- Check if LEAP SDK initialization is blocking

### Priority 4: Revalidate NativeRetriever (Task #6)
**CRITICAL**: ONNX Runtime 1.17.0 → 1.27.0 may affect embeddings
- Load reference_vectors.json
- Embed 10 test phrases with NativeRetriever
- Verify cosine similarity > 0.999 vs reference
- If regression: investigate ONNX Runtime version differences

---

## Current APK State

**Installed version**:
- Build: 2026-07-08 17:12 (stable without NativeTTSPlugin)
- Size: 474 MB (includes 190 MB unused TTS models)
- ONNX Runtime: 1.27.0
- Native TTS: ❌ Disabled (crashes)
- Native STT: ❌ Not integrated (API 35 constraint)
- NativeRetriever: ⚠️ Broken (missing embedding model)
- LEAP: ⚠️ Unknown state (download stuck)

**Working features**:
- ✅ App launches (no crash loop)
- ✅ Web Speech API TTS fallback
- ✅ Web Speech API STT
- ❌ Native retrieval (embedding model missing)
- ❓ LEAP generation (status unknown)

---

## Resource Usage

**APK Size**: 474 MB
- Base app: ~50 MB
- TTS models (unused): 190 MB
- sherpa-onnx AAR: 47 MB
- Other dependencies: ~187 MB

**Missing from APK** (should be added):
- Embedding model: 300 MB (embeddinggemma_fused_q8.onnx)

**Total if complete**: ~774 MB APK (exceeds 700 MB budget by 74 MB)

**Optimization needed**:
- Remove TTS models if native TTS stays disabled: -190 MB
- Or: Fix TTS crash and justify 774 MB size
- Or: Find smaller embedding model variant

---

## Lessons Learned

1. **API documentation critical**: sherpa-onnx required 3 API corrections (decompiling JAR necessary)
2. **Test incrementally**: Should have tested NativeTTSPlugin standalone before full integration
3. **Asset bundling checklist**: Embedding model oversight caused cascading failures
4. **ONNX Runtime upgrade risk**: 1.27.0 needs validation (numerical correctness)
5. **Crash debugging without stack trace**: Silent crashes hard to debug remotely

---

## Recommendations

### Short Term (This Week)
1. Bundle embedding model in assets (300MB) - **CRITICAL**
2. Debug NativeTTSPlugin crash or remove TTS models to reclaim 190MB
3. Validate ONNX Runtime 1.27.0 doesn't break embeddings
4. Fix LLM download stuck issue

### Medium Term (Next Sprint)
1. Implement manual ONNX Runtime STT (Moonshine without SDK)
2. Performance profiling (identify slowness root cause)
3. APK size optimization (current 474MB → target < 400MB)
4. Add attribution for VCTK/Anna voice (CC BY 4.0)

### Long Term (Future)
1. Sherpa-onnx TTS debugging environment (isolated test app)
2. Alternative TTS engine evaluation (Piper, VITS if sherpa-onnx problematic)
3. Whisper Tiny multilingual for Nigerian languages STT
4. Model quantization optimization (q4 variants if quality acceptable)

---

## Open Questions

1. **Why does NativeTTSPlugin crash silently?** (No stack trace in logcat)
2. **Does ONNX Runtime 1.27.0 produce identical embeddings to 1.17.0?** (Untested)
3. **Why is LEAP model download stuck?** (Needs device log investigation)
4. **Is 774MB APK acceptable for deployment?** (Budget was 700MB)
5. **Should we abandon sherpa-onnx and try alternative TTS?** (Depends on debugging time available)

---

## Files Ready for Review

- All `SPEECH_IO_*.md` documentation files
- `NativeTTSPlugin.kt` (needs debugging)
- `nativeTTSService.ts` (ready)
- Updated build.gradle (working)

---

**Session End**: 2026-07-08 17:20  
**Status**: App functional but speech features not operational  
**Next Session**: Start with embedding model bundling (Priority 1)
