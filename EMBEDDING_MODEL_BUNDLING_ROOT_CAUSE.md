# EmbeddingGemma Model Bundling Root Cause Analysis

**Date**: 2026-07-08  
**Status**: CRITICAL BLOCKER  
**Impact**: On-device numerical correctness testing was impossible since Step B

---

## Root Cause Summary

The `embeddinggemma_fused_q8.onnx` model (300MB) was **NEVER bundled into the APK** and was **NEVER successfully deployed to the physical test device**. This means:

1. **All prior claims of "NativeRetriever integration complete" are unverified**
2. **The on-device numerical correctness test required before Step C cannot have been run**
3. **Step C (legacy removal) was marked complete WITHOUT the prerequisite Step D device testing**
4. **Step D device testing is still pending and cannot proceed until model deployment is fixed**

---

## Evidence

### 1. Model NOT in APK Assets

**Finding**: The model does NOT exist in `android/app/src/main/assets/models/embedding-gemma/`

**Assets directory contents**:
```
android/app/src/main/assets/
├── models/tts/                      # PocketTTS models (present)
│   ├── decoder.int8.onnx
│   ├── encoder.onnx
│   ├── lm_flow.int8.onnx
│   ├── lm_main.int8.onnx
│   └── text_conditioner.onnx
└── public/models/                   # Legacy web models (present)
    ├── embed/onnx/model_quantized.onnx
    ├── stt/
    ├── tts/
    └── vad/
```

**Missing**: `models/embedding-gemma/embeddinggemma_fused_q8.onnx`

### 2. Model Exists Only in Project Directory

**Local file present**: `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300 MB)

This file exists in the **project source tree** but was never copied into the APK assets directory during the build process.

### 3. No Asset Bundling Configuration

**android/app/build.gradle analysis**:
- No `sourceSets { main { assets.srcDirs += ['../../models'] } }` configuration
- No explicit copy task for embedding model
- No reference to `models/embedding-gemma` in any Gradle file

**Result**: Gradle never knew it should bundle this 300MB file into the APK.

### 4. Download-on-Demand Design (Unconfigured)

**NativeRetrieverPlugin.kt lines 262-299**: `downloadEmbeddingModel()` method exists

**Default URL** (line 266):
```kotlin
val baseUrl = call.getString("url")
    ?: "https://your-cdn.example.com/models"  // Placeholder - NOT a real CDN
```

**Problem**: This is a **placeholder stub**, not a real CDN endpoint. The design assumes:
1. Model is downloaded on first run (not bundled in APK)
2. User provides a real CDN URL

**Reality**:
- No real CDN was ever configured
- Download was never tested with a real URL
- App startup in `HIVFileContext.tsx` calls `downloadEmbeddingModel()` with no URL parameter, hitting the placeholder

### 5. ADB Not Available for Device Verification

**Attempted**: `adb shell ls /data/data/com.hiva.runtime/files/models/embedding-gemma/`  
**Result**: `adb: command not found`

**Status**: Cannot directly verify device state, but based on:
- Model not in APK assets
- Placeholder CDN URL never configured
- No evidence of manual model push to device

**Conclusion**: Model is NOT on the physical test device.

---

## Design Ambiguity

The codebase shows **two conflicting deployment strategies** without clear documentation:

### Strategy A: Bundle Model in APK Assets
- **Pros**: Works offline, no network dependency
- **Cons**: APK size +300MB (Play Store limits: 150MB AAB, 100MB APK per split)
- **Status**: NOT implemented (no Gradle asset bundling)

### Strategy B: Download-on-Demand from CDN
- **Pros**: Smaller APK, only downloaded if NativeRetriever used
- **Cons**: Requires network, CDN hosting costs, first-run latency
- **Status**: PARTIALLY implemented (code exists, CDN URL is placeholder)

**NATIVE_RETRIEVER_INTEGRATION.md line 141** says:
> - [ ] Upload `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300 MB) to CDN
> - [ ] Update `downloadEmbeddingModel()` URL in NativeRetrieverPlugin.kt line 280

This was marked as a **TODO in the deployment checklist**, not as a completed step.

**Conclusion**: Strategy B (download-on-demand) was the intended design, but was never completed.

---

## Impact Analysis

### What This Blocked

