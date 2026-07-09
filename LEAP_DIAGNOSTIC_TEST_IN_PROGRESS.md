# LEAP Crash Diagnostic Test - In Progress

**Date**: 2026-07-08 17:56  
**Test**: TinyLlama-1.1B Q4_K_M (known-working model, SAME quantization as LFM2.5)  
**Purpose**: Isolate whether crash is SDK/integration issue vs. LFM2.5 model-specific issue

---

## Test Setup

### Change Made
**File**: `src/services/modelDownloader.ts`

**Before** (LFM2.5):
```typescript
url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged.Q4_K_M.gguf',
expectedSizeMB: 219,
```

**After** (TinyLlama):
```typescript
url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
expectedSizeMB: 669,
```

### Why TinyLlama?
1. **Widely used**: Standard test model in LLaMA.cpp ecosystem
2. **Same quantization**: Q4_K_M (identical to LFM2.5)
3. **Well-maintained**: TheBloke's GGUF conversions are reference implementations
4. **Known metadata**: Has proper chat templates and tokenizer config

### Why NOT Change Quantization Format?
Per user instruction: Don't guess at quantization incompatibility without evidence. Testing same format (Q4_K_M) with different model isolates the variable.

---

## Test Progress

### Build & Deploy
- [x] Modified `modelDownloader.ts` with TinyLlama URL
- [x] Built web assets with Vite (TypeScript errors bypassed)
- [x] Synced to Android with Capacitor
- [x] Rebuilt Android APK
- [x] Installed on device

### LFM2.5 Model Backup
```bash
adb shell run-as com.hiva.runtime mv files/models/lfm25/model.gguf files/models/lfm25/model.gguf.lfm25_backup
# Backup: 217MB LFM2.5 model preserved as model.gguf.lfm25_backup
```

### Download Progress
**Start**: 17:56:37  
**Current** (17:59:01): 172MB / 669MB expected (~26%)  
**Rate**: ~10-15 MB per 10 seconds  
**ETA**: ~5-8 more minutes

**Status**: ✓ Downloading smoothly, no errors

| Time | Size | Rate |
|------|------|------|
| 17:57:08 | 20MB | - |
| 17:57:19 | 35MB | 15MB/11s |
| 17:57:29 | 47MB | 12MB/10s |
| 17:57:39 | 57MB | 10MB/10s |
| 17:57:49 | 67MB | 10MB/10s |
| 17:58:00 | 72MB | 5MB/11s |
| 17:58:10 | 82MB | 10MB/10s |
| 17:58:20 | 102MB | 20MB/10s |
| 17:58:30 | 122MB | 20MB/10s |
| 17:58:40 | 127MB | 5MB/10s |
| 17:58:51 | 152MB | 25MB/11s |
| 17:59:01 | 172MB | 20MB/10s |

**Average rate**: ~15MB/10s = ~1.5MB/s

---

## Observations So Far

### ✓ No Crashes Yet
**Checked**:
- No `crashpad` minidumps
- No `FATAL` errors
- No `SIGSEGV` signals
- No `common_chat_templates_init` crashes
- No process deaths for `com.hiva.runtime`

**Conclusion**: App is stable during download phase (same as LFM2.5)

### ✓ Download Infrastructure Working
- HuggingFace URL resolved correctly
- Chunked `appendFile` writes progressing
- File growing steadily in `files/models/lfm25/model.gguf.tmp`

**Conclusion**: Download mechanism is model-agnostic (as expected)

---

## Next Steps

### When Download Completes (Expected: ~18:04)
1. **Monitor for rename**: `.tmp` → `.gguf`
2. **Watch for load attempt**: LEAP SDK will try to initialize model
3. **Critical moment**: `common_chat_templates_init()` call

### Possible Outcomes

#### Outcome A: TinyLlama Loads Successfully ✓
**Interpretation**: Crash is LFM2.5 model-specific, NOT an SDK issue

**Next actions**:
1. Inspect LFM2.5 GGUF metadata with `gguf-dump` or equivalent
2. Check for missing `tokenizer.chat_template` field
3. Check for malformed metadata or missing required fields
4. Compare LFM2.5 metadata against TinyLlama

**Likely fixes**:
- Re-export LFM2.5 with proper metadata
- OR supply fallback chat template in EdgeBrainPlugin.kt
- OR patch LFM2.5 GGUF file with correct metadata

#### Outcome B: TinyLlama Also Crashes at common_chat_templates_init() ✗
**Interpretation**: Bug is in LEAP SDK 0.6.0 or integration code, NOT model-specific

