# Step D: Device Testing Progress

**Date**: 2026-07-08  
**Device**: ljmjijn7wkzhlz5h  
**Status**: ✓ Model Deployed, ⏳ Awaiting Numerical Correctness Test

---

## Progress Summary

### ✓ Completed Steps

#### 1. Root Cause Identified (17:20 - 17:30)
**Finding**: EmbeddingGemma model was never bundled in APK or downloaded to device
- No Gradle asset bundling configuration
- CDN URL is placeholder: `"https://your-cdn.example.com/models"`
- App not initially installed on test device

**Documentation**: See `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md`

#### 2. Device Connection Established (17:30)
```bash
adb devices
# ljmjijn7wkzhlz5h	device
```

#### 3. App Installed (17:32)
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
# Success after user approved on device
```

**Verified**:
```bash
adb shell pm list packages | grep hiva
# package:com.hiva.runtime ✓
```

#### 4. Model Deployed to Device (17:32 - 17:34)
**Method**: Manual adb push (temporary solution for testing)

**Steps**:
```bash
# Push to sdcard
adb push models/embedding-gemma/embeddinggemma_fused_q8.onnx /sdcard/embeddinggemma_model.onnx

# Copy to tmp (world-readable)
adb shell cp /sdcard/embeddinggemma_model.onnx /data/local/tmp/
adb shell chmod 644 /data/local/tmp/embeddinggemma_model.onnx

# Create app directory
adb shell run-as com.hiva.runtime mkdir -p files/models/embedding-gemma

# Move to app storage
adb shell run-as com.hiva.runtime sh -c \
  'cat /data/local/tmp/embeddinggemma_model.onnx > files/models/embedding-gemma/embeddinggemma_fused_q8.onnx'

# Clean up
adb shell rm /sdcard/embeddinggemma_model.onnx /data/local/tmp/embeddinggemma_model.onnx
```

**Verified**:
```bash
adb shell run-as com.hiva.runtime ls -lh files/models/embedding-gemma/
# -rw-rw-rw- 1 u0_a310 u0_a310 300M 2026-07-08 17:34 embeddinggemma_fused_q8.onnx ✓
```

#### 5. Model Detection Confirmed (17:39)
**App startup logs**:
```
I NativeRetriever: NativeRetriever enabled — waiting for loadBundle()
V Capacitor/Plugin: methodName: isEmbeddingModelDownloaded
I Capacitor/Console: {"downloaded":true,"path":"/data/user/0/com.hiva.runtime/files/models/embedding-gemma","sizeMB":299}
```

**Result**: ✓ App successfully detects the model is present (299MB)

---

## ⏳ Remaining Steps

### 6. Load Model & Test ONNX Session
**Status**: Blocked - requires schema 3.0 .hiv bundle

**What's needed**:
- Push a schema 3.0 .hiv bundle to device (with `manifest.retrievalCapabilities.embeddingModel = "google/embeddinggemma-300m"`)
- Load bundle in app (triggers `NativeRetrieverPlugin.loadBundle()`)
- Verify logs show:
  ```
  I NativeRetriever: Fused ONNX session ready: embeddinggemma_fused_q8.onnx
  I NativeRetriever: Loaded <N> chunks (256D) in <time>ms
  ```

**Alternative**: Create instrumented test that directly calls NativeRetriever methods

### 7. Numerical Correctness Test
**Status**: Blocked - requires Step 6 complete

**Test Plan**:
1. Embed reference test phrases via NativeRetriever:
   - "What is the recommended first-line treatment for uncomplicated malaria in pregnancy?"
   - (Additional multilingual phrases from reference_vectors.json)
2. Compare against reference 256-dim vectors from `reference_vectors.json`
3. Verify cosine similarity > 0.999 for all phrases

**Success Criteria**:
- ✓ All test phrases: cosine similarity > 0.999
- ✓ Query vector L2 norm = 1.0 ± 0.01
- ✓ No normalization warnings in logs

### 8. Integration Test with Real Bundle
**Status**: Blocked - requires Step 6 & 7 complete

**Test Scenario**:
1. Load real clinical .hiv bundle (schema 3.0)
2. Run semantic search query: "What are the symptoms of malaria?"
3. Verify HNSW search returns relevant results
4. Measure query latency (target: <50ms)
5. Check memory usage (profile ObjectBox HNSW index size)

### 9. LEAP Model Investigation
**Status**: Pending Step 6 completion

**Hypothesis**: LEAP model may have same issue (placeholder CDN, missing model file)

**Action Items**:
- Check if LEAP model exists on device
- Inspect EdgeBrainPlugin for CDN URL configuration
- Test LEAP model download/loading
- Investigate "stuck in progressing" symptom

### 10. App Performance Profiling
**Status**: Pending Step 6 completion

**Investigate**: General app slowness reported by user

**Possible Causes**:
- Repeated model download retries (hitting placeholder CDN)
- Memory pressure from large model files
- Main thread blocking on I/O checks
- Network timeouts

**Tools**:
- systrace
- Android Profiler
- logcat analysis

---

## Test Results (To Be Filled)

### Model Load Test
- [ ] ONNX session initialized successfully
- [ ] Model loading time: _____ ms
- [ ] Memory used: _____ MB
- [ ] libortextensions.so found and registered: [ ]

### Numerical Correctness Test
| Test Phrase | Expected Cosine | Actual Cosine | Status |
|-------------|-----------------|---------------|--------|
| "What is the recommended first-line treatment..." | > 0.999 | TBD | ⏳ |
| (Hausa phrase) | > 0.999 | TBD | ⏳ |
| (Yoruba phrase) | > 0.999 | TBD | ⏳ |
| (Igbo phrase) | > 0.999 | TBD | ⏳ |
| (Pidgin phrase) | > 0.999 | TBD | ⏳ |

### Integration Test Results
- [ ] Bundle loaded successfully
- [ ] HNSW search returns results: [ ]
- [ ] Results are relevant (spot-check): [ ]
- [ ] Query latency: _____ ms (target <50ms)
- [ ] No crashes or errors: [ ]

### Performance Test Results
- [ ] App startup time: _____ ms
- [ ] Memory footprint: _____ MB
- [ ] HNSW index size: _____ MB
- [ ] Query throughput: _____ queries/sec

---

## Known Issues

### Issue 1: No Schema 3.0 Bundle Available
**Impact**: Cannot test actual NativeRetriever functionality
**Workaround Options**:
1. Create minimal test bundle with schema 3.0 manifest
2. Write instrumented test that directly calls NativeRetriever methods
3. Modify existing schema 2.2 bundle to schema 3.0 (risky - may break other things)

### Issue 2: CDN URL Still Placeholder
**Impact**: Fresh devices cannot download model (blocks production deployment)
**Status**: Known issue, documented in `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md`
**Fix Required**: Upload model to real CDN and update NativeRetrieverPlugin.kt line 266

### Issue 3: LEAP Model Status Unknown
**Impact**: May share same deployment issue as EmbeddingGemma
**Next Action**: Investigate after EmbeddingGemma testing complete

---

## Next Actions (Prioritized)

### Immediate (Today)
1. **Option A**: If you have a schema 3.0 .hiv bundle:
   - Push to device: `adb push <bundle>.hiv /sdcard/Download/`
   - Load in app and observe logs for NativeRetriever initialization
   
2. **Option B**: Create instrumented test:
   - Write test file: `android/app/src/androidTest/java/com/hiva/runtime/NativeRetrieverCorrectnessTest.kt`
   - Push reference_vectors.json to device
   - Run test: `./gradlew connectedAndroidTest`

3. **Monitor current logs** for any errors or issues with current setup

### Short-term (This Week)
1. Complete numerical correctness testing
2. Investigate LEAP model deployment
3. Profile app performance to identify slowness root cause
4. Update documentation with test results

### Medium-term (Next Release)
1. Set up production CDN hosting (HuggingFace or Firebase Storage)
2. Update NativeRetrieverPlugin with real CDN URL
3. Test download flow on fresh device
4. Add CI/CD instrumented tests for NativeRetriever
5. Create deployment runbook for model updates

---

## Success Metrics

### Primary Goal: Verify NativeRetriever Works
- [x] Model file present on device (300MB)
- [x] App detects model (isEmbeddingModelDownloaded returns true)
- [ ] ONNX session initializes without errors
- [ ] Query embedding produces correct 256-dim vectors
- [ ] Numerical correctness: cosine similarity > 0.999

### Secondary Goal: Unblock Development
- [ ] Root cause of LEAP model issue identified
- [ ] Root cause of app slowness identified
- [ ] Clear production deployment path defined

### Documentation
- [x] Root cause analysis complete (`EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md`)
- [x] Action plan documented (`IMMEDIATE_ACTION_PLAN.md`)
- [x] Progress tracking started (this file)
- [ ] Test results documented
- [ ] Step D completion summary (`STEP_D_COMPLETE.md`)

---

## Appendix: Useful Commands

### Check Model Status
```bash
export ADB="/c/Users/INEWTON/AppData/Local/Android/Sdk/platform-tools/adb.exe"
export MSYS_NO_PATHCONV=1

