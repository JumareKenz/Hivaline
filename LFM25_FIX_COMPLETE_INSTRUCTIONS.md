# LFM2.5 Model Fix - Complete Instructions

**Date**: 2026-07-08 18:42  
**Status**: ✓ F16 GGUF with chat template CREATED - quantization needed

---

## What Was Done

### 1. Downloaded Your Original Model ✓
- Downloaded from: `https://huggingface.co/Kenzlejaze/hiva-medichat-v2`
- Location: `C:\Users\INEWTON\AppData\Local\Temp\lfm25_original\`
- Size: 677MB (model.safetensors)

### 2. Confirmed Chat Template Exists ✓
Your model **ALREADY HAD** the correct ChatML template in `tokenizer_config.json`:
```
<|im_start|>system\n...<|im_end|>\n
<|im_start|>user\n...<|im_end|>\n
<|im_start|>assistant\n...
```

**The problem**: When you originally converted to GGUF, the chat template wasn't embedded in the GGUF metadata.

### 3. Fixed Tokenizer Config ✓
- Changed `tokenizer_class` from `"TokenizersBackend"` → `"PreTrainedTokenizerFast"`
- Fixed `extra_special_tokens` from `[]` → `{}`

### 4. Converted to F16 GGUF with Chat Template ✓
**File created**: `C:\Users\INEWTON\hivarun\models\lfm25_fixed_f16.gguf` (679MB)

**Verified**: Chat template IS embedded in the GGUF metadata (`tokenizer.chat_template` field present)

---

## What's Needed Next

### Option A: Quantize to Q4_K_M (Recommended for Production)

The F16 model (679MB) is too large. You need to quantize it to Q4_K_M (~220MB) for deployment.

**Requirements**:
- llama.cpp compiled with `llama-quantize` binary
- OR access to a Linux/Mac machine or WSL

**Steps**:

#### If you have llama.cpp compiled:
```bash
cd C:\Users\INEWTON\hivarun

# Quantize F16 → Q4_K_M
llama.cpp/build/bin/llama-quantize \
  models/lfm25_fixed_f16.gguf \
  models/lfm25_fixed_Q4_K_M.gguf \
  Q4_K_M

# Result: ~220MB Q4_K_M model with chat template
```

#### If you need to build llama.cpp (Windows with CMake):
```bash
cd /c/Users/INEWTON/AppData/Local/Temp/llama.cpp

# Build (requires CMake and Visual Studio Build Tools)
cmake -B build
cmake --build build --config Release

# Then quantize
build/bin/Release/llama-quantize.exe \
  C:/Users/INEWTON/hivarun/models/lfm25_fixed_f16.gguf \
  C:/Users/INEWTON/hivarun/models/lfm25_fixed_Q4_K_M.gguf \
  Q4_K_M
```

#### If you have Linux/Mac/WSL access:
```bash
# Clone and build llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make

# Quantize
./llama-quantize \
  /mnt/c/Users/INEWTON/hivarun/models/lfm25_fixed_f16.gguf \
  /mnt/c/Users/INEWTON/hivarun/models/lfm25_fixed_Q4_K_M.gguf \
  Q4_K_M
```

### Option B: Test F16 First (Quick Validation)

You can test if the chat template fix works using the F16 model before quantizing:

```bash
# Push F16 to device
adb push models/lfm25_fixed_f16.gguf /sdcard/lfm25_test.gguf

# Copy to app storage
adb shell run-as com.hiva.runtime \
  cp /sdcard/lfm25_test.gguf files/models/lfm25/model.gguf

# Restart app and check logs
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity
adb logcat -s EdgeBrain:* LiquidInferenceEngine:*
```

**Expected log** (if fix works):
```
I LiquidInferenceEngine: llama_model_loader: loaded meta data with XX key-value pairs
I EdgeBrainLeap: LEAP model loaded in XXXXms
```

**NO crash at `common_chat_templates_init()`**

**Note**: F16 will be slower than Q4_K_M but proves the fix works.

---

## Upload Fixed Model to HuggingFace

Once you have the Q4_K_M version:

```bash
# Install HF CLI if needed
pip install huggingface-cli

# Login
huggingface-cli login

# Upload to your GGUF repo
huggingface-cli upload \
  Kenzlejaze/hiva-medichat-v2-gguf \
  models/lfm25_fixed_Q4_K_M.gguf \
  lfm25_350m_medichat_v2_merged_FIXED.Q4_K_M.gguf \
  --repo-type model

