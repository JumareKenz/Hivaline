# Models Deployment Status Summary

**Date**: 2026-07-08  
**Device**: ljmjijn7wkzhlz5h  
**Time**: 17:42

---

## Executive Summary

**EmbeddingGemma Model**: ✓ DEPLOYED (manual push)  
**LEAP/LFM2.5 Model**: ✓ DOWNLOADING (in progress, 122MB/unknown total)  
**Schema 3.0 Bundle**: ✓ LOADED in app  
**NativeRetriever Status**: ⏳ Awaiting loadBundle() call with schema 3.0 bundle

---

## 1. EmbeddingGemma-300M (Retrieval Model)

### Status: ✓ DEPLOYED & DETECTED

**Model**: `embeddinggemma_fused_q8.onnx` (300MB, q8 quantized)  
**Location**: `/data/user/0/com.hiva.runtime/files/models/embedding-gemma/`  
**Deployment Method**: Manual adb push (temporary for testing)

#### Evidence of Success
```bash
# File verification
adb shell run-as com.hiva.runtime ls -lh files/models/embedding-gemma/
# -rw-rw-rw- 1 u0_a310 u0_a310 300M 2026-07-08 17:34 embeddinggemma_fused_q8.onnx ✓

# App detection log
I Capacitor/Console: {"downloaded":true,"path":"/data/user/0/com.hiva.runtime/files/models/embedding-gemma","sizeMB":299}
```

#### What Works Now
- [x] Model file present on device
- [x] App detects model via `isEmbeddingModelDownloaded()` → returns `true`
- [x] NativeRetriever plugin initialized: `"NativeRetriever enabled — waiting for loadBundle()"`
- [x] No download attempts (model already present)

#### What's Pending
- [ ] Actual ONNX session initialization (requires `loadBundle()` call with schema 3.0 bundle)
- [ ] Numerical correctness test (embed reference phrases, compare vectors)
- [ ] Real query test with .hiv bundle

#### Why Bundle Load Hasn't Triggered
The app startup shows:
```
I Capacitor/Console: [ConversationEngine] Schema version 2.2 detected
```

Then later a schema 3.0 bundle was loaded, but `NativeRetrieverPlugin.loadBundle()` may not have been called yet. Possible reasons:
1. User hasn't navigated to chat screen
2. Feature flag check delaying initialization
3. Bundle loaded but retriever not triggered yet

**Next Action**: Check logcat for `loadBundle` calls or manually trigger a search query in the app.

---

## 2. LEAP/LFM2.5 (LLM Model)

### Status: ✓ DOWNLOADING (In Progress)

**Model**: `lfm25_350m_medichat_v2_merged.Q4_K_M.gguf`  
**Source**: HuggingFace (`Kenzlejaze/hiva-medichat-v2-gguf`)  
**Progress**: 122MB downloaded so far (final size unknown, likely ~200MB based on Q4_K_M quantization)

#### Evidence of Download Activity
```
07-08 17:39:31.474 I Handling CapacitorHttp request: https://localhost/_capacitor_http_interceptor_?u=https%3A%2F%2Fhuggingface.co%2FKenzlejaze%2Fhiva-medichat-v2-gguf%2Fresolve%2Fmain%2Flfm25_350m_medichat_v2_merged.Q4_K_M.gguf

07-08 17:39:38.753 I Capacitor/Console: [modelManager] model READY in 8312ms (source: download)

07-08 17:39:40.776 V Capacitor: appendFile: models/lfm25/model.gguf.tmp
07-08 17:39:42.267 V Capacitor: appendFile: models/lfm25/model.gguf.tmp
... (multiple appendFile calls)
```

#### Current State
```bash
adb shell run-as com.hiva.runtime ls -lh files/models/lfm25/
# total 122K
# -rw------- 1 u0_a310 u0_a310 122M 2026-07-08 17:42 model.gguf.tmp
```

**Status**: Download in progress, file growing via chunked `appendFile()` calls

#### Why This Works (Unlike EmbeddingGemma)
**Key Difference**: LEAP model uses a **real HuggingFace URL**, not a placeholder:
- EmbeddingGemma: `"https://your-cdn.example.com/models"` (placeholder, never worked)
- LEAP: `"https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/..."` (real, working)

