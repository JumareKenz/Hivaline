# bge-m3 Dense-Only Retrieval - FINAL VERDICT

**Date**: 2026-07-02  
**Task**: Real measurements and validation of bge-m3 migration  
**Scope**: Dense-only (no sparse vectors - confirmed infeasible in browser runtime)

---

## Executive Summary

**Question**: Is bge-m3 dense-only retrieval good enough to ship on real v2.3 bundles today?

**Answer**: **NO - Not recommended for production deployment**

The actual measured performance characteristics make bge-m3 unsuitable for deployment without significant optimizations or architectural changes:

1. ✅ Model loads and produces correct 1024-dim embeddings (no technical blockers)
2. ❌ **8.1x slower inference** (79ms vs 10ms per query) - unacceptable latency regression
3. ❌ **2.5GB dual-model memory** - likely untenable on low-end devices  
4. ❌ **Recall testing blocked** - no v2.3 bundle available to validate quality improvement
5. ⚠️ **544MB download** - manageable but requires user warning

**Recommendation**: **DO NOT DEPLOY** until either:
- Significant performance optimizations are implemented (see recommendations), OR
- Recall testing proves the quality improvement is dramatic enough to justify the performance trade-off, AND
- Dual-model scenario is eliminated (aggressive v2.2 deprecation or lazy loading)

---

## Detailed Findings

### Step 1: Model Download ✅ COMPLETE

**Model**: Xenova/bge-m3  
**Quantization**: int8 (model_quantized.onnx)  
**Actual Size**: **544MB** (not the 280-550MB range - actual measured)

| Component | Size |
|-----------|------|
| ONNX Model | 544MB |
| Tokenizer | 17MB |
| Total Package | 561MB |
| **vs MiniLM** | **4.8x larger** |

**Status**: ✅ Successfully downloaded and integrated

---

### Step 2: Performance Measurements ✅ COMPLETE

**Environment**: Windows 11, Node.js, @xenova/transformers v2.17.2 (desktop, not actual mobile device)

#### 2.1 Cold Model Load Time

| Model | Time | Comparison |
|-------|------|------------|
| MiniLM (v2.2) | 1.4s | Baseline |
| **bge-m3 (v2.3)** | **4.0s** | **3.0x slower** ❌ |

**Impact**: Noticeable delay on first bundle load. Acceptable if it's one-time per device lifetime.

---

#### 2.2 Warm Inference Latency (CRITICAL FINDING)

| Model | Avg | Min | Max | vs Baseline |
|-------|-----|-----|-----|-------------|
| MiniLM (v2.2) | 10ms | 7ms | 15ms | Baseline |
| **bge-m3 (v2.3)** | **79ms** | **58ms** | **118ms** | **8.1x slower** 🔴 |

**Impact**: 
- Every search query adds 69ms latency
- User-perceived sluggishness
- Compounds across multi-turn conversations
- May feel unacceptably slow on low-end devices

**This is the PRIMARY BLOCKER for deployment.**

---

#### 2.3 Memory Footprint

**Single Model**:

| Model | Total Memory (RSS) | Model Memory (External) |
|-------|-------------------|------------------------|
| MiniLM alone | 651MB | 259MB |
| **bge-m3 alone** | **2,100MB** | **1,088MB** |
| **Ratio** | **3.2x** | **4.2x** |

**Dual Model (CRITICAL SCENARIO)**:

| Scenario | Total Memory | Incremental |
|----------|-------------|-------------|
| MiniLM only | 651MB | - |
| **Both loaded** | **2,514MB** | **+1,794MB** 🔴 |

**Impact**:
- **2.5GB RAM** for users with mixed v2.2/v2.3 bundles
- Likely triggers OOM kills on 2GB devices
- 3.9x more memory than MiniLM alone
- **This is the SECONDARY BLOCKER for deployment**

---

### Step 3: v2.3 Test Bundle ❌ NOT AVAILABLE

**Status**: No v2.3 bundle found in repository or accessible for testing.

**Impact**: 
- Cannot validate end-to-end recall
- Cannot measure actual score distributions for confidence calibration
- Cannot test dense-only vs hybrid search modes
- **Blocks completion of Steps 4 and 5**

**What was checked**:
- Repository search for .hiv/.hiva files: None found
- Compiler team sample bundle: Not accessible in this environment
- test-embedding-recall.mjs exists but needs a bundle to test against

**Recommendation**: Before any deployment decision, must obtain:
1. Real v2.3 bundle from compiler (with or without lexical.json)
2. Run recall harness from test-embedding-recall.mjs
3. Measure actual bge-m3 dense score distributions
4. Validate confidence thresholds

