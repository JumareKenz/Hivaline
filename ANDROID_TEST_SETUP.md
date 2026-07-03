# BGE-M3 Quantization Test - Android Setup

**Date**: 2026-07-02  
**Task**: Measure q8/q4/q4f16 performance on actual Android hardware  
**Status**: Setup complete, ready for manual testing

---

## Hardware Confirmed

**Test Device**: Android Emulator `emulator-5554`
- **Model**: Medium Phone (Google reference)
- **RAM**: 2GB (2048MB)
- **CPU**: x86_64, 4 cores (emulated)
- **Android**: API 36.1 (Android 15)
- **Architecture**: x86_64

### ⚠️ CRITICAL LIMITATION

This is **NOT representative target hardware**:

1. **Architecture mismatch**: x86_64 emulator vs ARM production devices
2. **Performance**: x86 emulators typically 2-4x FASTER than real ARM devices due to host CPU passthrough
3. **ONNX Runtime**: Different code paths for x86 vs ARM
4. **Optimizations**: ARM-specific optimizations (NEON, XNNPACK) not exercised on x86

**Expected behavior**: 
- Any latency measurements from this emulator will be **optimistic**
- Real ARM devices will be **slower** (potentially 2-4x)
- 2GB RAM constraint IS realistic for testing memory limits

**Recommendation**: Results must be flagged as "x86 emulator - real ARM devices expected to be 2-4x slower"

---

## Models Prepared

All three quantization variants are ready for testing:

| Variant | File Size | Location | Status |
|---------|-----------|----------|--------|
| **q8 (baseline)** | 560MB | `public/models/bge-m3/` | ✅ Ready |
| **q4f16 (hybrid)** | 668MB | `public/models/bge-m3-q4f16/` | ✅ Ready |
| **q4 (full)** | 1.2GB | `public/models/bge-m3-q4/` | ✅ Ready |

Each includes:
- `onnx/model_quantized.onnx` - ONNX model file
- `config.json`, `tokenizer.json`, `special_tokens_map.json`, `tokenizer_config.json`

---

## Test Environment Setup

### 1. Emulator Running

```bash
# Check emulator is running
adb -s emulator-5554 shell getprop ro.build.version.release
# Output: 15
```

### 2. App Installed

```bash
# App package: com.hiva.runtime
# APK: android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell pm list packages | grep hiva
# Output: package:com.hiva.runtime
```

### 3. Web Server Running

```bash
# Serving models and test page
# URL: http://localhost:8080/public/test-android-models.html
# Port forwarding: adb reverse tcp:8080 tcp:8080
```

### 4. Test Page Access

The test page is accessible at: `http://localhost:8080/public/test-android-models.html`

Models are served from: `http://localhost:8080/public/models/`

---

## Manual Test Procedure

### Step 1: Open Test Page

```bash
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d "http://localhost:8080/public/test-android-models.html"
```

### Step 2: Run Tests

The test page provides buttons for:
- **Test q8 (560MB)** - Baseline measurement
- **Test q4f16 (668MB)** - Hybrid quantization
- **Test q4 (1.2GB)** - Full q4 quantization
- **Run All Tests** - Sequential test of all three

### Step 3: Monitor Results

Each test reports:
1. **Cold Load Time**: Time to load model from cache (ms)
2. **Warm Inference Latency**: Average of 10 queries (ms)
   - Min/Max latency
   - vs MiniLM baseline (10ms)
   - vs q8 baseline (84ms)
3. **Memory Usage**: JS heap used/total
4. **Load Success/Failure**: Whether model loaded at all

### Step 4: Extract Results

Results are displayed on-page and logged to console. To extract:

```bash
# Monitor console logs
adb -s emulator-5554 logcat -s chromium:V,Console:V | grep -E "RESULTS|FAILED"
```

Or manually screenshot/transcribe from emulator browser.

---

## Expected Measurements

### Success Criteria

For each model variant:
- ✅ Model loads successfully (no crash)
- ✅ Produces 1024-dim embeddings
- ✅ Completes 10 test queries without error
- ✅ Reports latency numbers

### Failure Cases

Per task requirement #3:
- ❌ **q4 fails to load**: Crash/OOM during model load → Report immediately
- ❌ **Dual-model OOM**: Cannot load bge-m3 + MiniLM simultaneously on 2GB device
- ⚠️ **Slow but functional**: Loads but latency is worse than q8

---

## Test Queries (Identical to Sandbox Baseline)

```javascript
const testQueries = [
  "How do I treat HIV?",
  "Dosage for children 5-10kg",
  "What are the symptoms of tuberculosis?",
  "When should I refer a patient?",
  "Malaria prophylaxis for pregnant women",
  "Side effects of artemisinin",
  "How to diagnose pneumonia",
  "Treatment for severe malnutrition",
  "Signs of dehydration",
  "Vaccination schedule for infants"
];
```

Same queries used for Node.js sandbox q8 baseline (84ms).

---

## Known Limitations

### 1. Cannot Test XNNPACK (Step 4 requirement)

**Why**: @xenova/transformers in browser uses ONNX Runtime Web (WASM), which doesn't expose execution provider controls. XNNPACK would require:
- Native Android build with ONNX Runtime C++
- JNI bindings to expose EP selection
- Significant engineering effort

**Workaround**: Test default CPU path only, note that native XNNPACK is untested.

### 2. x86 vs ARM Performance Gap

**Impact**: All measurements will be optimistic. Real ARM devices expected to be:
- 2-4x slower for CPU-only inference
- Potentially worse memory pressure (different allocators)

**Mitigation**: Explicitly state all numbers are "x86 emulator, not representative of ARM target hardware."

### 3. Dual-Model Testing

**Challenge**: Test page loads one model at a time. To test dual-model memory pressure:
- Load MiniLM first
- Then load bge-m3 variant
- Check if OOM occurs

This requires manual sequential testing, not automated.

---

## Next Steps

1. **Run Manual Tests**: Follow procedure above, record all three variant results
2. **Document Load Failures**: If q4 or q4f16 crash, capture error details
3. **Check Memory Limits**: Attempt dual-model load to test 2GB constraint
4. **Report Findings**: Create final report with:
   - Actual numbers for successfully loaded models
   - Explicit load failures for others
   - x86 caveat prominently stated
   - Recommendation on viability for ARM target hardware

---

## Files

- **Test Page**: `public/test-android-models.html`
- **Models**: `public/models/bge-m3*`
- **APK**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **This Document**: `ANDROID_TEST_SETUP.md`

---

**Setup Status**: ✅ COMPLETE  
**Ready for**: Manual testing on emulator  
**Awaiting**: Test execution and results documentation
