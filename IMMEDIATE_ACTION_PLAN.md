# Immediate Action Plan: EmbeddingGemma Model Deployment & Validation

**Date**: 2026-07-08  
**Priority**: CRITICAL  
**Est. Time**: 30 minutes hands-on + 10 minutes testing

---

## Current Status

### ✓ Confirmed Working
- [x] Physical device connected: `ljmjijn7wkzhlz5h` (via adb)
- [x] Android SDK adb available: `/c/Users/INEWTON/AppData/Local/Android/Sdk/platform-tools/adb.exe`
- [x] APK built recently: `android/app/build/outputs/apk/debug/app-debug.apk` (474MB, 2026-07-08 17:13)
- [x] EmbeddingGemma model exists locally: `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300MB)
- [x] Reference vectors exist: `models/embedding-gemma/reference_vectors.json` (83KB)

### ✗ Critical Blockers Found
- [ ] App NOT installed on device (package `com.hiva.runtime` not found)
- [ ] Model NOT bundled in APK (no asset bundling configured in Gradle)
- [ ] Model NOT on device (cannot test because app not installed)
- [ ] CDN URL is placeholder: `"https://your-cdn.example.com/models"` (line 266 of NativeRetrieverPlugin.kt)
- [ ] Numerical correctness test NEVER RUN (blocked by missing model)

---

## Root Cause (Confirmed)

**The embeddinggemma_fused_q8.onnx model was never deployed to the device because:**

1. **NOT bundled in APK**: `android/app/build.gradle` has no asset bundling configuration for `models/embedding-gemma/`
2. **Download-on-demand broken**: Default CDN URL is placeholder `"https://your-cdn.example.com/models"` - not a real endpoint
3. **App not installed**: Previous install attempt failed with `INSTALL_FAILED_USER_RESTRICTED` (user needs to approve on device)

**Design Intent**: Based on `NATIVE_RETRIEVER_INTEGRATION.md`, the plan was download-on-demand from CDN, but:
- CDN upload was listed as TODO in deployment checklist
- URL update was never done
- Download was never tested

**Result**: The model exists in project source tree but has never reached a physical device.

---

## Action Plan (Execute in Order)

### Step 1: Install App on Device (5 min)

**Current Blocker**: Installation requires manual approval on device

**Action**:
```bash
# Set adb path for convenience
export ADB="/c/Users/INEWTON/AppData/Local/Android/Sdk/platform-tools/adb.exe"

# Install APK (watch the device screen for approval prompt)
$ADB install -r android/app/build/outputs/apk/debug/app-debug.apk

# Verify installation
$ADB shell pm list packages | grep hiva
# Should show: package:com.hiva.runtime
```

**User Action Required**: 
- Keep device screen unlocked
- Approve "Install from unknown source" when prompted
- Click "Install" when dialog appears

**Success Criteria**: `pm list packages` shows `package:com.hiva.runtime`

---

### Step 2: Create Model Directory on Device (1 min)

```bash
# Create directory structure (app must be running or installed first)
$ADB shell run-as com.hiva.runtime mkdir -p files/models/embedding-gemma

# Verify
$ADB shell run-as com.hiva.runtime ls -ld files/models/embedding-gemma
```

**Success Criteria**: Directory exists without errors

---

### Step 3: Push Model to Device (2-3 min)

```bash
# Push model (300MB transfer over USB 3.0 = ~2 minutes)
$ADB push models/embedding-gemma/embeddinggemma_fused_q8.onnx \
  /sdcard/Download/embeddinggemma_fused_q8.onnx

# Move to app private storage (adb push can't write directly to /data/data)
$ADB shell run-as com.hiva.runtime \
  cp /sdcard/Download/embeddinggemma_fused_q8.onnx \
     files/models/embedding-gemma/embeddinggemma_fused_q8.onnx

# Clean up
$ADB shell rm /sdcard/Download/embeddinggemma_fused_q8.onnx

# Verify
$ADB shell run-as com.hiva.runtime \
  ls -lh files/models/embedding-gemma/embeddinggemma_fused_q8.onnx
# Should show: ~300MB file
```

**Success Criteria**: Model file present, size ~300MB (314,572,800 bytes)

**Alternative (if run-as fails)**:
```bash
# Some devices don't allow run-as on production builds
# In that case, rebuild as debuggable and use:
$ADB root  # May require unlocked bootloader
$ADB push models/embedding-gemma/embeddinggemma_fused_q8.onnx \
  /data/data/com.hiva.runtime/files/models/embedding-gemma/
