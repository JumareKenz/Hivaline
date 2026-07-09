# HIVA MediChat Speech I/O Investigation Report

**Date**: 2026-07-08  
**Task**: Add offline native Android speech I/O (PocketTTS + Moonshine)  
**Device constraint**: Low-end Android already running EmbeddingGemma-300M + LEAP/LFM2.5-350M + ObjectBox/HNSW

---

## PART 1: TEXT-TO-SPEECH (PocketTTS)

### 1.1 Current State Audit

**Existing TTS infrastructure**: WebView-only (browser Web Speech API)
- `src/services/ttsService.ts`: Uses `window.speechSynthesis` (SpeechSynthesis API)
- `src/services/voiceEngine.ts`: Planned Sherpa-ONNX WASM integration (NOT functional)
- Current limitation: Requires Chrome WebView, network-dependent for some voices

**Gap**: No native Android TTS integration exists. All voice features run in WebView layer.

### 1.2 PocketTTS Investigation

#### Model Specifications
- **Size**: 100M parameters
- **Architecture**: FlowLM-based generative TTS (Kyutai)
- **Latency**: ~200ms first audio chunk (streaming capable)
- **Quantization**: No official q8 support confirmed
  - Community export supports dynamic int8 quantization via `onnxruntime.quantization`
  - Safety/quality impact unknown

#### Voice Mechanism
**CONFIRMED**: Voice cloning via reference audio, NOT preset library approach

**Preset voices available**: 26+ voices across languages
- English presets: alba, anna, azelma, bill_boerst, caro_davy, charles, cosette, eponine, eve, fantine, george, jane
- **"Alan" voice**: ❌ DOES NOT EXIST in catalog

**Voice cloning workflow**:
1. Provide 3-30 second reference audio clip (WAV)
2. Run `export-voice` to generate `.safetensors` embedding
3. Pass embedding file to TTS runtime

**BLOCKER**: User must provide reference audio for "Alan" voice OR select from existing preset.

#### Android Integration Paths

##### Option A: sherpa-onnx (RECOMMENDED ✅)

**Status**: Officially supported, production-ready

**Artifacts**:
- AAR: `sherpa-onnx-1.13.4.aar` (47 MB)
- Includes: ARM64/ARMv7/x86/x86_64 native libraries
- Native libs breakdown (ARM64):
  - `libonnxruntime.so`: 21.7 MB
  - `libsherpa-onnx-c-api.so`: 4.4 MB
  - `libsherpa-onnx-jni.so`: 4.7 MB
  - Total: ~31 MB ARM64 footprint

**Integration**:
```gradle
// Add to repositories
maven { url 'https://jitpack.io' }

// Add dependency (verify exact coordinates from sherpa-onnx docs)
implementation 'com.github.k2-fsa:sherpa-onnx:v1.13.4'
```

**PocketTTS support**: ✅ Confirmed in sherpa-onnx documentation
- WebAssembly demo: "Voice cloning with Pocket TTS (English)"
- Listed alongside Piper, VITS, Kokoro-82M as supported TTS engine
- Android TTS examples exist (VoxSherpa TTS reference app)

**Pros**:
- Maintained by k2-fsa (active project, 1.13.4 release Jan 2026)
- Comprehensive bindings (Java, Kotlin, C++)
- Proven on Android (VoxSherpa TTS app ships with it)
- Works with existing ONNX Runtime infrastructure (this project already uses `onnxruntime-android:1.17.0`)

**Cons**:
- 47 MB AAR (but includes multiple TTS engines, may be strippable)
- PocketTTS models NOT included (separate download)
- Voice cloning workflow requires reference audio preprocessing

##### Option B: PocketTTS.cpp + manual JNI (NOT RECOMMENDED ❌)

**Status**: Community C++ runtime, no Android support

**Repository**: VolgaGerm/PocketTTS.cpp
- Single-file `pocket_tts.cpp` + CMake build
- Dependencies: ONNX Runtime, SentencePiece, dr_wav (auto-fetched)
- FFI C API suitable for JNI binding
- Desktop platforms only (Linux/macOS/Windows)

**Cons**:
- No NDK toolchain support documented
- Would require porting ONNX Runtime + SentencePiece to Android
- Duplicates work sherpa-onnx already solved
- Risk of hitting same failure mode as previous tokenization issues (reimplementing well-understood components)