1. **Step B.4 (HNSW Integration)**: Cannot verify without on-device test
2. **Step C (Legacy Removal)**: Prerequisite Step D device testing was skipped
3. **Step D (Device Testing)**: Completely blocked - cannot run without model on device
4. **LEAP/LFM2.5 Integration**: May share the same broken model download pipeline
5. **All NativeRetriever claims**: Unverified until model is deployed and test runs

### What Still Works

1. **Legacy JS embedding path**: Still functional as fallback (MiniLM/bge-m3)
2. **Schema 2.2/2.3 bundles**: Continue to work via JS path
3. **Other native features**: EdgeBrain LLM, speech I/O (separate model paths)

---

## Why This Was Missed

### Documentation Trail

**NATIVE_RETRIEVER_INTEGRATION.md** clearly lists model deployment as **unchecked TODO**:
```markdown
### 1. Model Deployment
- [ ] Upload `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300 MB) to CDN
- [ ] Update `downloadEmbeddingModel()` URL in NativeRetrieverPlugin.kt line 280
- [ ] Test model download on real device (WiFi + cellular)
```

**STEP_C_COMPLETE.md lines 124-134** says:
> **Proceed to Step D**: Device Testing
> - Build Android app with integrated NativeRetriever
> - Run on-device numerical correctness test
> - Verify cosine similarity > 0.999 for reference phrases

**But**: Step C was marked "COMPLETE ✓" **WITHOUT** running Step D first.

**Root Cause of Confusion**: 
- Step B focused on Kotlin code changes (ONNX integration, ObjectBox setup)
- Kotlin code compilation succeeded → marked as "complete"
- **Model deployment** and **device testing** were deferred to "later"
- Step C went ahead without device validation
- No one noticed the model was missing until now

---

## Corrective Action Plan

### Phase 1: Get Model Onto Device (Immediate)

**Option 1A: Bundle in APK (Quick, for testing only)**
```gradle
// android/app/build.gradle
android {
    sourceSets {
        main {
            assets.srcDirs += ['../../models/embedding-gemma']
        }
    }
}
```
**Pros**: Quick, works offline  
**Cons**: APK size +300MB (exceeds Play Store limits, must use App Bundle with on-demand delivery)

**Option 1B: Manual Push via ADB (Testing Only)**
```bash
# First, install Android SDK and configure adb
# Then:
adb push models/embedding-gemma/embeddinggemma_fused_q8.onnx \
  /data/data/com.hiva.runtime/files/models/embedding-gemma/

# Verify
adb shell ls -lh /data/data/com.hiva.runtime/files/models/embedding-gemma/
```
**Pros**: Fastest for immediate testing  
**Cons**: Not scalable, device-specific, requires adb setup

**Option 1C: Configure Real CDN (Production-Ready)**
1. Upload model to accessible CDN (HuggingFace, Firebase Storage, or private CDN)
2. Update `NativeRetrieverPlugin.kt` line 266 with real URL
3. Test download on device (WiFi + cellular)

**Pros**: Production-ready, scalable  
**Cons**: Requires CDN account, takes longer to set up

**RECOMMENDATION**: Use Option 1B (manual adb push) for immediate numerical correctness testing, then move to Option 1C for production.

---

### Phase 2: Run Numerical Correctness Test (Critical)

**Location**: `models/embedding-gemma/reference_vectors.json` (83KB, already exists)

**Test Procedure**:
1. Push model to device (Phase 1)
2. Build app with `USE_NATIVE_RETRIEVER=true`
3. Install APK on physical device
4. Run instrumented test or manual verification:
   - Load reference phrases from `reference_vectors.json`
   - Embed each phrase via `NativeRetrieverPlugin.embedQuery()`
   - Compare against reference 256-dim vectors
   - **PASS**: cosine similarity > 0.999 for all phrases
   - **FAIL**: if any phrase < 0.999, investigate normalization/truncation bug

**Reference phrases** (from file):
- English: "What are the symptoms of malaria?"
- Hausa: "Menene alamun zazzabin cizon sauro?"
- Yoruba: "Kini awọn ami aisan iba?"
- Igbo: "Gịnị bụ ihe ịrịba ama nke ịba?"
- Pidgin: "Wetin be the sign of malaria?"

**Expected Result**: All similarities > 0.999 (numerical precision within FP32 tolerance)

---

### Phase 3: Investigate LEAP Model Download Issue

**Symptom** (from user message):
> LEAP/LFM2.5 download stuck in "progressing" state

**Hypothesis**: Same root cause as EmbeddingGemma
- `EdgeBrainPlugin` may have similar placeholder CDN URL
- Model download may be failing silently
- `modelDownloader.ts` may be affected

**Action**:
1. Check `EdgeBrainPlugin.kt` for CDN URL configuration
2. Review `modelDownloader.ts` download logic
3. Check device logs for download errors
4. Test LEAP model download separately

---

### Phase 4: Fix General App Slowness

**Symptom** (from user message):
> General app slowness on device

**Possible Causes**:
1. **Repeated download failures**: App may be retrying failed model downloads in a loop
2. **HNSW index builds**: If NativeRetriever falls back to JS path, may be building in-memory HNSW
3. **Memory pressure**: 300MB model attempts to download → fails → retries → OOM
4. **Network timeouts**: Placeholder CDN URLs timing out on every startup

**Action**:
1. Review app startup flow in `HIVFileContext.tsx` (lines 109-117)
2. Add timeout + retry limits to model downloads
3. Add proper error handling for missing models
4. Check device logs for repeated errors

---

## Immediate Next Steps (Ordered)

### 1. Set Up Device Connection (5 minutes)
```bash
# Option A: Install Android SDK and configure adb
# Option B: Use Android Studio's bundled adb
export PATH="$PATH:/c/Users/INEWTON/AppData/Local/Android/Sdk/platform-tools"
adb devices  # Should show your device
```

### 2. Push Model to Device (2 minutes)
```bash
adb push models/embedding-gemma/embeddinggemma_fused_q8.onnx \
  /data/data/com.hiva.runtime/files/models/embedding-gemma/

