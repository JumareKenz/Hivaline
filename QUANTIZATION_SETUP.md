# LFM2.5 Quantization Setup - Quick Start

**Status**: F16 model ready at `models/lfm25_fixed_f16.gguf` (679MB)  
**Goal**: Quantize to Q4_K_M (~220MB) for production deployment  

---

## Option 1: Google Colab (RECOMMENDED - Easiest)

**Time**: ~5 minutes  
**Cost**: FREE  
**Requirements**: Google account only  

### Steps:

1. **Open Colab**:
   - Go to https://colab.research.google.com/
   - Click "File" → "Upload notebook"
   - Upload: `C:\Users\INEWTON\hivarun\quantize_lfm25_colab.ipynb`

2. **Run all cells** (click "Runtime" → "Run all")
   - Cell 1: Clones and builds llama.cpp (~2 min)
   - Cell 2: Prompts you to upload F16 file (~1 min depending on connection)
   - Cell 3: Verifies file uploaded
   - Cell 4: Quantizes F16 → Q4_K_M (~1 min)
   - Cell 5: Shows output size
   - Cell 6: Downloads Q4_K_M file

3. **Download result**:
   - Click download link in Cell 6
   - Save as `lfm25_fixed_Q4_K_M.gguf`

**DONE!** Skip to "After Quantization" section below.

---

## Option 2: WSL (Windows Subsystem for Linux)

**Time**: ~10 minutes  
**Requirements**: WSL installed  

### Check if WSL is installed:
```bash
wsl --list
```

### If not installed:
```powershell
# Run in PowerShell as Administrator
wsl --install
# Restart computer
```

### Once WSL is ready:
```bash
# Enter WSL
wsl

# Navigate to your model
cd /mnt/c/Users/INEWTON/hivarun

# Clone and build llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make -j$(nproc)

# Quantize
./llama-quantize \
  ../models/lfm25_fixed_f16.gguf \
  ../models/lfm25_fixed_Q4_K_M.gguf \
  Q4_K_M

# Exit WSL
exit
```

**Output**: `C:\Users\INEWTON\hivarun\models\lfm25_fixed_Q4_K_M.gguf`

---

## Option 3: Linux/Mac (If Available)

```bash
cd ~/Downloads  # or wherever you want to work

# Clone and build
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make -j$(nproc)

# Copy F16 file here (via USB, cloud, etc.)
# Then quantize
./llama-quantize \
  lfm25_fixed_f16.gguf \
  lfm25_fixed_Q4_K_M.gguf \
  Q4_K_M
```

---

## After Quantization

### 1. Test on Device (Recommended Before Upload)

```bash
# Push quantized model to device
adb push models/lfm25_fixed_Q4_K_M.gguf /sdcard/lfm25_test.gguf

# Copy to app storage
adb shell run-as com.hiva.runtime \
  cp /sdcard/lfm25_test.gguf files/models/lfm25/model.gguf

# Restart app
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity

# Watch logs
adb logcat -s EdgeBrain:* LiquidInferenceEngine:*
```

**✓ Success looks like**:
```
I LiquidInferenceEngine: llama_model_loader: loaded meta data with XX key-value pairs
I EdgeBrainLeap: LEAP model loaded in XXXXms
```

**✗ Failure (shouldn't happen)**:
```
F DEBUG: common_chat_templates_init
```

### 2. Upload to HuggingFace

```bash
# Install HF CLI (if not already installed)
pip install huggingface-hub

# Login (opens browser for authentication)
huggingface-cli login

# Upload - REPLACE the broken file with fixed one
huggingface-cli upload \
  Kenzlejaze/hiva-medichat-v2-gguf \
  models/lfm25_fixed_Q4_K_M.gguf \
  lfm25_350m_medichat_v2_merged.Q4_K_M.gguf \
  --repo-type model

# Verify upload
# Visit: https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf
# Should see updated file with today's date
```

### 3. Update App Source Code

Edit `src/services/modelDownloader.ts`:

```typescript
// BEFORE (TinyLlama diagnostic):
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 669,
  expectedSizeBytes: 669_000_000,
  path: 'models/lfm25',
};

// AFTER (Fixed LFM2.5):
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged.Q4_K_M.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 219,
  expectedSizeBytes: 229_311_776,
  path: 'models/lfm25',
};
```

### 4. Rebuild and Deploy

```bash
# Rebuild web assets
npx vite build

# Sync to Android
npx cap sync android

# Build APK
cd android && ./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Remove old model (force fresh download of fixed version)
adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf

# Restart app - will download your fixed model
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity

# Monitor download and load
adb logcat -s ModelDownloader:* EdgeBrain:* LiquidInferenceEngine:*
```

---

## Verification Checklist

Before calling this complete:

- [ ] Quantized model is ~220MB (not 679MB)
- [ ] Model loads on device without crash
- [ ] Model generates coherent responses
- [ ] Uploaded to HuggingFace with correct filename
- [ ] App source code updated to use fixed model
- [ ] APK rebuilt and tested end-to-end
- [ ] Old TinyLlama diagnostic model removed from device

---

## Troubleshooting

### "Upload failed - file too large"
- Colab upload limit is 100MB for free tier
- Use WSL or Linux option instead
- Or upload directly from a machine with HF CLI installed

### "Quantization produces different size"
- Q4_K_M size varies slightly by model architecture
- Anywhere from 210-230MB is normal for a 350M parameter model
- Update `expectedSizeBytes` in modelDownloader.ts to match actual size

### "Model still crashes on device"
- Verify you uploaded the RIGHT file (lfm25_fixed_Q4_K_M.gguf, not the old broken one)
- Check HuggingFace file has today's timestamp
- Re-download and inspect metadata with llama-cli if available
- If still crashes, the F16 → Q4_K_M quantization may have corrupted metadata (rare)
  - In that case, test the F16 version directly (slower but works)

---

## Files Created

| File | Size | Purpose | Status |
|------|------|---------|--------|
| `models/lfm25_fixed_f16.gguf` | 679MB | F16 with chat template | ✓ Ready |
| `models/lfm25_fixed_Q4_K_M.gguf` | ~220MB | Quantized for production | ⏳ Needs quantization |
| `quantize_lfm25_colab.ipynb` | - | Colab notebook for quantization | ✓ Ready to use |

---

## Summary

**Easiest path**: 
1. Upload Colab notebook → Run all cells → Download Q4_K_M
2. Test on device
3. Upload to HuggingFace
4. Update app code
5. Done!

**Total time**: ~15 minutes (including upload/download)

See `LFM25_FIX_COMPLETE_INSTRUCTIONS.md` for full context and background.