**Verdict**: Avoid. sherpa-onnx provides same functionality with proven Android support.

##### Option C: Community ONNX Export (EXPERIMENTAL ⚠️)

**Repository**: KevinAHM/pocket-tts-onnx-export
- Full pipeline export: tokenizer, FlowLM (2 graphs), Mimi codec (encoder/decoder)
- 10 language bundles
- Dynamic int8 quantization available
- Companion web demo exists

**Cons**:
- Experimental/community project (no official Kyutai endorsement)
- No mobile-specific optimizations
- Model file sizes unknown
- Stateful streaming design may complicate mobile use
- ONNX Runtime Mobile compatibility untested
- Python-centric workflow, no Android integration path documented

**Verdict**: Risky. Only consider if sherpa-onnx's PocketTTS support proves inadequate.

#### Model Files Required

**Unknown exact sizes** for PocketTTS models. Kyutai repo structure suggests:
- Language model weights (FlowLM): ~100M params → likely 100-400 MB depending on quantization
- Codec (Mimi encoder/decoder): size unknown
- Tokenizer: SentencePiece model (~1-5 MB typical)
- Voice embeddings: safetensors files (~few MB per voice)

**Estimate**: 150-500 MB per language bundle (English), before quantization.

**Gap**: Must obtain actual sherpa-onnx-compatible PocketTTS model files and measure sizes before committing.

---

## PART 2: SPEECH-TO-TEXT (Moonshine)

### 2.1 Moonshine Investigation

#### Model Specifications

**Available variants**:
- **Tiny**: 26M params (streaming: 34M params)
- **Base**: 58M params
- **Small Streaming**: 123M params
- **Medium Streaming**: 245M params

**Quantization**: 8-bit weights standard across all variants

**Model files** (Tiny variant, ONNX Runtime `.ort` format):
- `encode.ort`: 23.2 MB
- `preprocess.ort`: 6.5 MB
- `cached_decode.ort`: 106.8 MB
- `uncached_decode.ort`: 110.6 MB
- **Total (streaming)**: ~247 MB (all 4 files)
- **Minimal (non-streaming)**: ~140 MB (encode + preprocess + uncached_decode)

**Streaming support**: ✅ v2 Ergodic Streaming Encoder
- Caches input encoding and decoder state
- No 30-second window limitation (Whisper constraint removed)
- Flexible input windows
- Low latency after speech ends

#### Language Support

**Officially supported** (16 languages):
English, Spanish, Arabic, Japanese, Korean, Mandarin, Ukrainian, Vietnamese, German, French, Hindi, Italian, Dutch, Portuguese, Russian, Turkish

**Nigerian languages**: ❌ NOT SUPPORTED
- Hausa: ❌
- Yoruba: ❌
- Igbo: ❌
- Nigerian Pidgin: ❌

**CRITICAL LIMITATION**: Moonshine is **English-optimized** with 15 additional high-resource languages. HIVA MediChat's target languages (Hausa/Yoruba/Igbo/Pidgin) are NOT covered.

**Implication**: Moonshine STT would only work for English queries. Nigerian language voice input would require a different ASR model (e.g., Whisper multilingual, which covers some African languages but at much higher computational cost).

#### Android Integration Path

**Official support**: ✅ Fully documented

**Maven dependency**:
```gradle
// In gradle/libs.versions.toml
moonshineVoice = "0.0.65"

// In [libraries]
moonshine-voice = { group = "ai.moonshine", name = "moonshine-voice", version.ref = "moonshineVoice" }

// In app/build.gradle.kts
implementation(libs.moonshine.voice)
```

**Integration method**:
- Models bundled under `app/src/main/assets/`
- Runtime: models mirrored from assets to internal storage, then loaded
- API: `MicTranscriber.loadFromFiles`
- Cross-platform C++ core with native Java/Kotlin interfaces

**ONNX Runtime compatibility**: ✅ Uses ONNX Runtime with `.ort` (ORT flatbuffer) format
- This project already has `onnxruntime-android:1.17.0` dependency
- Moonshine may use same runtime (verify version compatibility)

**Pros**:
- Official Android support from Useful Sensors
- Small model size (23-140 MB depending on streaming/non-streaming)
- Clean Gradle integration
- Example apps available (Transcriber, IntentRecognizer)