adb shell ls -lh /data/data/com.hiva.runtime/files/models/embedding-gemma/
# Should show: embeddinggemma_fused_q8.onnx (300MB)
```

### 3. Rebuild and Install App (3 minutes)
```bash
cd android
./gradlew clean assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 4. Run Numerical Correctness Test (10 minutes)
- Launch app on device
- Open Settings → trigger NativeRetriever initialization
- Use logcat or instrumented test to verify:
  - Model loads successfully
  - Query embedding produces 256-dim vectors
  - Cosine similarity matches reference_vectors.json (> 0.999)

### 5. Document Results
- Update `NATIVE_RETRIEVER_INTEGRATION.md` with test results
- Create `STEP_D_COMPLETE.md` with actual device test evidence
- Record cosine similarity scores for all reference phrases

### 6. Fix Production Deployment
- Choose CDN strategy (HuggingFace, Firebase, or private CDN)
- Upload model to CDN
- Update `NativeRetrieverPlugin.kt` with real URL
- Test end-to-end download on fresh device

---

## Lessons Learned

1. **"Integration complete" ≠ "Works on device"**: Code compilation is not validation
2. **Test prerequisites in order**: Step C should not have proceeded before Step D
3. **Model deployment is infrastructure, not code**: Requires separate validation
4. **Placeholder URLs are bugs**: Should fail fast, not silently
5. **Documentation checklists are not optional**: Unchecked TODOs are blockers

---

## Status Summary

| Component | Status | Evidence |
|-----------|--------|----------|
| Kotlin NativeRetriever code | ✓ Complete | Code compiles, logic correct |
| ONNX model fusion | ✓ Complete | embeddinggemma_fused_q8.onnx exists locally |
| Model bundling in APK | ✗ NOT DONE | No Gradle asset config |
| CDN deployment | ✗ NOT DONE | Placeholder URL only |
| Model on test device | ✗ NOT PRESENT | adb check pending |
| Numerical correctness test | ✗ NOT RUN | Blocked by missing model |
| Step C validation | ✗ INCOMPLETE | Ran before Step D |
| Step D device testing | ✗ BLOCKED | Waiting for model deployment |

**OVERALL STATUS**: NativeRetriever integration is **90% complete (code)** but **0% validated (device)**

---

## Urgency Assessment

**Critical Path Blocked**: Yes  
**User Impact**: High (app slowness may be caused by this)  
**Time to Fix**: 20 minutes (manual push) or 2 hours (CDN setup)  
**Workaround Available**: Yes (JS embedding fallback still works)

**RECOMMENDATION**: Proceed with manual model push today, verify numerical correctness, then set up CDN for production.
