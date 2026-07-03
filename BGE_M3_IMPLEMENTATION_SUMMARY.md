# bge-m3 Migration Implementation Summary

## Overview

Implemented dual-path schema version support for v2.2 (MiniLM 384-dim) and v2.3 (bge-m3 1024-dim dense-only) bundles. This enables the runtime to handle both old and new bundle formats during the transition period.

## What Was Implemented

### 1. Schema Version Detection ✅

**Files Modified:**
- `src/types/hiv.ts` - Added `schema_version` field to `HIVManifest`
- `src/services/hivLoader.ts` - Added `parseSchemaVersion()` function and `SchemaVersion` type

**Behavior:**
- Reads `manifest.schema_version` (or falls back to `manifest.version`)
- Normalizes version strings (strips 'v' prefix, extracts major.minor)
- Validates against known versions (2.2, 2.3)
- **Fails loudly** with clear error on unrecognized versions
- Error includes module ID for debugging

### 2. Dual Embedding Model Support ✅

**Files Modified:**
- `src/services/embeddingModel.ts` - Complete refactor for dual-model support
- `src/engine/hybridSearch.ts` - Added schema-aware routing
- `src/services/conversationEngine.ts` - Updated to configure both models

**Models:**
- **v2.2**: MiniLM (384-dim, mean pooling) - unchanged from existing
- **v2.3**: bge-m3 (1024-dim dense-only, CLS pooling) - new integration

**Key Features:**
- Both models can be loaded simultaneously (for mixed v2.2/v2.3 bundle sets)
- Dimension validation prevents mismatched query/bundle embedding
- Separate embedding functions per schema version (`setEmbedQueryFnV22`, `setEmbedQueryFnV23`)
- Automatic routing based on `HIVAssets.schemaVersion`

**Model Configuration:**
```typescript
// v2.2 (MiniLM)
pipeline('feature-extraction', 'embed', {
  quantized: true,
  pooling: 'mean',
  normalize: true
});

// v2.3 (bge-m3)
pipeline('feature-extraction', 'bge-m3', {
  quantized: true,
  pooling: 'cls',   // Note: CLS not mean
  normalize: true
});
```

### 3. Missing lexical.json Handling ✅

**Files Modified:**
- `src/services/hivLoader.ts` - Updated `parseLexicalIndex()` with schema-aware warnings

**Behavior:**
- Detects missing `lexical.json` in v2.3 bundles
- Logs clear warning: `"lexical.json missing in v2.3 bundle — falling back to dense-only search"`
- **Does NOT fail** module load - treats as expected transitional state
- Module loads successfully with degraded (dense-only) search capability

### 4. Dense-Only Search Mode ✅

**Files Modified:**
- `src/engine/hybridSearch.ts` - Added dense-only detection and routing

**Behavior:**
- Detects: `schemaVersion === '2.3' && bm25.length === 0`
- Logs mode activation for diagnostics
- Skips RRF fusion (returns vector results directly)
- Applies **stricter confidence gating** (0.4 cosine floor vs normal 0.3)

**Rationale for Stricter Floor:**
- With no lexical signal to validate, require stronger dense signal
- Prevents false positives from weak semantic matches
- Conservative default until bge-m3 distribution is measured

### 5. Hybrid Search Update ✅

**Files Modified:**
- `src/engine/hybridSearch.ts` - Updated vector search routing and confidence logic

**Changes:**
- Schema version flows through `HIVAssets.schemaVersion`
- Vector search selects correct embedding function based on schema
- Dimension mismatch detection with graceful degradation
- Dense-only mode bypasses RRF fusion
- Confidence gating aware of search mode (hybrid vs dense-only)

### 6. Confidence Calibration Documentation ✅

**Files Created:**
- `CONFIDENCE_CALIBRATION.md` - Measurement plan and threshold documentation

**Current Thresholds (Pending Validation):**
- Normal vector floor: 0.3 cosine
- Dense-only floor: 0.4 cosine (stricter)
- BM25 floor: 1.5 (unchanged)
- Vector margin: 10% separation requirement

**Status:**
- Thresholds documented as "pending bge-m3 validation"
- Inline TODOs added in code
- Measurement plan defined
- **Action required**: Collect bge-m3 score distributions from real fixtures