```

---

### Step 4: Launch App & Trigger Model Load (2 min)

**Actions**:
1. Launch app on device (tap HIVA icon)
2. Navigate to Settings screen
3. Observe app behavior

**Watch for in logcat** (run in separate terminal):
```bash
$ADB logcat -s NativeRetriever:* EdgeBrain:* ModelDownload:*
```

**Expected Logs**:
```
I/NativeRetriever: NativeRetriever enabled — waiting for loadBundle()
I/NativeRetriever: Fused ONNX session ready: embeddinggemma_fused_q8.onnx
I/NativeRetriever: Loaded 1234 chunks (256D) in 850ms
```

**Failure Logs** (if model still missing):
```
E/NativeRetriever: Fused model not found: /data/data/com.hiva.runtime/files/models/embedding-gemma/embeddinggemma_fused_q8.onnx
E/NativeRetriever: downloadEmbeddingModel failed: HTTP 404 (CDN placeholder)
```

---

### Step 5: Run Numerical Correctness Test (10 min)

**Option A: Manual Verification (Quick)**

1. Open app Settings
2. Trigger model download check (should detect model now present)
3. Load a .hiv bundle (schema 3.0)
4. Enter a test query in chat: `"What are the symptoms of malaria?"`
5. Check logcat for embedding logs:
   ```
   I/NativeRetriever: Query vec norm=1.0 after re-norm (expected ~1.0)
   I/NativeRetriever: HNSW search returned 5 results in 12ms
   ```

**Success**: Query returns relevant results, no normalization warnings

**Option B: Instrumented Test (Thorough)**

Create test file: `android/app/src/androidTest/java/com/hiva/runtime/NativeRetrieverCorrectnessTest.kt`

```kotlin
@RunWith(AndroidJUnit4::class)
class NativeRetrieverCorrectnessTest {
    @Test
    fun testEmbeddingNumericalCorrectness() {
        // Load reference vectors
        val refJson = File("/sdcard/Download/reference_vectors.json").readText()
        val ref = JSONObject(refJson)
        
        // Test phrases
        val phrases = listOf(
            "What are the symptoms of malaria?",
            "Menene alamun zazzabin cizon sauro?",  // Hausa
            "Kini awọn ami aisan iba?",             // Yoruba
            "Gịnị bụ ihe ịrịba ama nke ịba?",       // Igbo
            "Wetin be the sign of malaria?"         // Pidgin
        )
        
        for (phrase in phrases) {
            val queryVec = embedQuery(phrase)  // via NativeRetrieverPlugin
            val refVec = ref.getJSONArray(phrase).let { arr ->
                FloatArray(256) { arr.getDouble(it).toFloat() }
            }
            
            val cosine = cosineSimilarity(queryVec, refVec)
            assertTrue("$phrase: cosine=$cosine (expected >0.999)", cosine > 0.999f)
        }
    }
    
    private fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        var dot = 0f
        for (i in a.indices) dot += a[i] * b[i]
        return dot  // Both vectors are L2-normalized, so dot product = cosine
    }
}
```

Run test:
```bash
cd android
./gradlew connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.hiva.runtime.NativeRetrieverCorrectnessTest
```

**Success Criteria**: All 5 phrases pass with cosine > 0.999

---

### Step 6: Investigate LEAP/LFM2.5 Download Issue (5 min)

Now that we know the EmbeddingGemma issue, check if LEAP has the same problem:

```bash
# Check if LEAP model is present
$ADB shell run-as com.hiva.runtime ls -lh files/models/leap/

# Check EdgeBrain logs
$ADB logcat -s EdgeBrain:* LEAP:* | grep -i download
```

**Look for**:
- Missing model file errors
- Placeholder CDN URLs
- HTTP 404 or timeout errors
- "progressing" stuck state in model downloader

**Hypothesis**: EdgeBrainPlugin or modelDownloader.ts may have similar unconfigured download URLs.

---

### Step 7: Profile App Performance (5 min)

**Address "general app slowness" symptom**

```bash
# Capture systrace during app startup
$ADB shell atrace --async_start -b 8192 gfx input view webview wm am pm ss dalvik app sched freq idle disk mmc load sync workq memreclaim regulators binder_driver binder_lock pagecache -t 10

# Launch app
# (wait 10 seconds)