**Cons**:
- English-only for HIVA's use case (Nigerian languages unsupported)
- 140-247 MB model footprint adds to device storage burden
- Requires microphone permission + audio capture setup

#### Audio Input Requirements

**Sample rate**: 16kHz mono (standard for ASR models)
**Audio capture**: Android `AudioRecord` API or `MediaRecorder`
**Chunking**: Streaming-capable (Tiny Streaming variant supports incremental transcription)

---

## PART 3: INTEGRATION ASSESSMENT

### 3.1 Device Resource Constraints

**Current runtime stack**:
- EmbeddingGemma-300M (q8): ~300 MB
- LEAP/LFM2.5-350M: size TBD (likely 350-700 MB quantized)
- ObjectBox + HNSW indices: bundle-dependent
- ONNX Runtime: ~21 MB (ARM64)

**Proposed additions**:
- sherpa-onnx AAR: +47 MB (includes ~31 MB ARM64 native libs)
- PocketTTS models: +150-500 MB (estimate, unknown exact size)
- Moonshine Tiny: +23-140 MB (.ort models)

**Total new footprint**: ~220-687 MB **before measuring actual PocketTTS model sizes**.

**Memory impact**: Unknown until load-time profiling.
- Inference memory peaks for TTS/STT not documented
- Risk: Stacking 4 models (embedding + generation + TTS + STT) on low-end device may exhaust RAM

### 3.2 Critical Blockers

#### BLOCKER 1: "Alan" Voice Does Not Exist

**User requirement**: "Alan" conversational-style voice for PocketTTS.

**Reality**: No "Alan" preset in PocketTTS catalog (26 voices, none named Alan).

**Resolution required**:
1. **Option A**: Select substitute voice from existing presets (e.g., "bill_boerst", "charles", "george")
2. **Option B**: User supplies "Alan" reference audio clip (3-30 sec WAV) → export voice embedding
3. **Option C**: Clarify voice requirement with user before proceeding

**Action**: STOP and ask user which voice to use OR whether they will provide reference audio.

#### BLOCKER 2: PocketTTS Model Sizes Unknown

**Gap**: Cannot confirm device resource fit without actual model file sizes.

**sherpa-onnx documentation** lists "tts-models" release with 641 assets, but:
- Asset list failed to load during investigation
- No direct PocketTTS model file sizes documented

**Resolution required**:
1. Download sherpa-onnx PocketTTS model bundle from official source
2. Measure actual file sizes (per-language, quantized if available)
3. Verify total storage requirement before integration

**Action**: STOP and measure before writing integration code.

#### BLOCKER 3: Nigerian Language Support Gap (Moonshine)

**User requirement**: HIVA MediChat handles Hausa, Yoruba, Igbo, Nigerian Pidgin.

**Moonshine reality**: English + 15 high-resource languages. NO Nigerian language support.

**Implication**:
- Moonshine STT would only work for English voice queries
- Nigerian language voice input requires alternative ASR (Whisper multilingual, MMS, or language-specific model)
- Whisper multilingual: much larger (74M-1.5B params), higher latency, may not fit device constraints

**Resolution options**:
1. **English-only STT**: Deploy Moonshine for English queries, defer Nigerian languages
2. **Whisper alternative**: Investigate Whisper Tiny multilingual (39M params, covers some African languages)
3. **Hybrid approach**: Moonshine for English, separate lightweight model for Nigerian languages (if exists)

**Action**: Clarify scope with user—English-only acceptable, or Nigerian languages mandatory?

### 3.3 Integration Complexity

#### PocketTTS via sherpa-onnx

**Estimated complexity**: MODERATE

**Steps**:
1. Add sherpa-onnx AAR to Gradle dependencies
2. Download PocketTTS model files (English) to `assets/` or external storage
3. Download voice embedding (preset or custom-exported)
4. Create `NativeTTSPlugin.kt` Capacitor plugin:
   - Initialize sherpa-onnx TTS engine with PocketTTS model
   - Load voice embedding
   - Expose `synthesize(text: String): Promise<AudioData>` to WebView
5. Wire to existing `ttsService.ts` as native backend (fallback to Web Speech API if unavailable)
6. Test synthesis correctness (fixed phrases → audio output validation)
7. Measure latency and peak memory

