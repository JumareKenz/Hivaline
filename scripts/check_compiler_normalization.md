# Compiler-Side Normalization Verification

## Critical Question

Does the compiler that produces embeddings.bin files apply re-normalization after Matryoshka truncation (768 → 256 dims)?

## Context

From session summary:
> The compiler is real and current. It produces schema hiv-3.0 bundles with EmbeddingGemma-300M vectors, 256-dim (Matryoshka-truncated from 768), L2-normalized, in the documented portable binary format (index/embeddings.bin + index/embeddings_index.json)

## Evidence Required

**What we know:**
- Compiler produces 256-dim embeddings in embeddings.bin
- These are claimed to be "L2-normalized"
- Runtime reads these as float32 values

**What we must verify:**
The compiler's truncation code MUST do this:
```python
# Correct (re-normalizes after truncation)
full_embedding = model(text)  # [768], already normalized
truncated = full_embedding[:256]
truncated = truncated / np.linalg.norm(truncated)  # Re-normalize!
write_to_embeddings_bin(truncated)

# WRONG (just slices, loses unit norm)
full_embedding = model(text)  # [768], already normalized
truncated = full_embedding[:256]  # Norm drops to ~0.605
write_to_embeddings_bin(truncated)  # BAD - under-normalized
```

## Empirical Verification Steps

### Step 1: Obtain a Real .hiv Bundle
Get any schema 3.0 .hiv file produced by the compiler:
- From the user's actual deployment
- From the compiler's test output
- From a staging environment

### Step 2: Extract embeddings.bin
```bash
unzip bundle.hiv index/embeddings.bin
```

### Step 3: Compute L2 Norms
```python
import numpy as np
import struct

with open('index/embeddings.bin', 'rb') as f:
    # Read header
    count = struct.unpack('<I', f.read(4))[0]
    dims = struct.unpack('<I', f.read(4))[0]
    
    print(f"Embeddings: {count} vectors, {dims} dimensions")
    
    # Read all vectors
    data = np.fromfile(f, dtype=np.float32).reshape(count, dims)
    
    # Compute norms
    norms = np.linalg.norm(data, axis=1)
    
    print(f"\nNorm statistics:")
    print(f"  Min: {norms.min():.10f}")
    print(f"  Max: {norms.max():.10f}")
    print(f"  Mean: {norms.mean():.10f}")
    print(f"  Std: {norms.std():.10f}")
    
    # Check if normalized (all norms should be ~1.0)
    unit_norm = np.abs(norms - 1.0) < 0.01
    pct_normalized = unit_norm.sum() / len(norms) * 100
    
    print(f"\nPercentage with unit norm (0.99 < norm < 1.01): {pct_normalized:.1f}%")
    
    if pct_normalized > 99:
        print("\n✓ PASS: Compiler-side embeddings are correctly normalized")
    else:
        print("\n✗ FAIL: Compiler-side embeddings are NOT normalized")
        print("  This means every existing .hiv bundle needs to be regenerated")
        
        # Show examples of non-normalized vectors
        bad_idx = np.where(~unit_norm)[0][:5]
        print(f"\n  Example non-normalized vectors:")
        for idx in bad_idx:
            print(f"    Vector {idx}: norm = {norms[idx]:.6f}")
```

### Step 4: Decision Tree

**If norms are ~1.0 (PASS):**
- Compiler is correct
- Proceed with Kotlin integration as planned
- Runtime only needs to:
  1. Load fused model
  2. Run inference → get [1, 768]
  3. Truncate to [:256]
  4. Re-normalize (because runtime does its own truncation)

**If norms are NOT ~1.0 (FAIL):**
- Every existing .hiv bundle has under-normalized document vectors
- This silently degrades cosine similarity in ObjectBox HNSW search
- **STOP Kotlin integration**
- **Report to user** - this is a bundle regeneration problem
- Must fix compiler, regenerate all bundles
- Cannot fix with runtime-only changes

## Current Status

**NO EMPIRICAL VERIFICATION YET**

Need actual .hiv file to test. Without this:
- Cannot confirm compiler correctness
- Cannot proceed safely to Kotlin integration
- Risk: deploying runtime that works correctly but searches against incorrectly-normalized document vectors

## Recommendation

**BLOCK on obtaining and testing a real schema 3.0 .hiv bundle before proceeding to NativeRetrieverPlugin.kt integration.**

If no .hiv file available:
1. Ask user to provide one, OR
2. Ask user to confirm compiler code includes re-normalization after truncation, OR
3. Proceed with explicit caveat that runtime correctness doesn't guarantee search correctness if compiler has this bug