---

### Step 4: Recall Testing ❌ BLOCKED

**Status**: Cannot complete without v2.3 bundle (Step 3 blocker).

**What would be tested**:
- 15-query clinical harness from test_bge_m3_retrieval_regression.py
- Recall@10 comparison: bge-m3 vs MiniLM vs compiler's server-side results
- Real score distributions for confidence calibration
- Dense-only mode vs hybrid search (if lexical.json present)

**Missing data**:
- Actual Recall@10 for bge-m3 in this runtime
- Comparison to MiniLM baseline
- Degradation from ONNX quantization vs server-side FlagEmbedding
- Dense-only mode quality vs hybrid search

---

### Step 5: Confidence Calibration ❌ BLOCKED

**Status**: Cannot complete without real score data from Step 4.

**Current thresholds** (MiniLM-calibrated):
- Vector cosine floor: 0.3
- Vector margin: 10% separation
- BM25 floor: 1.5
- Dense-only floor: 0.4 (stricter)

**What needs to be measured**:
- bge-m3 dense score distribution across real queries
- Whether 0.3/0.4 floors transfer or need adjustment
- Whether 10% margin is appropriate for bge-m3 clusters
- Dense-only mode confidence characteristics

---

### Step 6: llama.cpp Test Failures ✅ CONFIRMED PRE-EXISTING

**Status**: Verified via git stash + baseline test run.

**Finding**: The 53 llama.cpp test failures are **pre-existing** (present on main branch before my changes).

**Evidence**: Tests fail identically with code changes stashed. The failures are from missing test files in the llama.cpp submodule, unrelated to the bge-m3 migration.

---

## Critical Blockers

### 🔴 BLOCKER 1: Inference Latency (8.1x Slowdown)

**Problem**: 79ms per query vs 10ms baseline

**Why this matters**:
- Clinical queries happen frequently (multiple per conversation)
- 69ms added latency is user-perceptible
- Low-end devices will be even slower
- Real mobile/WebView environment may be worse than Node.js desktop

**Possible solutions**:
1. **q4 quantization** instead of q8 (may improve speed, test required)
2. **WASM SIMD optimizations** in ONNX Runtime (if not already enabled)
3. **GPU acceleration** via WebGPU (requires browser support, significant work)
4. **Smaller model**: Use bge-small or bge-base instead of bge-m3 (loses quality)
5. **Caching**: Cache query embeddings for repeated queries (limited benefit)
6. **Accept the trade-off**: IF recall is dramatically better (needs testing)

**None of these solutions are implemented or validated.**

---

### 🔴 BLOCKER 2: Dual-Model Memory (2.5GB)

**Problem**: Users with both v2.2 and v2.3 bundles cached use 2.5GB RAM

**Why this matters**:
- Many low-end devices have 2-3GB total RAM
- 2.5GB for the app alone triggers OOM kills
- Users cannot easily clear old bundles
- Happens automatically during gradual v2.3 rollout

**Possible solutions**:
1. **Aggressive v2.2 deprecation**: Force all users to v2.3 immediately (risky)
2. **Lazy model loading**: Only load model needed for active bundle (complex)
3. **Explicit model unloading**: Free MiniLM when switching to v2.3 (requires implementation)
4. **User warning**: Advise clearing cache, but most won't do it
5. **Smaller bge-m3**: q4 quantization reduces size (needs testing)

**None of these solutions are implemented.**

---

## Incomplete Work (Due to Blockers)

### Not Measured:
- ❌ Recall@10 (no v2.3 bundle)
- ❌ Real score distributions (no v2.3 bundle)
- ❌ Confidence threshold validation (no score data)
- ❌ Dense-only vs hybrid search comparison (no v2.3 bundle)
- ❌ Real mobile device performance (tested on desktop only)
- ❌ WebView/browser environment performance (tested in Node.js only)

### Why it matters:
Without recall data, we cannot determine if the 8.1x latency penalty is justified by improved answer quality. **The performance trade-off cannot be evaluated without this critical data.**

---

## Comparison to Prior Task's Estimates

| Metric | Prior Estimate | ACTUAL | Accuracy |
|--------|---------------|--------|----------|
| Model size | 280-550MB | **544MB** | ✅ High end of range |
| Inference latency | "may be slower" | **8.1x slower** | ❌ Underestimated severity |
| Dual memory | "~430-735MB" | **2,514MB** | ❌ **OFF BY 3-4x** |
| Recall improvement | "needs testing" | **UNTESTED** | ⚠️ Still unknown |

