# Kaggle Build Fix - llama-quantize Not Found

## Debug Steps

Run these cells one at a time to identify the issue:

### Cell 1: Check if llama.cpp exists
```python
import os
print("Checking llama.cpp directory...")
if os.path.exists("llama.cpp"):
    print("✓ llama.cpp directory exists")
    print("\nContents:")
    !ls -la llama.cpp | head -20
else:
    print("✗ llama.cpp directory not found!")
    print("Need to clone it first")
```

### Cell 2: Check if binary was built
```python
print("Looking for llama-quantize binary...")
!find llama.cpp -name "llama-quantize" -o -name "quantize" 2>/dev/null
print("\nChecking common locations:")
!ls -la llama.cpp/llama-quantize 2>/dev/null || echo "Not in root"
!ls -la llama.cpp/build/bin/llama-quantize 2>/dev/null || echo "Not in build/bin"
!ls -la llama.cpp/quantize 2>/dev/null || echo "Old 'quantize' not found"
```

### Cell 3: Re-clone and build (if needed)
```bash
# Clean up old clone if it's broken
rm -rf llama.cpp

# Clone fresh
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Build with verbose output
echo "Building llama.cpp..."
make clean
make llama-quantize -j$(nproc)

# Verify binary exists
ls -lh llama-quantize
echo "✓ Build complete!"
```

### Cell 4: Alternative - Build everything
```bash
cd llama.cpp

# Build all targets (includes llama-quantize)
make clean
make -j$(nproc)

# List all binaries
echo "Built binaries:"
ls -lh llama-* 2>/dev/null | grep -v "\.o$"
```

---

## Common Issues & Fixes

### Issue 1: Build Failed Silently

**Symptom**: Directory exists but no binary

**Fix**: Build with explicit target and check for errors
```bash
cd llama.cpp
make llama-quantize 2>&1 | tee build.log
cat build.log | grep -i error
```

### Issue 2: Binary in Different Location

**Symptom**: Build succeeded but binary not where expected

**Fix**: Search for it
```bash
find . -name "*quantize*" -type f -executable 2>/dev/null
```

Possible locations:
- `./llama.cpp/llama-quantize` (current versions)
- `./llama.cpp/quantize` (old versions)
- `./llama.cpp/build/bin/llama-quantize` (CMake build)

### Issue 3: Wrong llama.cpp Version

**Symptom**: Old version that used different binary name

**Fix**: Use the old binary name
```bash
# Old versions called it just "quantize"
./llama.cpp/quantize input.gguf output.gguf Q4_K_M
```

---

## Working Quantization Code (After Build Succeeds)

Once you confirm the binary exists, use this:

```python
import os
import subprocess

# Find the quantize binary
binary_paths = [
    "llama.cpp/llama-quantize",
    "llama.cpp/quantize",
    "llama.cpp/build/bin/llama-quantize",
]

quantize_bin = None
for path in binary_paths:
    if os.path.exists(path) and os.access(path, os.X_OK):
        quantize_bin = path
        print(f"✓ Found binary: {quantize_bin}")
        break

if not quantize_bin:
    raise FileNotFoundError("llama-quantize binary not found! Run build steps above.")

# Run quantization
input_file = "/kaggle/working/lfm25_fixed_f16.gguf"
output_file = "/kaggle/working/lfm25_fixed_Q4_K_M.gguf"

print(f"\nQuantizing...")
print(f"  Input:  {input_file}")
print(f"  Output: {output_file}")
print(f"  Method: Q4_K_M\n")

cmd = [
    f"./{quantize_bin}",
    input_file,
    output_file,
    "Q4_K_M"
]

result = subprocess.run(cmd, capture_output=False)

if result.returncode == 0:
    size_mb = os.path.getsize(output_file) / (1024 * 1024)
    print(f"\n✓ Success! Output: {size_mb:.1f}MB")
else:
    print(f"\n✗ Failed with exit code {result.returncode}")
```

---

## Complete Working Script for Kaggle

Copy-paste this into cells:

```python
# Cell 1: Clean build
!rm -rf llama.cpp
!git clone https://github.com/ggerganov/llama.cpp
!cd llama.cpp && make llama-quantize -j$(nproc)
!ls -lh llama.cpp/llama-quantize  # Verify it exists
```

```python
# Cell 2: Copy your F16 file to working directory
import os, shutil
for root, dirs, files in os.walk("/kaggle/input"):
    for f in files:
        if "lfm25" in f and f.endswith(".gguf"):
            src = os.path.join(root, f)
            dst = "/kaggle/working/lfm25_fixed_f16.gguf"
            shutil.copy(src, dst)
            print(f"✓ Copied: {f} ({os.path.getsize(dst) / 1024**2:.1f}MB)")
            break
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
import os
output = "/kaggle/working/lfm25_fixed_Q4_K_M.gguf"
if os.path.exists(output):
    size = os.path.getsize(output) / (1024**2)
    print(f"✓ Output ready: {size:.1f}MB")
    print("Download from Output panel →")
else:
    print("✗ Output file not created")
```

---

## If Build Still Fails

### Option A: Use Pre-built Binary

Kaggle might have compatibility issues. Try using a pre-compiled llama.cpp:

```bash
# Download pre-built release
wget https://github.com/ggerganov/llama.cpp/releases/download/b1000/llama-b1000-bin-ubuntu-x64.zip
unzip llama-b1000-bin-ubuntu-x64.zip
chmod +x llama-quantize

# Quantize
./llama-quantize \
    /kaggle/working/lfm25_fixed_f16.gguf \
    /kaggle/working/lfm25_fixed_Q4_K_M.gguf \
    Q4_K_M
```

### Option B: Use Python GGUF Library (Slower but Works)

```python
# Install gguf package
!pip install -q gguf

# Use Python script to quantize
!python -m gguf.quantize \
    /kaggle/working/lfm25_fixed_f16.gguf \
    /kaggle/working/lfm25_fixed_Q4_K_M.gguf \
    --type Q4_K_M
```

### Option C: Use Google Colab Instead

If Kaggle continues to have issues, Colab is more reliable:
- Use `quantize_lfm25_colab.ipynb` instead
- Same process, just different platform

---

## What to Check Right Now

Run this in Kaggle to diagnose:

```bash
echo "=== Checking llama.cpp ==="
ls -la llama.cpp 2>/dev/null | head -10

echo -e "\n=== Looking for binaries ==="
find llama.cpp -name "*quantize*" -type f 2>/dev/null

echo -e "\n=== Checking if we can build ==="
which gcc g++ make
```

This will tell us exactly what's wrong.
