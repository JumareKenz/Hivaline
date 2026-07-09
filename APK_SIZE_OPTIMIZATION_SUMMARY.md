# APK Size Optimization - Aggressive Cleanup

**Date**: 2026-07-09  
**Strategy**: Option A - Remove ALL bundled models, download on-demand  
**Goal**: Reduce APK from 474MB → ~100MB

---

## What Was Removed

### 1. Legacy WebView Embedding Model (334MB)
- **Path**: `android/app/src/main/assets/public/models/`
- **Contents**:
  - `embed/onnx/model_quantized.onnx` (118MB) - Old EmbeddingGemma
  - `embed/hiv-cache.bin` (46MB) - Pre-built cache
  - `stt/decoder.onnx` (90MB) - Speech-to-text decoder
  - `stt/encoder.onnx` (13MB) - STT encoder
  - `tts/voice.onnx` (63MB) - TTS voice model
  - `vad/silero_vad.onnx` - Voice activity detection
- **Why**: Switched to NativeRetriever, these were unused

### 2. TTS Models (190MB)
- **Path**: `android/app/src/main/assets/models/tts/`
- **Contents**:
  - `lm_main.int8.onnx` (76MB)
  - `encoder.onnx` (73MB)
  - `decoder.int8.onnx` (23MB)
  - `lm_flow.int8.onnx` (10MB)
  - `text_conditioner.onnx` (16MB)
- **Why**: Speech I/O should be on-demand download

### 3. ONNX Runtime WASM (75MB)
- **Files**:
  - `ort-wasm-simd-threaded.jsep.wasm` (25MB)
  - `ort-wasm-simd-threaded.asyncify.wasm` (23MB)
  - `ort-wasm-simd-threaded.jspi.wasm` (14MB)
  - `ort-wasm-simd-threaded.wasm` (13MB)
- **Why**: Not needed for Android native runtime

### 4. Sherpa ONNX WASM (13MB)
- **File**: `sherpa-onnx/sherpa-onnx.wasm`
- **Why**: Using native .so libraries instead

---

## Total Removed: ~612MB

**Before**: 474MB  
**After**: ~100MB (estimated)  
**Savings**: 374MB (79% reduction)

---

## What Remains in APK

### Native Libraries (~78MB)
- LEAP SDK (LLaMA.cpp): ~15MB
- ONNX Runtime Android: ~21MB
- Sherpa ONNX Native: ~13MB
- ObjectBox: ~3MB
- EdgeBrain JNI: ~1MB
- Other libs: ~25MB

### Code & Resources (~20MB)
- React Native bridge
- Capacitor plugins
- Kotlin/Java code (dex files)
- UI assets, fonts, icons

### Web Assets (~2MB)
- JavaScript bundles
- CSS, HTML
- Small static files

**Total**: ~100MB

---

## New Architecture: On-Demand Downloads

All models now download on first use:

### LFM2.5 (219MB)
- **When**: First chat message
- **From**: HuggingFace (Kenzlejaze/hiva-medichat-v2-gguf)
- **Status**: ✓ Fixed model with chat template ready to upload

### EmbeddingGemma (300MB)
- **When**: User enables retrieval feature
- **From**: HuggingFace (Kenzlejaze/hiva-models)
- **Format**: Q8 ONNX (best balance for embeddings)

### Speech Models (Optional)
- **TTS Pipeline**: ~200MB (download when user enables voice output)
- **STT Pipeline**: ~100MB (download when user enables voice input)
- **From**: To be configured

---

## Benefits

### ✓ User Experience
- **Faster install**: 100MB vs 474MB (79% smaller)
- **Less data usage**: Users only download what they need
- **Lower storage**: Base app uses 100MB, not 500MB
- **Progressive loading**: App works while models download

### ✓ Development
- **Faster builds**: No large files in assets
- **Easier updates**: Push model updates without APK rebuild
- **Smaller repo**: Models not tracked in git
- **Faster CI/CD**: Build times reduced

### ✓ Distribution
- **Higher conversion**: More users complete install
- **Lower bandwidth costs**: 79% less CDN usage
- **Play Store friendly**: Under 150MB recommendation
- **Better for low-end phones**: Limited storage users can install

---

## Trade-offs

### ✗ First-Run Experience
- **Network required**: Can't work fully offline immediately
- **Download wait**: 2-5 minutes for LFM2.5 on first chat
- **Failure cases**: Poor network = frustrated users

### ✗ Hosting Costs
- **HuggingFace bandwidth**: Free tier limits may apply
- **CDN needed for scale**: HF not ideal for production traffic
- **Monitoring**: Need to track download success rates

