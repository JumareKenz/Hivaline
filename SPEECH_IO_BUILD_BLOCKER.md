# Speech I/O Build Blocker — Critical Issue

**Date**: 2026-07-08  
**Status**: BUILD FAILED ❌

---

## Build Error

```
Manifest merger failed: uses-sdk:minSdkVersion 31 cannot be smaller than version 35 
declared in library [ai.moonshine:moonshine-voice:0.0.65]

Suggestion: use a compatible library with a minSdk of at most 31,
or increase this project's minSdk version to at least 35,
or use tools:overrideLibrary="ai.moonshine.voice" to force usage 
(may lead to runtime failures)
```

---

## Root Cause

**moonshine-voice SDK constraint**: Requires Android 14+ (API level 35)  
**HIVA Runtime constraint**: Targets Android 12+ (API level 31) for low-end device compatibility

**Conflict**: Cannot use moonshine-voice SDK without breaking low-end device support.

---

## Why minSdk 31 Cannot Be Raised

From `android/variables.gradle`:
```gradle
minSdkVersion = 31  // raised for LEAP SDK 0.6.0 compatibility; was 24
                    // flag for field-device audit
```

**History**:
- Original target: API 24 (Android 7.0, 2016)
- Raised to API 31 for LEAP SDK 0.6.0 (current LLM backend)
- Target devices: Low-end Android 12+ phones in field deployment

**Raising to API 35** would:
- Require Android 14+ (released Oct 2023)
- Exclude Android 12/13 devices (2021-2022 devices still in field use)
- Break compatibility with existing deployment hardware

---

## Resolution Options

### Option A: Drop Moonshine SDK, Use Manual ONNX Runtime Integration ✅ RECOMMENDED

**Approach**:
- Remove `ai.moonshine:moonshine-voice:0.0.65` dependency
- Manually load Moonshine `.ort` models with existing `onnxruntime-android:1.27.0`
- Implement audio preprocessing + inference in NativeSTTPlugin.kt
- No SDK wrapper, direct ONNX Runtime calls

**Pros**:
- Maintains minSdk 31 compatibility
- Same model files (encode.ort, preprocess.ort, uncached_decode.ort)
- Already have ONNX Runtime 1.27.0 in project
- Full control over inference pipeline

**Cons**:
- More implementation work (audio preprocessing, tokenization)
- No official Moonshine Kotlin API (must reverse-engineer from SDK or use Python reference)
- Risk of incorrect preprocessing leading to quality loss

**Feasibility**: HIGH
- ONNX Runtime 1.27.0 supports Android API 24+
- Moonshine models are standard ONNX format
- Audio preprocessing is documented (16kHz mono, normalization)

---

### Option B: Use tools:overrideLibrary ⚠️ RISKY

**Approach**:
```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-sdk tools:overrideLibrary="ai.moonshine.voice" />
```

**Pros**:
- Quick fix (no code rewrite)
- Keeps moonshine-voice SDK integration as-is

**Cons**:
- **May crash on Android 12/13** if SDK uses API 35-specific features
- Runtime failures unpredictable (could fail during inference, not at startup)
- Violates library's documented requirements
- No fallback if crash occurs mid-transcription

**Feasibility**: LOW (unacceptable risk for production)

---

### Option C: Increase minSdk to 35 ❌ BREAKS DEPLOYMENT

**Approach**:
```gradle
minSdkVersion = 35  // Android 14+
```

**Pros**:
- Clean build
- No SDK workarounds

**Cons**:
- **Excludes all Android 12/13 devices** (significant field deployment base)
- Contradicts project's low-end device target
- LEAP SDK only requires API 31, not 35
- No clear benefit justifying compatibility break

**Feasibility**: REJECTED (violates deployment constraints)

---

### Option D: Remove Native STT, Use Web Speech Recognition Only ❌ REGRESSION

**Approach**:
- Remove NativeSTTPlugin.kt
- Keep only Web Speech Recognition API fallback
- Native TTS (PocketTTS) still works

**Pros**:
- No build issues
- Simpler integration

**Cons**:
- **Requires network connection** for speech recognition (not offline)
- Defeats purpose of native speech I/O integration
- Asymmetric UX (offline TTS, online STT)

**Feasibility**: FALLBACK ONLY (if Option A fails)

---

## Recommended Path: Option A (Manual ONNX Runtime Integration)

### Implementation Plan

1. **Remove moonshine-voice dependency**
```gradle
// REMOVE:
// implementation "ai.moonshine:moonshine-voice:0.0.65"
```

2. **Keep existing dependencies**
```gradle
implementation "com.microsoft.onnxruntime:onnxruntime-android:1.27.0"
implementation "com.microsoft.onnxruntime:onnxruntime-extensions-android:0.13.0"
```

3. **Rewrite NativeSTTPlugin.kt** to:
   - Load `.ort` models directly with OrtSession
   - Implement audio preprocessing:
     - Convert PCM16 to Float32
     - Resample to 16kHz if needed
     - Normalize audio [-1.0, 1.0]
   - Run inference:
     - Pass audio to encode.ort → embeddings
     - Pass embeddings to preprocess.ort → features
     - Pass features to uncached_decode.ort → token IDs
   - Decode tokens to text (need vocabulary file)

4. **Download additional resources**
   - Moonshine tokenizer vocabulary (if not included in .ort models)
   - Reference: https://github.com/usefulsensors/moonshine

5. **Test on Android 12 device** (API 31)
   - Verify no API 35 dependencies
   - Validate transcription accuracy vs SDK

### Risks
- **Preprocessing complexity**: Audio normalization must match Moonshine's training expectations
- **Tokenizer integration**: If vocabulary not embedded in .ort, need external tokenizer
- **Quality regression**: Manual pipeline may differ from SDK's optimized path

### Mitigation
- Reference Moonshine Python implementation for preprocessing logic
- Compare outputs against SDK version (if available on API 35+ device)
- Fallback to Web Speech Recognition if quality unacceptable

---

## Decision Required

**User must decide**:

1. **Proceed with Option A** (manual ONNX Runtime integration)?
   - Higher implementation effort
   - Maintains minSdk 31 compatibility
   - Full offline STT capability

2. **Fallback to Option D** (remove native STT, keep Web Speech Recognition)?
   - Lower implementation effort
   - Online STT only (network required)
   - Asymmetric with offline TTS

3. **Defer native STT** (ship with native TTS only, add STT later)?
   - Partial offline capability (TTS works, STT deferred)
   - Time to investigate manual ONNX Runtime approach

**Current status**: Build blocked, awaiting direction.

---

**TTS Status**: ✅ NativeTTSPlugin.kt ready (PocketTTS via sherpa-onnx, no API constraints)  
**STT Status**: ❌ BLOCKED by moonshine-voice minSdk 35 requirement  
**Next Step**: User decision on Option A vs D vs defer