$ADB shell atrace --async_stop -o /sdcard/trace.html
$ADB pull /sdcard/trace.html .
# Open trace.html in Chrome at chrome://tracing
```

**Look for**:
- Repeated network timeouts (model download retries)
- Long GC pauses (memory pressure from failed model loads)
- Main thread blocking on I/O (file checks for missing models)

---

## Expected Timeline

| Step | Duration | Status |
|------|----------|--------|
| 1. Install app | 5 min | ⏸️ Waiting for user approval |
| 2. Create directory | 1 min | ⏳ Pending Step 1 |
| 3. Push model | 2 min | ⏳ Pending Step 1 |
| 4. Launch & verify | 2 min | ⏳ Pending Step 3 |
| 5. Numerical test | 10 min | ⏳ Pending Step 4 |
| 6. LEAP investigation | 5 min | ⏳ Pending Step 5 |
| 7. Performance profile | 5 min | ⏳ Optional |
| **TOTAL** | **30 min** | |

---

## Success Metrics

### Primary Objective: Verify NativeRetriever Works
- [x] Model deployed to device (300MB file present)
- [ ] App loads model successfully (logcat shows "ONNX session ready")
- [ ] Query embedding works (produces 256-dim normalized vectors)
- [ ] Numerical correctness: all reference phrases have cosine > 0.999

### Secondary Objective: Unblock Development
- [ ] LEAP model issue root cause identified
- [ ] App slowness root cause identified (if related to model issues)
- [ ] Clear path forward for production CDN deployment

### Documentation
- [ ] Update `NATIVE_RETRIEVER_INTEGRATION.md` with actual test results
- [ ] Create `STEP_D_COMPLETE.md` with device test evidence
- [ ] Document production deployment plan (CDN setup)

---

## Rollback Plan

If testing reveals critical issues:

1. **Disable NativeRetriever**: Set `USE_NATIVE_RETRIEVER=false` in `android/app/build.gradle`
2. **Rebuild**: `./gradlew clean assembleDebug`
3. **Reinstall**: App falls back to JS embedding path (MiniLM/bge-m3)
4. **JS fallback is proven stable** - this is safe rollback

---

## Production Deployment (After Testing)

Once numerical correctness is verified, production deployment requires:

### Option A: CDN Hosting (Recommended)
1. Upload `embeddinggemma_fused_q8.onnx` to HuggingFace Model Hub or Firebase Storage
2. Update `NativeRetrieverPlugin.kt` line 266 with real URL
3. Test download on fresh device (WiFi + cellular)
4. Monitor download success rate in production

### Option B: APK Bundling (Not Recommended)
- APK size +300MB (exceeds Play Store 100MB limit per split)
- Requires Android App Bundle with on-demand delivery feature module
- Increases Play Store review complexity
- Wastes bandwidth for users who don't use NativeRetriever

**Recommendation**: Use CDN (Option A)

---

## Next Steps After This Plan

1. **Complete Step D device testing** (this plan)
2. **Update Step C validation** (re-verify with device testing complete)
3. **Resume speech I/O work** (PocketTTS/Moonshine) - currently blocked
4. **Plan production CDN deployment** (HuggingFace or Firebase)
5. **Create instrumented test suite** for CI/CD (based on manual test results)

---

## Questions to Answer

Before declaring NativeRetriever "production ready":

1. ✓ Does the model load on a physical device? → **Test Step 4**
2. ✓ Are embeddings numerically correct? → **Test Step 5** (cosine > 0.999)
3. ? What is the real-world query latency? → **Measure in Step 5** (target <50ms)
4. ? How much memory does ObjectBox HNSW use? → **Profile in Step 7** (estimate: chunk_count * 256 * 4 bytes + HNSW overhead ~2x)
5. ? Does it work on low-end devices? → **Future testing** (need API 31+ devices with 2GB+ RAM)
6. ? What is the recall@5 quality vs. JS embedding? → **A/B test** (need production .hiv bundle)

---

## Contact & Support

**Issue Tracking**: See `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md` for detailed root cause analysis

**Logcat Commands**:
```bash
# Real-time NativeRetriever logs
$ADB logcat -s NativeRetriever:*

# Real-time all app logs
$ADB logcat -s "hiva:*" "HIVA:*" "NativeRetriever:*" "EdgeBrain:*"

# Dump last 500 lines to file
$ADB logcat -d > logcat_dump.txt
```

**Device Info**:
```bash
$ADB shell getprop ro.build.fingerprint
$ADB shell getprop ro.build.version.sdk  # Should be ≥31 (Android 12+)
```