### 7. Comprehensive Tests ✅

**Files Created:**
- `src/__tests__/services/schemaVersionRouting.test.ts`

**Test Coverage:**
- Schema version parsing (valid, invalid, missing)
- Embedding model routing (v2.2 → MiniLM, v2.3 → bge-m3)
- Dimension mismatch detection
- Lexical.json presence/absence handling
- Dense-only mode vs hybrid mode behavior
- End-to-end integration tests for all three paths:
  - v2.2 with lexical.json
  - v2.3 with lexical.json
  - v2.3 without lexical.json

## What Was NOT Implemented (Explicitly Out of Scope)

### Sparse Vector Retrieval ❌
- **Why**: Xenova/bge-m3 ONNX conversion only exposes dense output
- **Status**: Confirmed via HuggingFace maintainer (discussion #4)
- **Impact**: v2.3 bundles use dense + BM25 (not dense + sparse)
- **Future**: Tracked for schema v2.4 when browser-compatible sparse solution exists

### Compiler-Side Changes ❌
- **Why**: Explicitly out of scope for this task
- **What's needed**: Compiler must generate `lexical.json` for v2.3 bundles (revert prior change)
- **Current state**: Compiler may have stopped producing `lexical.json` for v2.3
- **Impact**: Real v2.3 bundles in field will trigger dense-only mode
- **Owner**: Separate compiler-side task

### Model File Deployment ❌
- **Why**: Awaiting confirmation of model availability
- **What's needed**: Download Xenova/bge-m3 quantized ONNX to `public/models/bge-m3/`
- **Current**: Only investigation document created
- **Next step**: Download and measure actual model size

## Files Modified

### Core Implementation
1. `src/types/hiv.ts` - Added schema_version field
2. `src/services/hivLoader.ts` - Schema version parsing, lexical.json warnings
3. `src/services/embeddingModel.ts` - Dual-model support
4. `src/engine/hybridSearch.ts` - Schema routing, dense-only mode
5. `src/services/conversationEngine.ts` - Dual embedding function setup

### Tests
6. `src/__tests__/services/schemaVersionRouting.test.ts` - Comprehensive schema routing tests

### Documentation
7. `BGE_M3_INVESTIGATION.md` - Model research and integration notes
8. `CONFIDENCE_CALIBRATION.md` - Threshold measurement plan
9. `BGE_M3_IMPLEMENTATION_SUMMARY.md` - This document

## Known Limitations

### 1. Model Files Not Downloaded
- **Status**: bge-m3 ONNX files not yet in `public/models/`
- **Impact**: v2.3 path will fail at model load time
- **Action**: Download Xenova/bge-m3 quantized ONNX (or onnx-community/bge-m3)
- **Estimated size**: 280-550MB depending on quantization (q4 vs q8)

### 2. No Real v2.3 Bundle for Testing
- **Status**: No verified v2.3 bundle available for end-to-end test
- **Impact**: Cannot measure actual bge-m3 score distributions yet
- **Action**: Wait for compiler team to provide sample v2.3 bundle

### 3. Thresholds Not Validated
- **Status**: Confidence thresholds are MiniLM-calibrated estimates
- **Impact**: May be too strict or too lenient for bge-m3
- **Action**: Run distribution measurement once v2.3 bundle available

### 4. Combined Memory Footprint Not Measured
- **Status**: Both models resident case not tested on device
- **Impact**: Unknown memory pressure when user has both v2.2 and v2.3 bundles
- **Action**: Measure on real device once bge-m3 model deployed

## Next Steps

### Immediate (Blocking v2.3 Deployment)
1. **Download bge-m3 model files** to `public/models/bge-m3/`
   - Use Xenova/bge-m3 (recommended) or onnx-community/bge-m3
   - Confirm quantized (q8 or q4) to control size
   - Verify model loads via transformers.js
   - Document actual file size

2. **Test with real v2.3 bundle**
   - Obtain verified v2.3 bundle from compiler team
   - Run end-to-end recall test
   - Measure actual inference latency
   - Validate dimension matching (1024-dim)

3. **Measure bge-m3 score distributions**
   - Run test-embedding-recall.mjs against v2.3 bundle
   - Compare distributions to MiniLM baseline
   - Validate or adjust confidence thresholds
   - Document findings in CONFIDENCE_CALIBRATION.md

### Pre-Production
4. **Compiler-side lexical.json revert**
   - Verify compiler produces lexical.json for v2.3 bundles
   - Test with hybrid search (dense + BM25)
   - Confirm no regression in recall metrics

5. **On-device performance validation**
   - Measure model load time (first launch vs cached)
   - Measure inference latency (query embedding)
   - Measure memory footprint (both models resident)
   - Test on low-end device (minimum spec)

6. **Update existing tests**
   - Add v2.3 fixtures to existing retrieval tests
   - Validate backward compatibility (v2.2 unchanged)
   - Run full regression suite

## Migration Path for Existing Deployments

### For Users with Cached v2.2 Bundles
- **No change required** - v2.2 path unchanged
- MiniLM model already cached, continues to work
- No re-download needed

### For New v2.3 Bundle Downloads
- **First launch**: bge-m3 model downloads (~280-550MB one-time)
- **Subsequent**: loads from cache, fully offline-capable
- **If lexical.json present**: hybrid search (dense + BM25)
- **If lexical.json absent**: dense-only mode (stricter gating)

### For Mixed v2.2/v2.3 Bundle Sets
- **Both models loaded** when user has both bundle types
- Memory overhead: ~400-650MB combined (measure actual)
- Models persist in cache, shared across bundle loads
- Schema version auto-detected per bundle

## Risk Assessment

### High Risk ⚠️
- **Model size**: 280-550MB download on first v2.3 bundle use
  - Mitigation: Quantization (q4 < q8), user warning before download
- **Memory footprint**: Both models resident for mixed bundle sets
  - Mitigation: Measure actual, document minimum device requirements

### Medium Risk ⚠️
- **Threshold miscalibration**: MiniLM thresholds may not transfer to bge-m3
  - Mitigation: Conservative defaults, measurement plan in place
- **Dense-only mode recall**: Lower than hybrid without lexical signal
  - Mitigation: Stricter gating (0.4 floor), clear logging, compiler revert prioritized

### Low Risk ✅
- **Dimension mismatch**: Runtime detects and degrades gracefully
- **Schema version errors**: Fail loudly with clear error messages
- **Backward compatibility**: v2.2 path completely unchanged

## Success Criteria

- [ ] bge-m3 model files deployed and loadable
- [ ] v2.3 bundle with lexical.json achieves comparable recall to v2.2
- [ ] v2.3 bundle without lexical.json degrades gracefully (no crashes)
- [ ] Schema version detection works for both v2.2 and v2.3
- [ ] Dimension mismatch detected and logged (not crashed)
- [ ] Combined memory footprint acceptable on minimum spec device
- [ ] Inference latency comparable to MiniLM (or justified if slower)
- [ ] All existing v2.2 tests pass unchanged

## Appendix: Model Integration Notes

### Xenova/bge-m3 Integration
```typescript
import { pipeline, env } from '@xenova/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';

const bgeM3 = await pipeline('feature-extraction', 'bge-m3', {
  quantized: true,  // q8 recommended
  progress_callback: (progress) => console.log(progress)
});

const queryEmbedding = await bgeM3(queryText, {
  pooling: 'cls',      // IMPORTANT: CLS not mean
  normalize: true
});

// queryEmbedding.data is Float32Array of length 1024
```

### Key Differences from MiniLM
| Aspect | MiniLM (v2.2) | bge-m3 (v2.3) |
|--------|---------------|---------------|
| Dimensions | 384 | 1024 |
| Pooling | mean | cls |
| Model ID | 'embed' | 'bge-m3' |
| Sparse output | N/A | Not available in ONNX |
| Query prefix | None | None (verified) |

### File Structure
```
public/models/
├── embed/                    # MiniLM (v2.2)
│   ├── config.json
│   ├── tokenizer.json
│   ├── onnx/
│   │   └── model_quantized.onnx (113MB)
│   └── ...
└── bge-m3/                   # bge-m3 (v2.3) - TO BE ADDED
    ├── config.json
    ├── tokenizer.json
    ├── onnx/
    │   └── model_quantized.onnx (~280-550MB)
    └── ...
```