**Next actions**:
1. Check LEAP SDK release notes for known issues
2. Review EdgeBrainPlugin.kt integration code
3. Check if chat template must be provided explicitly (not auto-detected)
4. Try LEAP SDK 0.5.x if available

**Likely fixes**:
- Update LEAP SDK to patched version
- OR add explicit chat template configuration in plugin
- OR file bug report with LEAP SDK team

#### Outcome C: TinyLlama Crashes at Different Location
**Interpretation**: Different issue than LFM2.5 (quantization, memory, etc.)

**Next actions**:
- Compare crash stack traces
- Determine if both crashes are manifestations of same root cause
- Investigate common factor (Q4_K_M support, GGUF version, etc.)

---

## Test Metrics

### Performance
- **Download speed**: ~1.5MB/s (acceptable for 4G/WiFi)
- **Memory usage**: TBD (will check after load)
- **App responsiveness**: ✓ No UI freezing during download

### Stability
- **Crashes during download**: 0
- **Network errors**: 0
- **File corruption**: None detected (size growing consistently)

---

## Comparison: LFM2.5 vs. TinyLlama

| Aspect | LFM2.5 (Original) | TinyLlama (Test) |
|--------|-------------------|------------------|
| **Model Size** | 219MB (expected), 217MB (actual) | 669MB (expected), TBD (actual) |
| **Quantization** | Q4_K_M | Q4_K_M (SAME) |
| **Source** | Kenzlejaze/hiva-medichat-v2-gguf | TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF |
| **Model Type** | LFM2.5-350M (custom fine-tune) | TinyLlama-1.1B (standard) |
| **Download** | ✓ Successful | ⏳ In progress (26%) |
| **Load** | ✗ Crashes at common_chat_templates_init | ⏳ Pending |
| **Metadata** | Unknown (suspected missing fields) | ✓ Known good (TheBloke standard) |

---

## Files Modified

### Source Changes
- `src/services/modelDownloader.ts` - LEAP_MODEL_CONFIG URL changed

### Backup Created
- `/data/user/0/com.hiva.runtime/files/models/lfm25/model.gguf.lfm25_backup` (217MB)

### Revert Procedure
If test fails or need to restore LFM2.5:
```bash
# Stop app
adb shell am force-stop com.hiva.runtime

# Remove TinyLlama
adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf

# Restore LFM2.5
adb shell run-as com.hiva.runtime mv files/models/lfm25/model.gguf.lfm25_backup files/models/lfm25/model.gguf

# Revert source code
# Edit modelDownloader.ts back to LFM2.5 URL
# Rebuild and reinstall
```

---

## Timeline

| Time | Event |
|------|-------|
| 17:45 | LFM2.5 download completed (217MB) |
| 17:45 | LFM2.5 load attempted → CRASH at common_chat_templates_init() |
| 17:50 | Decision: Diagnose before patching (per user instruction) |
| 17:51 | Modified modelDownloader.ts with TinyLlama URL |
| 17:52 | Built web assets, synced to Android |
| 17:53 | Rebuilt and installed APK |
| 17:56 | Backed up LFM2.5 model |
| 17:56 | Launched app, TinyLlama download started |
| 17:57-17:59 | Download progressing (20MB → 172MB) |
| ~18:04 | Expected download completion |
| ~18:04 | Expected load attempt (CRITICAL TEST) |

---

## Related Documentation

- `LEAP_MODEL_CRASH_REPORT.md` - Full crash analysis of LFM2.5
- `MODELS_DEPLOYMENT_STATUS.md` - Overall model deployment status
- `EMBEDDING_MODEL_BUNDLING_ROOT_CAUSE.md` - EmbeddingGemma issue (separate)

---

## Notes

### Why This Test Matters
- Avoids wasting time/bandwidth on wrong fixes (e.g., downloading different quantization)
- Identifies root cause before applying patches
- Saves ~200-600MB download if quantization isn't the issue
- Follows scientific method: isolate variables, test hypothesis

### If TinyLlama Succeeds
**Proves**: LFM2.5 model file has metadata issues  
**Does NOT prove**: Quantization format is the problem (both are Q4_K_M)  
**Next step**: Inspect LFM2.5 metadata, not change quantization

### If TinyLlama Fails
**Proves**: LEAP SDK 0.6.0 has bug or integration is wrong  
**Does NOT prove**: Model files are fine (could be multiple issues)  
**Next step**: Fix SDK/integration, THEN re-test LFM2.5

---

## Status: ⏳ AWAITING DOWNLOAD COMPLETION

Current: 172MB / 669MB (~26%)  
ETA: ~5-8 minutes  
Next update: When download completes or crash occurs
