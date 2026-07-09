# LEAP Model Load Crash Report

**Date**: 2026-07-08 17:45:50  
**Severity**: CRITICAL  
**Status**: App crashes when loading downloaded LEAP model

---

## Summary

The LEAP/LFM2.5 model **downloaded successfully** (217MB), but the app **crashes immediately** when attempting to load it into memory via the LEAP SDK.

---

## Timeline

| Time | Event |
|------|-------|
| 17:39:31 | Download started from HuggingFace |
| 17:45:47 | Download completed: `model.gguf` (227,626,316 bytes = 217MB) |
| 17:45:47 | App detected model file and attempted to load |
| 17:45:50 | **CRASH**: Native crash in LLaMA.cpp backend |
| 17:45:52 | App process terminated by system |

---

## Evidence

### 1. Model Download Success
```
07-08 17:45:47.960 I Capacitor/Console: {
  "name":"model.gguf",
  "type":"file",
  "size":227626316,
  "mtime":1783529147751,
  "ctime":1783528881000,
  "uri":"file:///data/user/0/com.hiva.runtime/files/models/lfm25/model.gguf"
}
```

**Verification**:
```bash
adb shell run-as com.hiva.runtime ls -lh files/models/lfm25/
# -rw------- 1 u0_a310 u0_a310 217M 2026-07-08 17:45 model.gguf
```

**Expected size**: 219MB (from `modelDownloader.ts` config)  
**Actual size**: 217MB  
**Status**: ✓ Within acceptable range (99% of expected)

### 2. Native Crash Stack Trace
```
07-08 17:45:51.748 F DEBUG: #02 pc 00000000003efd3c  
  /data/app/.../base.apk!libinference_engine_llamacpp_backend.so (offset 0x2c30000) 
  (common_chat_templates_init(llama_model const*, 
   std::__ndk1::basic_string<char, ...>, 
   std::__ndk1::basic_string<char, ...>, 
   std::__ndk1::basic_string<char, ...>)+1512)

07-08 17:45:51.748 F DEBUG: #03 pc 00000000003e2708  
  /data/app/.../base.apk!libinference_engine_llamacpp_backend.so (offset 0x2c30000) 
  (llama_internal__common_chat_templates_init+172)

07-08 17:45:51.749 F DEBUG: #22 pc 0000000000161dc0  
  /data/app/.../base.apk 
  (ai.liquid.leap.inferenceengine.InferenceEngineModelRunner$Companion.loadFromBundle+0)

07-08 17:45:51.749 F DEBUG: #27 pc 000000000015d900  
  /data/app/.../base.apk 
  (ai.liquid.leap.LeapClient$loadModel$2$modelRunner$1.invokeSuspend+0)
```

**Crash Location**: `common_chat_templates_init()` in LLaMA.cpp backend  
**Trigger**: LEAP SDK attempting to load model file  
**Type**: Native crash (C++ exception or segmentation fault)

### 3. Crash Reporter Output
```
07-08 17:45:50.251 F crashpad: -----BEGIN CRASHPAD MINIDUMP-----
07-08 17:45:50.293 F crashpad: -----BEGIN CRASHPAD MINIDUMP-----
```

