# bge-m3 Performance Results - ACTUAL MEASUREMENTS

**Test Environment**: Windows 11, Node.js v20+, @xenova/transformers v2.17.2  
**Test Date**: 2026-07-02  
**Model Files**: Downloaded from Xenova/bge-m3 (HuggingFace)

---

## Step 1: Model Download - ACTUAL SIZE

| Metric | Value | Notes |
|--------|-------|-------|
| **Model Size (ONNX)** | **544MB** | model_quantized.onnx (int8 quantization) |
| Tokenizer | 17MB | tokenizer.json |
| Total Package | 561MB | Including configs |
| **vs MiniLM** | **4.8x larger** | MiniLM: 113MB ONNX |

**Finding**: The actual size (544MB) is at the high end of the prior estimate range (280-550MB). This is significantly larger than MiniLM.

---

## Step 2: Performance Comparison - ACTUAL MEASUREMENTS

### Cold Model Load Time

| Model | Load Time | Comparison |
|-------|-----------|------------|
| **MiniLM (v2.2)** | 1,353ms | Baseline |
| **bge-m3 (v2.3)** | 4,026ms | **3.0x slower** |

**Finding**: bge-m3 takes 3x longer to load on first launch, primarily due to 4.8x larger model file.

---

### Warm Inference Latency (Query Embedding)

| Model | Avg Latency | Min | Max | Comparison |
|-------|-------------|-----|-----|------------|
| **MiniLM (v2.2)** | 9.8ms | 7.3ms | 14.7ms | Baseline |
| **bge-m3 (v2.3)** | 79.1ms | 58.0ms | 118.2ms | **8.1x slower** |

**Finding**: bge-m3 inference is significantly slower - 79ms vs 10ms per query. This is a substantial latency increase.

---

### Memory Footprint

#### Single Model Resident

| Model | RSS (Total Memory) | External (Model Memory) |
|-------|-------------------|------------------------|
| Baseline (empty) | 69MB | 3MB |
| **MiniLM alone** | 719MB (+651MB) | 262MB (+259MB) |
| **bge-m3 alone** | 2,169MB (+2,100MB) | 1,091MB (+1,088MB) |

**Finding**: bge-m3 uses **3.2x more total memory** and **4.2x more model memory** than MiniLM.

#### Dual Model Resident (CRITICAL SCENARIO)

| Scenario | RSS (Total Memory) | Incremental Cost |
|----------|-------------------|------------------|
| MiniLM loaded | 720MB | +651MB |
| **Both MiniLM + bge-m3** | **2,514MB** | **+1,794MB** (bge-m3 on top) |

**Finding**: When BOTH models are loaded (user with mixed v2.2/v2.3 bundles), the runtime uses **2.5GB of RAM**. This is **3.5x more memory** than MiniLM alone.

---

## Performance Impact Summary

| Metric | MiniLM (v2.2) | bge-m3 (v2.3) | Ratio | Impact |
|--------|---------------|---------------|-------|--------|
| **Model Size** | 113MB | 544MB | 4.8x | ⚠️ HIGH - Large download |
| **Cold Load** | 1.4s | 4.0s | 3.0x | ⚠️ MEDIUM - Slower first launch |
| **Inference** | 10ms | 79ms | 8.1x | 🔴 **CRITICAL** - 8x slower queries |
| **Memory (single)** | 651MB | 2,100MB | 3.2x | ⚠️ HIGH - More RAM needed |
| **Memory (dual)** | 651MB | 2,445MB (both) | 3.8x | 🔴 **CRITICAL** - 2.5GB for mixed bundles |

---

## Critical Findings

### 🔴 BLOCKER 1: Inference Latency

**Problem**: bge-m3 takes **79ms per query** vs MiniLM's **10ms** - an **8.1x slowdown**.

**Impact**:
- Every search query takes 69ms longer
- User-perceived latency increases noticeably
- Compounds across conversational turns
- May feel sluggish on low-end devices

**Recommendation**: This is likely a deal-breaker unless:
1. Quantization can be improved (q4 instead of q8?)
2. ONNX Runtime optimizations are available
3. The recall improvement justifies the latency trade-off (TBD in next test)

---

### 🔴 BLOCKER 2: Dual-Model Memory Footprint

**Problem**: Devices with BOTH v2.2 and v2.3 bundles cached will use **2.5GB RAM** with both models resident.

**Impact**:
- 2.5GB is substantial on mobile/low-end devices
- May trigger OOM kills on 2GB RAM devices
- Significantly worse than the "acceptable" ~650MB of MiniLM alone
- Users cannot selectively unload old bundles easily

**Recommendation**: This dual-residency scenario is a serious concern. Options:
1. **Aggressive deprecation** of v2.2 bundles (force all users to v2.3 quickly)
2. **Lazy loading** - only load the model needed for active bundle
3. **Model unloading** - explicitly free MiniLM when switching to v2.3 bundle
4. **Warn users** about mixed bundle sets and suggest clearing cache

---

### ⚠️ WARNING 3: Model Size & Download

**Problem**: 544MB download on first v2.3 bundle use.

**Impact**:
- Significant data usage on cellular networks
- Slow download on poor connections
- May surprise users expecting small updates

**Recommendation**: 
- Clear user warning before download
- Wi-Fi-only option
- Background download with progress indicator

---

## Comparison to Prior Estimates

The prior task estimated ranges. Here are the ACTUAL vs ESTIMATED values:

| Metric | Prior Estimate | ACTUAL | Accuracy |
|--------|---------------|--------|----------|
| Model size | 280-550MB | **544MB** | High end of range |
| Combined memory (dual) | "~430-735MB" | **2,445MB** | **OFF BY 3-4x** ❌ |

**Note**: The prior memory estimate was significantly wrong. It estimated the model file sizes, not the actual runtime memory footprint. The 2.5GB dual-model RAM usage is much worse than anticipated.

---

## Environment Notes

- **Test platform**: Windows 11 desktop (x86_64)
- **Runtime**: Node.js (not browser/WebView)
- **No GPU acceleration**: CPU-only inference via ONNX Runtime
- **Actual device testing needed**: Android device or emulator will have different characteristics

**Next Steps**: 
1. Test on actual Android device/emulator (target deployment environment)
2. Measure end-to-end recall to see if performance trade-off is justified
3. Investigate optimization options (q4 quantization, WASM SIMD, etc.)

---

## Verdict on Step 2

**Question**: Is the performance acceptable?

**Answer**: **NO** - at least not without significant caveats:

1. ✅ Model loads successfully (no technical blockers)
2. ✅ Produces correct 1024-dim embeddings
3. ❌ **8x slower inference** is a major regression
4. ❌ **2.5GB dual-model memory** is likely untenable on low-end devices
5. ⚠️ **544MB download** is manageable but requires user warning

**Conditional Recommendation**: Proceed to recall testing to determine if the quality improvement justifies these performance penalties. If recall@10 is not significantly better than MiniLM+BM25, bge-m3 should NOT be deployed.