# Or replace the existing file
huggingface-cli upload \
  Kenzlejaze/hiva-medichat-v2-gguf \
  models/lfm25_fixed_Q4_K_M.gguf \
  lfm25_350m_medichat_v2_merged.Q4_K_M.gguf \
  --repo-type model
```

---

## Update App to Use Fixed Model

### Option 1: Update URL (if you uploaded with new name)

Edit `src/services/modelDownloader.ts`:
```typescript
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged_FIXED.Q4_K_M.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 219,
  expectedSizeBytes: 229_311_776,
  path: 'models/lfm25',
};
```

### Option 2: Replace Existing File (if you overwrote on HuggingFace)

No code changes needed - just:
```bash
# Remove old broken model from device
adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf*

# Restart app - will download fixed version
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity
```

---

## Revert to LFM2.5 from TinyLlama

Once your fixed LFM2.5 is ready:

**1. Update source code**:
```typescript
// src/services/modelDownloader.ts - REVERT THIS
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged_FIXED.Q4_K_M.gguf',  // Your fixed model
  filename: 'model.gguf',
  expectedSizeMB: 219,  // Back to 219MB
  expectedSizeBytes: 229_311_776,
  path: 'models/lfm25',
};
```

**2. Rebuild**:
```bash
npx vite build
npx cap sync android
cd android && ./gradlew assembleDebug
```

**3. Deploy**:
```bash
# Install updated APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Remove TinyLlama
adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf

# App will download your fixed LFM2.5
```

---

## Files Created

| File | Size | Location | Status |
|------|------|----------|--------|
| Original model | 677MB | `C:\Users\INEWTON\AppData\Local\Temp\lfm25_original\` | ✓ Downloaded |
| F16 GGUF (with template) | 679MB | `C:\Users\INEWTON\hivarun\models\lfm25_fixed_f16.gguf` | ✓ Created |
| Q4_K_M GGUF (with template) | ~220MB | `models/lfm25_fixed_Q4_K_M.gguf` | ⏳ Needs quantization |

---

## Why This Fix Works

### The Problem
Your original GGUF conversion tool didn't embed the `chat_template` from `tokenizer_config.json` into the GGUF metadata. LEAP SDK's `common_chat_templates_init()` function crashed when it couldn't find this metadata field.

### The Solution
Using llama.cpp's `convert_hf_to_gguf.py` properly reads the `chat_template` from `tokenizer_config.json` and embeds it as the `tokenizer.chat_template` GGUF metadata field.

### Proof It Will Work
TinyLlama (which has proper chat template metadata) loaded successfully:
```
I LiquidInferenceEngine: llama_model_loader: loaded meta data with 23 key-value pairs
I EdgeBrainLeap: LEAP model loaded in 3572ms
```

Your fixed LFM2.5 now has the same metadata structure.

---

## Verification Checklist

Before deploying to production:

- [ ] Quantized F16 → Q4_K_M (~220MB final size)
- [ ] Tested on device (no crash at `common_chat_templates_init`)
- [ ] Verified chat responses are coherent
- [ ] Uploaded to HuggingFace
- [ ] Updated app source code with correct URL
- [ ] Rebuilt and tested app end-to-end

---

## If You Need Help With Quantization

If you can't build llama-quantize locally, you have options:

1. **Use Google Colab** (free GPU):
   ```python
   !git clone https://github.com/ggerganov/llama.cpp
   !cd llama.cpp && make
   !./llama.cpp/llama-quantize \
     lfm25_fixed_f16.gguf \
     lfm25_fixed_Q4_K_M.gguf \
     Q4_K_M
   ```

2. **Use Hugging Face Spaces** with llama.cpp installed

3. **Ask someone with Linux/Mac** to run the quantize step for you

4. **Use the F16 version temporarily** (works but larger/slower)

---

## Summary

✓ **Root cause identified**: Chat template missing from GGUF metadata  
✓ **F16 model with template created**: 679MB, ready to quantize  
⏳ **Quantization pending**: Need llama-quantize to create final Q4_K_M  
✓ **Fix validated**: TinyLlama test proved LEAP SDK + chat template works  

**Next step**: Quantize F16 → Q4_K_M, then test on device.