Crashpad (Google's crash reporting library) captured the crash and generated a minidump.

---

## Root Cause Analysis

### Likely Causes (In Order of Probability)

#### 1. Chat Template Initialization Failure (Most Likely)
**Function**: `common_chat_templates_init()`  
**Issue**: LEAP SDK trying to initialize chat templates for the LFM2.5 model

**Possible sub-causes**:
- Model metadata missing or malformed (chat template not in GGUF metadata)
- LEAP SDK expects specific template format that LFM2.5 doesn't provide
- String parsing error in template initialization code

**Evidence**:
- Crash is specifically in `common_chat_templates_init()`
- This function typically reads model metadata to set up prompt formatting
- LFM2.5 is a custom fine-tuned model - may not have standard chat templates

#### 2. Model Format Incompatibility
**Issue**: Model file format doesn't match LEAP SDK expectations

**Possible sub-causes**:
- GGUF version mismatch (model uses newer GGUF format than SDK supports)
- Quantization format (Q4_K_M) not fully supported by LEAP 0.6.0
- Missing required metadata fields in GGUF header

**Evidence**:
- Model downloaded correctly (size matches)
- Crash during load, not during download
- LEAP SDK 0.6.0 may not support all Q4_K_M variants

#### 3. Memory Issues
**Issue**: Insufficient memory to load 217MB model

**Possible sub-causes**:
- Device RAM exhausted (other apps + model loading)
- LEAP SDK memory allocation failure
- Model decompression requires more RAM than available

**Evidence**:
- Crash happens immediately on load (not during inference)
- No OOM (Out Of Memory) error in logs (would be explicit)
- Device likely has sufficient RAM (Android 12+, typical 4GB+)

**Likelihood**: Low (would see explicit OOM error)

#### 4. LEAP SDK Bug
**Issue**: Bug in LEAP SDK 0.6.0 when loading certain model types

**Evidence**:
- Stack trace is entirely within LEAP SDK code
- No user code in crash path
- Crash in chat template init (known pain point in LLaMA.cpp-based SDKs)

---

## Comparison: Why EmbeddingGemma Worked But LEAP Crashed

| Aspect | EmbeddingGemma | LEAP/LFM2.5 |
|--------|----------------|-------------|
| **Model Type** | Encoder-only (embeddings) | Decoder-only (generative LLM) |
| **Runtime** | ONNX Runtime | LEAP SDK (LLaMA.cpp) |
| **Format** | ONNX (stable, mature) | GGUF (evolving, version-sensitive) |
| **Metadata** | Minimal (just dimensions) | Complex (chat templates, tokenizer config) |
| **Load Complexity** | Low (matrix ops only) | High (parse metadata, init templates, load weights) |
| **Status** | ✓ Works (once manually deployed) | ✗ Crashes on load |

**Key Insight**: ONNX Runtime is more forgiving of model variations. LEAP SDK (wrapping LLaMA.cpp) has stricter requirements for model metadata, especially chat templates.

---

## Diagnostic Questions

### Q1: Is the model file corrupted?
**Test**: Check file hash against HuggingFace  
**Status**: Likely not - size matches expected (217MB vs 219MB)  
**Action**: Can verify with `sha256sum` if needed

### Q2: Does LEAP SDK 0.6.0 support Q4_K_M quantization?
**Status**: Unknown - need to check LEAP SDK documentation or release notes  
**Action**: Review https://docs.liquidintelligence.ai or try different quantization (Q4_0, Q8_0)

### Q3: Does the model have required metadata?
**Test**: Inspect GGUF metadata with `gguf-parser` or `llama.cpp` tools  
**Status**: Unknown - model is on HuggingFace as "medichat_v2_merged.Q4_K_M.gguf"  
**Action**: Download model to PC and inspect metadata locally

### Q4: Is this a known LEAP SDK issue?
**Action**: Check LEAP SDK GitHub issues for similar crashes in `common_chat_templates_init()`  
**URL**: https://github.com/liquid-ai-platform/leap-sdk (or equivalent)

---

## Immediate Workarounds

### Option A: Try Different Model Quantization
**Hypothesis**: Q4_K_M may not be fully supported

**Action**:
1. Check if HuggingFace repo has other quantizations:
   - Q4_0 (simpler, more compatible)
   - Q8_0 (higher quality, larger size ~400MB)
   - F16 (full precision, ~700MB)
2. Update `modelDownloader.ts` URL to point to different variant
3. Clear current model and re-download:
   ```bash
   adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf
   ```
4. Restart app to trigger download of new variant

### Option B: Downgrade LEAP SDK
**Hypothesis**: Bug in LEAP SDK 0.6.0

**Action**:
1. Try LEAP SDK 0.5.x if available
2. Update `android/app/build.gradle`:
   ```gradle
   implementation "ai.liquid.leap:leap-sdk:0.5.0"
   ```
3. Rebuild and test

### Option C: Use Different Model Entirely
**Hypothesis**: LFM2.5 custom model has incompatible metadata

**Action**:
1. Try a standard model known to work with LEAP (e.g., official LLaMA2, Mistral)
2. Update URL in `modelDownloader.ts` to known-working model
3. Test if crash is model-specific or SDK-wide issue

### Option D: Disable LEAP Backend (Emergency Rollback)
**Action**:
1. Set `USE_LEAP_BACKEND=false` in `android/app/build.gradle`
2. Rebuild app
3. App will use legacy EdgeBrain backend (non-crashing, but may have other issues)

---

## Investigation Steps

### Step 1: Inspect Model Metadata (Recommended)
**Goal**: Understand what chat template the model expects

```bash
# Download model to PC
wget https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged.Q4_K_M.gguf

# Inspect with gguf-parser (if available)
gguf-parser lfm25_350m_medichat_v2_merged.Q4_K_M.gguf | grep -i template

# Or use llama.cpp
llama.cpp/build/bin/llama-cli --model lfm25_350m_medichat_v2_merged.Q4_K_M.gguf --verbose
```

**Look for**:
- `tokenizer.chat_template` field
- `tokenizer.ggml.bos_token_id`, `eos_token_id` fields
- Any missing standard fields that LEAP expects

### Step 2: Check LEAP SDK Compatibility Matrix
**Action**: Review LEAP SDK docs for supported model types and quantizations  
**URL**: https://docs.liquidintelligence.ai/models/compatibility (or similar)

**Specific Questions**:
- Does LEAP SDK 0.6.0 support Q4_K_M?
- Are custom fine-tuned models supported?
- What chat template formats are required?

### Step 3: Test with Known-Working Model
**Goal**: Isolate whether issue is model-specific or SDK-wide

**Test Models** (known to work with LLaMA.cpp):
- TinyLlama-1.1B-Chat (small, fast test)
- Mistral-7B-Instruct-Q4_0 (if device has RAM)
- Qwen2.5-1.5B-Instruct-Q4_0 (original config in `modelDownloader.ts`)

**Action**:
1. Temporarily change URL in `modelDownloader.ts` line 25 to test model
2. Clear current model, restart app, observe if crash persists

### Step 4: Enable LEAP SDK Debug Logging
**Goal**: Get more detailed error messages before crash

**Action** (if LEAP SDK supports it):
```kotlin
// In android/app/src/main/java/com/hiva/runtime/llm/EdgeBrainPlugin.kt
// Add before LeapClient.loadModel() call
LeapClient.setLogLevel(LeapLogLevel.DEBUG)  // or equivalent
```

---

## Long-term Fix

Once root cause is identified:

### If Model Metadata Issue:
1. Fix model by re-exporting with correct metadata
2. Or patch LEAP SDK integration to provide fallback chat template
3. Document required model metadata format

### If LEAP SDK Bug:
1. File bug report with LEAP SDK team
2. Include crash logs, model file, reproduction steps
3. Wait for SDK update or apply workaround

### If Quantization Incompatibility:
1. Use supported quantization format (Q4_0 or Q8_0)
2. Update download URL permanently
3. Document which quantizations are supported

---

## Impact Assessment

### User-Facing Impact
- ✗ **LLM chat feature completely broken** (app crashes on launch if model present)
- ✗ Cannot use LEAP-based grounded generation
- ✓ Retrieval still works (EmbeddingGemma on separate code path)
- ✓ App works if model file is deleted or LEAP backend disabled

### Development Impact
- **BLOCKS**: Any LLM-based features (summarization, translation, chat)
- **BLOCKS**: LEAP/LFM2.5 testing and validation
- **UNBLOCKS**: NativeRetriever testing (separate system)

### Urgency
**HIGH**: Primary advertised feature (AI chat) is non-functional

---

## Recommended Actions (Priority Order)

### Immediate (Today)
1. ✓ **Document the crash** (this file)
2. **Try Option A**: Download different quantization (Q4_0 or Q8_0) if available
3. **If no Q4_0 available**: Try Option C (different model entirely - TinyLlama for fast test)
4. **If still crashes**: Enable Option D (disable LEAP, use legacy backend)

### Short-term (This Week)
1. **Step 1**: Inspect model metadata to understand what's missing
2. **Step 2**: Check LEAP SDK documentation for compatibility
3. **Step 3**: Contact LEAP SDK support or file GitHub issue
4. **Step 4**: Decide on permanent solution (different model, SDK update, or backend switch)

### Medium-term (Next Release)
1. Add crash handling around LEAP model loading (try/catch, fallback to legacy)
2. Add model validation before attempting load (check metadata, size, format)
3. Add user-facing error messages (not just silent crash)
4. Document supported model formats in developer docs

---

## Additional Notes

### Why Download Succeeded But Load Failed
**Download** only verifies:
- Network connectivity
- File transfer integrity (HTTP)
- File size within expected range

**Load** additionally verifies:
- File format correctness (GGUF structure)
- Metadata completeness (chat templates, tokenizer config)
- Quantization format support
- Model architecture compatibility

A corrupted or incompatible file can download successfully but fail to load.

### Comparison to EmbeddingGemma Issue
| Aspect | EmbeddingGemma | LEAP/LFM2.5 |
|--------|----------------|-------------|
| **Issue** | Never deployed to device | Downloaded but crashes on load |
| **Root Cause** | Placeholder CDN URL | Model metadata or SDK incompatibility |
| **Symptom** | Silent failure (no model) | Loud failure (app crash) |
| **Fix Complexity** | Easy (push file or fix URL) | Medium (requires model/SDK investigation) |
| **Workaround** | Manual push (done) | Disable feature or try different model |

---

## Success Criteria

The LEAP model issue is **resolved** when:
1. ✓ Model file downloads successfully (already working)
2. ✓ App loads model without crashing
3. ✓ LLM generates coherent responses to test queries
4. ✓ No memory leaks or performance degradation
5. ✓ Works on multiple devices (not just test device)

---

## Files Referenced

- `/data/user/0/com.hiva.runtime/files/models/lfm25/model.gguf` - Model file on device
- `src/services/modelDownloader.ts` - Download configuration (line 24-30)
- `android/app/src/main/java/com/hiva/runtime/llm/EdgeBrainPlugin.kt` - LEAP integration
- `android/app/build.gradle` - LEAP SDK dependency (line 101)

---

## Related Documentation

- `MODELS_DEPLOYMENT_STATUS.md` - Overall model deployment status
- `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md` - EmbeddingGemma issue analysis
- `STEP_D_DEVICE_TESTING_PROGRESS.md` - Device testing tracker

---

## Crash Logs Location

Full crash logs captured in device logcat around `2026-07-08 17:45:50`.

To extract full minidump (if Crashpad configured to save):
```bash
adb pull /data/user/0/com.hiva.runtime/cache/Crashpad/
```
