# bge-m3 q4 Quantization - ACTUAL MEASUREMENT ATTEMPT

**Date**: 2026-07-02  
**Task**: Empirically measure q4 and q4f16 inference latency vs q8 baseline  
**Status**: IN PROGRESS - Download failures encountered

---

## Acknowledgment of Prior Error

The prior investigation (BGE_M3_Q4_QUANTIZATION_INVESTIGATION.md) **incorrectly declined to measure q4 variants** based on file size reasoning. That approach had a critical flaw:

**Flawed reasoning**: "Larger file size → slower inference" treated storage representation size as predictive of runtime compute cost.

**Why this was wrong**: QDQ format overhead affects STORED WEIGHT SIZE (file bytes on disk), not necessarily RUNTIME COMPUTE PATH latency. The actual dequantize-and-compute operations during inference can behave differently than file size alone would suggest. **Only empirical measurement can confirm this.**

This task corrects that error by running actual tests.

---

## Baseline Confirmation

**Prior q8 measurement** (from BGE_M3_PERFORMANCE_RESULTS.md):
- **Model**: Xenova/bge-m3 `model_quantized.onnx` (int8/q8)
- **Size**: 544MB
- **Cold load**: 4.0s (3.0x slower than MiniLM's 1.4s)
- **Warm inference**: **79ms average** (8.1x slower than MiniLM's 10ms)
- **Memory**: 2.1GB RSS single model
- **Environment**: Windows 11 Desktop, Node.js, @xenova/transformers v2.17.2

**Test queries** (10 identical queries for apples-to-apples comparison):
1. "How do I treat HIV?"
2. "Dosage for children 5-10kg"
3. "What are the symptoms of tuberculosis?"
4. "When should I refer a patient?"
5. "Malaria prophylaxis for pregnant women"
6. "Side effects of artemisinin"
7. "How to diagnose pneumonia"
8. "Treatment for severe malnutrition"
9. "Signs of dehydration"
10. "Vaccination schedule for infants"

---

## q4 Variants to Test

### Variant 1: model_q4.onnx
- **Source**: `Xenova/bge-m3/onnx/model_q4.onnx`
- **Expected size**: 1,190MB (2.2x LARGER than q8)
- **Quantization**: 4-bit weights in QDQ format
- **Hypothesis**: May be slower due to larger size, OR may be comparable/faster if dequantization overhead is lower than 8-bit compute cost

### Variant 2: model_q4f16.onnx
- **Source**: `Xenova/bge-m3/onnx/model_q4f16.onnx`
- **Expected size**: 668MB (1.2x LARGER than q8)
- **Quantization**: 4-bit weights + fp16 activations (hybrid)
- **Hypothesis**: Mixed precision - may have lower compute overhead despite larger file

---

## Download Attempts

### Attempt 1: Initial downloads (background curl)
**Started**: 09:26 UTC  
**Status**: FAILED - Connection instability

**q4 progress**: 725MB of 1,190MB downloaded (61% complete) before connection reset  
**q4f16 progress**: 44MB of 668MB downloaded (7% complete) before connection reset

**Error**: `curl: (35) Recv failure: Connection was reset`

**Analysis**: Network connection unstable for large file downloads. HuggingFace CDN may have rate limiting or the local connection is intermittent.

### Attempt 2: Resume with retry logic
**Started**: 09:34 UTC  
**Command**: `curl -f -L -C - --retry 3 --retry-delay 5`  
**Status**: FAILED - File locking

**Error**: `rm: cannot remove 'public/models/bge-m3-q4/onnx/model_quantized.onnx': Device or resource busy`

**Analysis**: Partial files from Attempt 1 were locked by prior curl processes. Cleanup failed.

### Attempt 3: Clean download to new filename (CURRENT)
**Started**: 09:37 UTC  
**Command**: `curl -L --max-time 3600 -o model_q4_new.onnx` (background)  
**Status**: IN PROGRESS

**Strategy**: Download to fresh filename to avoid file locking issues. Will rename on success.

---

## Test Environment Constraints

**Disk space**: 176GB free (sufficient)  
**Memory**: Not measured (Windows environment, no `free` command)  
**Network**: Unstable for >500MB downloads  
**Download tools**: Only `curl` available (no `wget`, `aria2c`)

**Assessment**: The test environment CAN handle the file sizes (plenty of disk space, 2.1GB q8 model loaded successfully in prior test), but network connectivity is the blocker.

---

## Measurement Plan (Once Downloads Complete)

### Test Harness
**Script**: `test-quantization-comparison-actual.mjs`

**Methodology** (identical to q8 baseline):
1. **Cold load**: `performance.now()` around `pipeline()` call
2. **Warm inference**: Average of 10 identical queries (listed above)
3. **Memory**: `process.memoryUsage()` RSS and External
4. **Embedding quality**: Cosine similarity vs q8 reference embedding

### Metrics to Report

For each variant (q4, q4f16):
- **Cold load time** (ms) - compare to q8's 4,026ms
- **Avg warm latency** (ms) - compare to q8's 79ms and MiniLM's 10ms
- **Latency multiplier** vs MiniLM - compare to q8's 8.1x
- **Latency ratio** vs q8 - faster or slower?
- **Memory RSS** (MB) - compare to q8's 2,169MB
- **Embedding similarity** vs q8 - quality check (cosine similarity, expect >0.95)

### Pass/Fail Criteria

**Measurement succeeds if**:
- Model loads without error
- Produces 1024-dim embeddings
- Completes all 10 test queries
- Reports actual numbers for all metrics

**Measurement fails if** (requirement #5 - concrete failure reasons):
- Download cannot complete after multiple attempts
- Model file is corrupted/incomplete
- Model fails to load in @xenova/transformers
- Out of memory during load or inference
- Inference errors or timeouts

---

## Current Status: DOWNLOAD IN PROGRESS

**q4 (1,190MB)**: Downloading via background task `b2red9z2q`  
**q4f16 (668MB)**: Not yet started (waiting for q4 to complete first)

**Estimated time**: 
- q4: ~20-30 minutes at typical speeds (1,190MB)
- q4f16: ~10-15 minutes at typical speeds (668MB)
- **Total**: ~30-45 minutes if no further connection failures

---

## Interim Conclusion

**Can the measurement be completed?**: Unknown - depends on network stability.

**If downloads succeed**: Will run actual tests and report empirical latency data.

**If downloads fail persistently**: Will report under requirement #5:
> "Attempted and failed for X concrete reason: Network connection unstable, unable to download 1.2GB files after multiple retry attempts. Test environment network cannot reliably handle multi-hundred-megabyte downloads from HuggingFace CDN."

**Why this matters**: The task correctly identified that file-size-based reasoning is insufficient. Only actual measurement can answer "does q4 close the latency gap?" But if the measurement is blocked by environmental constraints (network), that is a valid finding in itself - it documents that the hypothesis could not be tested in this specific environment, not that it was declined based on prediction.

---

**Report will be updated once downloads complete (or fail definitively).**