$ADB shell run-as com.hiva.runtime ls -lh files/models/embedding-gemma/
```

### Monitor NativeRetriever Logs
```bash
$ADB logcat -s NativeRetriever:* EdgeBrain:* | grep -v "^$"
```

### Force Restart App
```bash
$ADB shell am force-stop com.hiva.runtime
$ADB shell am start -n com.hiva.runtime/.MainActivity
```

### Check Bundle Schema Version
```bash
$ADB shell run-as com.hiva.runtime cat files/<bundle-name>.hiv | unzip -p - manifest.json | grep schemaVersion
```

---

## Timeline

| Time | Event |
|------|-------|
| 17:00 | Issue reported: model not bundled, tests never run |
| 17:20 | Root cause analysis complete |
| 17:30 | Device connected, app installed |
| 17:34 | Model deployed to device (300MB) |
| 17:39 | Model detection confirmed in app logs |
| 17:45 | Progress documentation complete |
| TBD | Numerical correctness test |
| TBD | Step D completion |

---

## Contact & References

**Related Documentation**:
- `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md` - Full root cause analysis
- `IMMEDIATE_ACTION_PLAN.md` - Step-by-step recovery plan
- `NATIVE_RETRIEVER_INTEGRATION.md` - Original integration documentation
- `STEP_C_COMPLETE.md` - Step C completion (should be re-validated after Step D)

**Reference Files**:
- `models/embedding-gemma/reference_vectors.json` - Test vectors for numerical correctness
- `models/embedding-gemma/embeddinggemma_fused_q8.onnx` - The model file (300MB)

**Key Code Files**:
- `android/app/src/main/java/com/hiva/runtime/retriever/NativeRetrieverPlugin.kt` - Main plugin
- `src/services/nativeRetrieverService.ts` - TypeScript wrapper
- `src/context/HIVFileContext.tsx` - App startup model download check