---

## Mitigation Strategies

### 1. Smart Download UX
```
- Show progress bars with ETA
- Allow background download
- Cache models between app reinstalls (if storage permits)
- Resume interrupted downloads
```

### 2. Preloading
```
- Start LFM2.5 download on app first open
- Download in background while user explores UI
- By the time they tap "Chat", model is ready
```

### 3. Offline Mode
```
- Show clear "Download required" message
- Offer "Download now" vs "Remind me later"
- Allow browsing cached content without models
```

### 4. CDN Strategy
```
- Use HuggingFace for beta/testing
- Move to proper CDN (Cloudflare R2, AWS S3) for production
- Implement model versioning for updates
```

---

## Code Changes Required

### modelDownloader.ts
- ✓ Already configured for on-demand LFM2.5 download
- ✓ Chunked download with progress tracking
- ✓ Resume capability

### NativeRetrieverPlugin.kt
- ✓ Already supports downloadEmbeddingModel()
- ✓ URL updated to HuggingFace
- Downloads 300MB Q8 model on first use

### Speech I/O
- ⏳ TODO: Implement on-demand TTS/STT download
- Currently expects bundled models (will break)
- Need to add download logic before enabling feature

---

## Next Steps

### 1. Upload Models to HuggingFace
```bash
python quick_upload.py        # LFM2.5 (219MB)
python upload_embedding.py    # EmbeddingGemma (300MB)
```

### 2. Test New APK
```bash
# Build completed: check size
ls -lh android/app/build/outputs/apk/debug/app-debug.apk

# Install and test
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Verify first-run experience
# - App installs quickly
# - Chat triggers LFM2.5 download
# - Download completes successfully
# - Model loads without crash
```

### 3. Monitor Download Success Rate
- Track completion rate in analytics
- Alert if <95% success rate
- A/B test preload vs on-demand

### 4. Plan Speech I/O Re-enable
- Implement TTS/STT on-demand download
- Test download flow
- Add UI for "Enable voice" with download prompt

---

## Verification

### Before Cleanup
```
APK: 474MB
Assets: 526MB (models + WASM)
Native libs: 78MB
Code: 20MB
```

### After Cleanup
```
APK: ~100MB (estimated, build in progress)
Assets: 2MB (web bundles only)
Native libs: 78MB (unchanged)
Code: 20MB (unchanged)
```

### Expected Breakdown
| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| Models | 524MB | 0MB | -524MB |
| WASM | 88MB | 1.3MB | -87MB |
| Native libs | 78MB | 78MB | 0MB |
| Code | 20MB | 20MB | 0MB |
| **Total** | **474MB** | **~100MB** | **-374MB** |

---

## Success Metrics

### Installation
- [ ] APK size ≤ 120MB
- [ ] Install time < 30 seconds on 4G
- [ ] Install completion rate > 90%

### First-Run Downloads
- [ ] LFM2.5 download success rate > 95%
- [ ] EmbeddingGemma download success rate > 90%
- [ ] Average download time < 5 minutes on 4G

### User Experience
- [ ] Chat available within 5 min of install
- [ ] Clear progress indication during downloads
- [ ] Resume works if connection drops

---

## Rollback Plan

If download failure rates are too high:

### Emergency: Bundle LFM2.5 Only
```bash
# Add back LFM2.5 to assets
mkdir -p android/app/src/main/assets/models/lfm25
cp models/lfm25_fixed_Q4_K_M.gguf android/app/src/main/assets/models/lfm25/model.gguf

# Rebuild
./android/gradlew assembleDebug

# Result: 319MB APK (still better than 474MB)
```

### Full Rollback
```bash
# Restore from git
git checkout android/app/src/main/assets/

# Result: Back to 474MB
```

---

## Related Files

- `modelDownloader.ts` - LFM2.5 download logic
- `NativeRetrieverPlugin.kt` - EmbeddingGemma download
- `quick_upload.py` - Script to upload LFM2.5
- `upload_embedding.py` - Script to upload EmbeddingGemma
- `LFM25_FIX_COMPLETE_INSTRUCTIONS.md` - Model fix details
- `QUANTIZATION_SETUP.md` - Quantization guide

---

## Notes

- SQL WASM (645KB × 2 = 1.3MB) kept - needed for web fallback
- GIF/video assets (~10MB) kept - used in UI
- Documentation files NOT in APK (they're in project root, not assets)
- Native .so files can't be reduced further without removing features