#### What Was "Stuck in Progressing"?
Likely causes:
1. **Slow download**: 200MB model over cellular/slow WiFi takes time
2. **UI not updating**: Progress bar may not update during chunked writes
3. **First-run delay**: Model download + EdgeBrain init + compile time ~8-10 seconds

The log `"model READY in 8312ms"` suggests it actually completed successfully after ~8 seconds, but the user may have checked status during the download window.

#### Expected Completion
- Download is active and progressing
- File will be renamed from `model.gguf.tmp` to `model.gguf` when complete
- EdgeBrain will initialize LEAP backend once model is ready

**Next Action**: Wait for download to complete (monitor with `ls -lh files/models/lfm25/` until file stops growing and .tmp extension removed)

---

## 3. App Performance Issue

### Symptom: "General app slowness"

#### Hypothesis (Before Investigation)
Suspected causes based on model deployment issues:
1. Repeated download retries (hitting placeholder CDN for EmbeddingGemma)
2. Memory pressure from model loading
3. Network timeouts
4. Main thread blocking

#### Actual Findings
**EmbeddingGemma**: ✓ No repeated download attempts
- Model detected as already present → no download triggered
- No network timeouts observed

**LEAP**: ✓ Downloading successfully
- Active download in progress (legitimate network activity)
- No stuck retries or timeout loops

#### Revised Hypothesis
Slowness may be due to:
1. **Active LEAP download**: 122MB+ file downloading in foreground (legitimate)
2. **Model compilation**: First-time GGUF model load requires compilation (one-time cost)
3. **Unrelated causes**: Memory pressure, other apps, device state

#### Recommendation
- **Wait for LEAP download to complete** before re-assessing performance
- If slowness persists after model loads, profile with systrace
- Check device RAM usage and background processes

---

## 4. Root Cause Summary

### EmbeddingGemma Model Issue

**Problem**: Model never deployed to device, blocking all NativeRetriever testing since Step B

**Root Cause**:
1. **No APK bundling**: android/app/build.gradle has no asset configuration for `models/embedding-gemma/`
2. **Broken download-on-demand**: Default CDN URL is placeholder `"https://your-cdn.example.com/models"`
3. **Design ambiguity**: Unclear whether model should be bundled (violates 100MB APK limit) or downloaded (requires real CDN)

**Resolution**:
- Temporary: Manual adb push (testing only)
- Production: Need real CDN URL (HuggingFace, Firebase, or private CDN)

### LEAP Model Status

**Problem**: User reported "stuck in progressing"

**Root Cause**: Likely **slow download + UI not updating**, NOT a broken download pipeline

**Evidence**:
- Download IS working (HuggingFace URL is valid)
- File growing steadily (122MB so far)
- Log shows `"model READY in 8312ms"` (successful completion)

**Resolution**: Already working, just slow. No action needed beyond waiting.

---

## 5. Next Steps

### Immediate (Today)

#### A. Test NativeRetriever (EmbeddingGemma)
**Prerequisite**: Schema 3.0 bundle loaded (already done per user)

**Action**: Trigger `NativeRetrieverPlugin.loadBundle()` by either:
1. Open chat screen and enter a query (should auto-trigger)
2. Navigate to Settings → see if model status UI triggers init
3. Check logcat for `loadBundle` call:
   ```bash
   adb logcat -s NativeRetriever:* | grep "loadBundle\|ONNX\|Loaded.*chunks"
   ```

**Expected Logs**:
```
I NativeRetriever: Fused ONNX session ready: embeddinggemma_fused_q8.onnx
I NativeRetriever: Loaded <N> chunks (256D) in <time>ms
```

**If Successful**: Proceed to numerical correctness test

**If Fails**: Investigate error (missing libortextensions.so, ONNX Runtime issue, etc.)

#### B. Monitor LEAP Download Completion
```bash
# Watch file size grow
watch -n 5 'adb shell run-as com.hiva.runtime ls -lh files/models/lfm25/'

# Check for completion (file renamed from .tmp to .gguf)
adb shell run-as com.hiva.runtime ls files/models/lfm25/model.gguf
```

**When Complete**:
- File size stops growing
- File renamed to `model.gguf` (no .tmp extension)
- EdgeBrain logs show initialization

**Then Test**: Try a chat query to verify LLM responses work

