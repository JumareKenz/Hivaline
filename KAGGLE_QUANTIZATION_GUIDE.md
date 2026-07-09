# LFM2.5 Quantization on Kaggle - Quick Guide

**Input**: `models/lfm25_fixed_f16.gguf` (679MB)  
**Output**: `lfm25_fixed_Q4_K_M.gguf` (~220MB)  
**Time**: ~5-10 minutes

---

## Steps

### 1. Create New Notebook
- Go to https://www.kaggle.com/
- Click "Create" → "New Notebook"
- Name it: "LFM2.5 Quantization"

### 2. Upload Your F16 Model

**Option A: Upload as Dataset (Recommended for large files)**
1. Click "Add Data" (top right)
2. Click "Upload" tab
3. Click "New Dataset"
4. Select `C:\Users\INEWTON\hivarun\models\lfm25_fixed_f16.gguf`
5. Wait for upload to complete (679MB - may take 5-10 min depending on connection)
6. Once uploaded, it will be in `/kaggle/input/<dataset-name>/`

**Option B: Upload to Notebook Directly**
1. Click "Add Data" → "Upload"
2. Select the F16 file
3. It will be accessible in `/kaggle/input/`

### 3. Import and Run Notebook

**Option 1: Upload the notebook I created**
1. Click "File" → "Import Notebook"
2. Upload: `C:\Users\INEWTON\hivarun\quantize_lfm25_kaggle.ipynb`
3. Click "Run All" (or Shift+Enter through each cell)

**Option 2: Copy-paste the code cells**
Just run these cells in order:

```python
# Cell 1: Build llama.cpp
!git clone https://github.com/ggerganov/llama.cpp
!cd llama.cpp && make -j$(nproc)
```

```python
# Cell 2: Find and copy your uploaded file to working directory
import os
import shutil

# Find the file (adjust path if needed)
for root, dirs, files in os.walk("/kaggle/input"):
    for file in files:
        if "lfm25" in file and file.endswith(".gguf"):
            input_path = os.path.join(root, file)
            print(f"Found: {input_path}")
            shutil.copy(input_path, "/kaggle/working/lfm25_fixed_f16.gguf")
            print("✓ Copied to working directory")
            break

!ls -lh /kaggle/working/lfm25_fixed_f16.gguf
```

```python
# Cell 3: Quantize
!./llama.cpp/llama-quantize \
    /kaggle/working/lfm25_fixed_f16.gguf \
    /kaggle/working/lfm25_fixed_Q4_K_M.gguf \
    Q4_K_M
```

```python
# Cell 4: Verify
!ls -lh /kaggle/working/lfm25_fixed_Q4_K_M.gguf
print("✓ Quantization complete!")
```

### 4. Download Output

**Option A: Direct download**
1. Look in the right panel → "Output" section
2. Click on `lfm25_fixed_Q4_K_M.gguf` to download

**Option B: Save version**
1. Click "Save Version" (top right)
2. Choose "Save & Run All (Commit)"
3. Wait for it to finish
4. Go to "Output" tab → Download the file

---

## After Download

### 1. Test on Device (Recommended)

```bash
# Push to device
adb push lfm25_fixed_Q4_K_M.gguf /sdcard/test.gguf

# Copy to app storage
adb shell run-as com.hiva.runtime \
  cp /sdcard/test.gguf files/models/lfm25/model.gguf

# Restart app
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity

# Watch logs for success
adb logcat -s EdgeBrain:* LiquidInferenceEngine:*
```

**✓ Success**:
```
I LiquidInferenceEngine: llama_model_loader: loaded meta data with XX key-value pairs
I EdgeBrainLeap: LEAP model loaded in XXXXms
```

**✗ Failure** (shouldn't happen):
```
F DEBUG: common_chat_templates_init
```

### 2. Upload to HuggingFace

```bash
# Install HF CLI if not already
pip install huggingface-hub

# Login
huggingface-cli login

# Upload (replaces broken file)
huggingface-cli upload \
  Kenzlejaze/hiva-medichat-v2-gguf \
  lfm25_fixed_Q4_K_M.gguf \
  lfm25_350m_medichat_v2_merged.Q4_K_M.gguf \
  --repo-type model
```

### 3. Update App Code

Edit `src/services/modelDownloader.ts`:

```typescript
// REVERT from TinyLlama diagnostic to fixed LFM2.5
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged.Q4_K_M.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 219,
  expectedSizeBytes: 229_311_776,  // Update if actual size differs
  path: 'models/lfm25',
};
```

### 4. Rebuild and Deploy

```bash
# Rebuild
npx vite build
npx cap sync android
cd android && ./gradlew assembleDebug

# Install
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Remove old model (force fresh download)
adb shell run-as com.hiva.runtime rm files/models/lfm25/model.gguf

# Restart - will download fixed model from HuggingFace
adb shell am force-stop com.hiva.runtime
adb shell am start -n com.hiva.runtime/.MainActivity
```

---

## Troubleshooting

### "Upload Failed" / "File Too Large"
Kaggle supports files up to 20GB, so 679MB should be fine. If it fails:
- Try Option A (Upload as Dataset) instead of Option B
- Check your internet connection
- Try again - sometimes uploads timeout

### "make: command not found"
Shouldn't happen on Kaggle (it has build tools), but if it does:
- Make sure you're running in a Kaggle Notebook, not Kaggle Scripts
- Try using `!apt-get update && apt-get install -y build-essential`

### Different Output Size
The Q4_K_M size depends on model architecture. Anything from 210-230MB is normal:
- Update `expectedSizeBytes` in modelDownloader.ts to match actual size
- Formula: `size_in_mb * 1024 * 1024` = bytes

### Can't Find Output File
After running all cells:
- Check `/kaggle/working/` directory
- Run: `!ls -la /kaggle/working/*.gguf`
- If not there, check the quantization cell output for errors

---

## File Locations Reference

| Location | Purpose | Example |
|----------|---------|---------|
| `/kaggle/input/<dataset-name>/` | Uploaded datasets | Your F16 file |
| `/kaggle/working/` | Notebook working directory | Build artifacts, outputs |
| `/kaggle/temp/` | Temporary files | llama.cpp clone |

---

## Complete Cell-by-Cell Script

If you prefer to just copy-paste into Kaggle:

```python
# Cell 1
!git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make -j$(nproc)

# Cell 2
import os, shutil
for root, dirs, files in os.walk("/kaggle/input"):
    for f in files:
        if "lfm25" in f and f.endswith(".gguf"):
            shutil.copy(os.path.join(root, f), "/kaggle/working/lfm25_fixed_f16.gguf")
            print(f"✓ Found and copied: {f}")
            break

# Cell 3
!ls -lh /kaggle/working/lfm25_fixed_f16.gguf

# Cell 4
!./llama.cpp/llama-quantize /kaggle/working/lfm25_fixed_f16.gguf /kaggle/working/lfm25_fixed_Q4_K_M.gguf Q4_K_M

# Cell 5
!ls -lh /kaggle/working/lfm25_fixed_Q4_K_M.gguf
print("✓ Done! Download from Output panel →")
```

---

## Summary

1. **Upload F16 to Kaggle** (5-10 min)
2. **Run notebook cells** (5 min)
3. **Download Q4_K_M** (2-3 min)
4. **Test on device** (2 min)
5. **Upload to HuggingFace** (2 min)
6. **Update app & rebuild** (5 min)

**Total time**: ~20-30 minutes

See `LFM25_FIX_COMPLETE_INSTRUCTIONS.md` for full background.