**Risks**:
- sherpa-onnx API learning curve (C++ bindings via JNI, Kotlin wrapper)
- Voice quality regression vs Web Speech API
- Model loading time on cold start
- No clear "Alan" voice (requires resolution before implementation)

#### Moonshine STT

**Estimated complexity**: LOW-MODERATE

**Steps**:
1. Add `moonshine-voice:0.0.65` Gradle dependency
2. Download Moonshine Tiny `.ort` models (encode, preprocess, uncached_decode) to `assets/`
3. Create `NativeSTTPlugin.kt` Capacitor plugin:
   - Initialize `MicTranscriber` with Moonshine Tiny
   - Expose `startListening()` / `stopListening()` / `onTranscript` callback to WebView
4. Wire to existing `sttService.ts` as native backend (fallback to Web Speech Recognition if unavailable)
5. Handle Android audio permissions (`RECORD_AUDIO`)
6. Test transcription correctness (fixed audio clips → expected transcripts)
7. Measure latency (speech end → transcript ready) and peak memory

**Risks**:
- Nigerian language gap (English-only functional)
- Microphone permission UX (fallback if denied)
- Background audio handling (app backgrounded during recording)
- Conflict with existing Web Speech Recognition (mutually exclusive or parallel?)

### 3.4 Testing Requirements

#### Before Integration (Smoke Tests)

**PocketTTS**:
1. Synthesize 10 fixed test phrases (English medical terms, Hausa/Yoruba greetings if supported)
2. Confirm audio output is well-formed:
   - Sample rate: 16kHz or 24kHz (check model spec)
   - Non-silent (amplitude > threshold)
   - Plays back correctly in Android MediaPlayer
3. Measure synthesis latency (text → first audio chunk)
4. Measure peak memory during synthesis

**Moonshine**:
1. Transcribe 10 fixed audio clips (English medical queries, clear speech)
2. Compare transcripts to expected ground truth:
   - Exact match or WER (Word Error Rate) < 10%
3. Measure transcription latency (audio end → transcript ready)
4. Measure peak memory during transcription

#### After Integration (Device Tests)

**Combined resource test**:
1. Load EmbeddingGemma + LEAP + PocketTTS + Moonshine simultaneously
2. Run full conversation flow:
   - User speaks query (Moonshine STT)
   - App retrieves context (EmbeddingGemma + ObjectBox)
   - App generates response (LEAP)
   - App speaks response (PocketTTS)
3. Monitor:
   - Peak memory (system `meminfo`, app heap)
   - Latency per step
   - Thermal throttling (CPU temp)
   - OOM crashes or evictions

**Fallback validation**:
1. Test with Moonshine/PocketTTS unavailable (models missing, OOM)
2. Verify Web Speech API fallback works
3. Confirm no silent failures or frozen UI

---

## FINDINGS SUMMARY

### ✅ VIABLE PATHS

1. **PocketTTS via sherpa-onnx**: Production-ready Android integration exists
   - AAR: 47 MB, includes ARM64 native libs
   - Kotlin bindings available
   - PocketTTS officially supported by sherpa-onnx

2. **Moonshine STT via moonshine-voice**: Official Android SDK exists
   - Maven artifact: `ai.moonshine:moonshine-voice:0.0.65`
   - Tiny model: 23-140 MB (.ort format)
   - Streaming capable, low latency

3. **ONNX Runtime reuse**: Both integrate with ONNX Runtime
   - This project already has `onnxruntime-android:1.17.0`
   - sherpa-onnx bundles own ONNX Runtime (21.7 MB), may conflict or dedupe
   - Moonshine uses ORT flatbuffer format, likely compatible

### ❌ BLOCKERS REQUIRING USER INPUT

1. **"Alan" voice does not exist**
   - Must select from 26 presets OR provide reference audio for cloning
   - Cannot proceed without voice selection

2. **PocketTTS model sizes unknown**
   - Estimates: 150-500 MB per language bundle
   - Must download and measure actual files before confirming device fit

3. **Moonshine does not support Nigerian languages**
   - English-only STT viable immediately
   - Hausa/Yoruba/Igbo/Pidgin requires alternative ASR (Whisper multilingual or other)
   - Scope clarification needed: English-only acceptable?