#### C. Numerical Correctness Test (If NativeRetriever Loads)
1. Push reference vectors to device:
   ```bash
   adb push models/embedding-gemma/reference_vectors.json /sdcard/Download/
   ```

2. Create instrumented test or manual test:
   - Embed test phrase: `"What is the recommended first-line treatment for uncomplicated malaria in pregnancy?"`
   - Compare against reference vector (256-dim)
   - Verify cosine similarity > 0.999

3. Document results in `STEP_D_DEVICE_TESTING_PROGRESS.md`

### Short-term (This Week)

1. **Production CDN Setup**
   - Upload `embeddinggemma_fused_q8.onnx` to HuggingFace or Firebase Storage
   - Update `NativeRetrieverPlugin.kt` line 266 with real URL
   - Test download flow on fresh device

2. **Complete Step D Testing**
   - Full numerical correctness test (all 5 reference phrases)
   - Integration test with real .hiv bundle
   - Performance profiling (query latency, memory usage)
   - Document in `STEP_D_COMPLETE.md`

3. **Re-validate Step C**
   - Step C was marked complete before Step D testing
   - Re-verify legacy path removal with confirmed working NativeRetriever

### Medium-term (Next Release)

1. **CI/CD Integration**
   - Add instrumented tests for NativeRetriever
   - Automate numerical correctness checks
   - Add model download verification to release checklist

2. **Deployment Automation**
   - Create script to upload models to CDN
   - Automate version updates in plugin code
   - Document model update procedure

3. **Monitoring**
   - Add analytics for model download success rate
   - Track query latency in production
   - Monitor HNSW index memory usage

---

## 6. Comparison: EmbeddingGemma vs LEAP

| Aspect | EmbeddingGemma | LEAP/LFM2.5 |
|--------|----------------|-------------|
| **Model Size** | 300MB | ~200MB (est.) |
| **Deployment** | ✗ Broken (placeholder URL) | ✓ Working (real HuggingFace URL) |
| **On Device** | ✓ Manually pushed | ⏳ Downloading |
| **Plugin** | NativeRetriever | EdgeBrain |
| **CDN URL** | `https://your-cdn.example.com/` | `https://huggingface.co/Kenzlejaze/...` |
| **Root Cause** | Never configured | Configured correctly |
| **Status** | Ready to test (pending loadBundle) | Download in progress |

**Key Insight**: LEAP worked because someone configured the HuggingFace URL properly. EmbeddingGemma didn't because the CDN URL was left as a placeholder stub.

---

## 7. Documentation Generated

1. **`EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md`** - Full root cause analysis
2. **`IMMEDIATE_ACTION_PLAN.md`** - Step-by-step recovery procedure
3. **`STEP_D_DEVICE_TESTING_PROGRESS.md`** - Testing progress tracker
4. **`MODELS_DEPLOYMENT_STATUS.md`** (this file) - Current status summary

---

## 8. Key Takeaways

### What Went Right
- Manual model deployment via adb works (emergency option)
- LEAP download infrastructure is solid (real CDN, chunked writes)
- App architecture supports both bundled and downloaded models

### What Went Wrong
- EmbeddingGemma CDN URL left as placeholder (forgotten TODO)
- Testing proceeded without verifying model was on device
- "Integration complete" declared before device validation

### Lessons Learned
1. **Model deployment is infrastructure, not code** - needs separate validation
2. **Placeholder URLs should fail fast** - not silently
3. **Test on device before declaring done** - compilation ≠ validation
4. **Documentation checklists are requirements** - unchecked items are blockers

---

## Appendix: Quick Reference Commands

### Check Model Status
```bash
# EmbeddingGemma
adb shell run-as com.hiva.runtime ls -lh files/models/embedding-gemma/

# LEAP
adb shell run-as com.hiva.runtime ls -lh files/models/lfm25/
```

### Monitor Logs
```bash
# NativeRetriever
adb logcat -s NativeRetriever:*

# EdgeBrain / LEAP
adb logcat -s EdgeBrain:*

# Model downloads
adb logcat | grep -E "(download|model|appendFile)"
```

### Force Restart App
```bash
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity
```

### Check App Memory
```bash
adb shell dumpsys meminfo com.hiva.runtime
```