**Key finding**: The prior task significantly underestimated the memory footprint. It estimated model file sizes, not runtime memory consumption.

---

## Recommendations

### Immediate (Before Any Deployment)

1. **Obtain real v2.3 bundle** from compiler team
2. **Run recall harness** (test-embedding-recall.mjs with bge-m3)
3. **Measure actual recall improvement** vs MiniLM baseline
4. **Test on real Android device** (not desktop Node.js)
5. **Test in WebView environment** (actual deployment target)

### If Recall Testing Shows Significant Improvement

Even if recall is much better, address blockers:

1. **Investigate q4 quantization**:
   - May reduce model size by ~50%
   - May improve inference speed
   - Test quality impact

2. **Implement lazy model loading**:
   - Only load model needed for active bundle
   - Explicitly unload unused model
   - Prevents 2.5GB dual-residency scenario

3. **Add user warnings**:
   - "Downloading 544MB model" before first v2.3 use
   - "High memory usage detected" if both models resident
   - Option to clear old bundles

4. **Aggressive v2.2 deprecation timeline**:
   - Rapid rollout to minimize dual-model window
   - Force-update old bundles
   - Clear communication to users

### If Recall Testing Shows Marginal Improvement

**DO NOT DEPLOY** bge-m3. The performance penalties are not justified.

**Alternative**:
- Keep MiniLM for v2.2
- Keep v2.3 format changes (schema detection, etc.) but use MiniLM
- Investigate other optimization paths for recall (better BM25, query rewriting, etc.)

---

## What WAS Accomplished

Despite the negative verdict, significant work was completed:

✅ **Code Implementation** (from prior task):
- Schema version detection (v2.2/v2.3)
- Dual embedding model support
- Missing lexical.json handling
- Dense-only search mode
- Comprehensive tests (32/32 passing)

✅ **Actual Measurements** (this task):
- Real model download and integration (544MB)
- Cold load time measurement (4.0s vs 1.4s)
- Warm inference latency (79ms vs 10ms) - **CRITICAL FINDING**
- Memory footprint single (2.1GB) and dual (2.5GB) - **CRITICAL FINDING**
- Confirmed llama.cpp failures pre-existing

✅ **Documentation**:
- Performance results (BGE_M3_PERFORMANCE_RESULTS.md)
- Deployment checklist (BGE_M3_DEPLOYMENT_CHECKLIST.md)
- Implementation summary (BGE_M3_IMPLEMENTATION_SUMMARY.md)
- This final verdict

---

## Final Answer

**Is bge-m3 dense-only retrieval, as actually measured, good enough to ship on real v2.3 bundles today?**

**NO.**

The measured performance characteristics (8.1x slower inference, 2.5GB dual-model memory) are **deal-breakers** without:

1. **Recall validation** proving dramatic quality improvement (BLOCKED - no v2.3 bundle)
2. **Performance optimizations** (q4 quantization, lazy loading) - NOT IMPLEMENTED
3. **Real mobile testing** confirming desktop measurements translate (NOT DONE)

**Conditional path forward**:
1. Get v2.3 bundle
2. Run recall test
3. IF recall is significantly better (>10% improvement) AND optimizations can reduce latency to <30ms AND dual-model scenario is eliminated → Reconsider
4. IF recall is marginal → Abandon bge-m3 entirely

**Current status**: Implementation code exists but deployment is **NOT RECOMMENDED** based on actual measurements.

---

## Appendix: Test Commands Run

```bash
# Model download (ACTUAL size: 544MB)
curl -L -C - -o public/models/bge-m3/onnx/model_quantized.onnx \\
  "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model_quantized.onnx"

# Performance tests
node test-bge-m3-load.mjs           # Cold: 4026ms, Warm: 79ms avg, Memory: 2169MB
node test-minilm-baseline.mjs      # Cold: 1353ms, Warm: 10ms avg, Memory: 719MB  
node test-dual-model-memory.mjs    # Both loaded: 2514MB total

# Pre-existing test failures
git stash
npm test -- "android/app/src/main/cpp/llama.cpp/tools/ui/tests/unit/mcp-service.test.ts" --run
# Result: FAIL (same as with changes) → Confirmed pre-existing
git stash pop
```

---

**Report Date**: 2026-07-02  
**Environment**: Windows 11 Desktop, Node.js, @xenova/transformers v2.17.2  
**Note**: Real mobile device testing still required for production decision