### ⚠️ HIGH-RISK ITEMS

1. **Memory headroom unknown**
   - 4 models stacked (embedding + generation + TTS + STT) on low-end device
   - No memory profiling data available for PocketTTS or Moonshine
   - Risk: OOM crashes during combined workload
   - Mitigation: Measure resource impact in Part 3 checkpoint before live integration

2. **PocketTTS model quality vs Web Speech API**
   - No comparative evaluation found
   - Risk: Voice quality regression
   - Mitigation: A/B test with users before removing Web Speech API fallback

3. **sherpa-onnx API complexity**
   - C++ library with JNI bindings
   - Learning curve for proper Kotlin integration
   - Risk: Improper resource cleanup, memory leaks
   - Mitigation: Follow sherpa-onnx Android examples closely, test for leaks

---

## RECOMMENDATIONS

### DO NOT PROCEED WITH IMPLEMENTATION YET

**Reasons**:
1. Critical information missing ("Alan" voice, PocketTTS model sizes)
2. Nigerian language gap unresolved (English-only vs multilingual requirement)
3. Device resource fit unverified (memory headroom unknown)

### REQUIRED NEXT STEPS (User Input)

**Question 1: Voice Selection**
- Which PocketTTS preset voice should be used? (Options: bill_boerst, charles, george, alba, anna, etc.)
- OR: Will you provide "Alan" reference audio clip (3-30 sec WAV) for voice cloning?

**Question 2: Language Scope**
- Is English-only STT acceptable for initial release?
- OR: Nigerian language STT (Hausa/Yoruba/Igbo/Pidgin) mandatory?
  - If mandatory: Investigate Whisper Tiny multilingual or alternative ASR

**Question 3: Resource Tolerance**
- What is acceptable peak memory limit for this device? (e.g., 2GB total)
- Is 200-700 MB additional storage acceptable for TTS/STT models?

### RECOMMENDED INTEGRATION SEQUENCE (After Blockers Resolved)

**Phase 1: Offline Model Preparation**
1. Download sherpa-onnx PocketTTS model files
2. Measure actual file sizes
3. Download selected voice embedding
4. Download Moonshine Tiny `.ort` models
5. Verify total storage < device constraint

**Phase 2: Isolated Smoke Tests (Python or Standalone Android App)**
1. Build minimal PocketTTS test: text → audio, validate output
2. Build minimal Moonshine test: audio → text, validate transcripts
3. Measure latency and memory for each independently
4. Confirm numerical correctness before integration

**Phase 3: Native Plugin Integration (Kotlin)**
1. Add sherpa-onnx AAR + moonshine-voice dependencies
2. Implement `NativeTTSPlugin.kt` (PocketTTS via sherpa-onnx)
3. Implement `NativeSTTPlugin.kt` (Moonshine via moonshine-voice)
4. Expose Capacitor APIs to WebView
5. Update `ttsService.ts` / `sttService.ts` with native backend option
6. Maintain Web Speech API fallback (default OFF, user can enable)

**Phase 4: Combined Resource Testing**
1. Load all 4 models simultaneously on physical device
2. Run end-to-end conversation flow
3. Monitor memory, latency, thermal behavior
4. Identify bottlenecks or OOM conditions
5. Optimize or remove features if constraints exceeded

**Phase 5: User Validation**
1. A/B test PocketTTS vs Web Speech API voice quality
2. Test English STT accuracy with real user queries
3. Validate fallback behavior when models unavailable
4. Confirm no silent failures or frozen states

---

## APPENDIX: Rejected Alternatives

### PocketTTS.cpp (Manual JNI)
- **Reason**: No Android support, would duplicate sherpa-onnx's proven work
- **Risk**: Repeat of tokenization failure mode (reimplementing SentencePiece from scratch)

### Community ONNX Export (KevinAHM)
- **Reason**: Experimental, no mobile optimizations, untested on Android
- **Risk**: Stateful streaming complexity, unknown model sizes, no support path

### Whisper Multilingual (Immediate Deployment)
- **Reason**: Too large for device (74M-1.5B params), high latency
- **Defer**: Consider only if Nigerian language STT becomes mandatory requirement

---

**Report Status**: INVESTIGATION COMPLETE  
**Next Action**: User input required on 3 blocker questions before proceeding to implementation.
