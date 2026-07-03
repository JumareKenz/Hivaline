# bge-m3 Deployment Checklist

## Implementation Complete ✅

All code changes for dual-path schema version support (v2.2/v2.3) have been implemented and tested.

## Pre-Deployment Requirements

### 🔴 BLOCKING: Model Files Not Deployed

**Status**: bge-m3 ONNX model files are NOT yet in the repository.

**Action Required**:
```bash
# Download Xenova/bge-m3 quantized ONNX model
cd public/models/
mkdir -p bge-m3/onnx
# Download from HuggingFace: https://huggingface.co/Xenova/bge-m3
# Required files:
#   - config.json
#   - tokenizer.json
#   - tokenizer_config.json
#   - special_tokens_map.json
#   - onnx/model_quantized.onnx (q8 recommended)
```

**Validation**:
```bash
# Verify file structure matches:
public/models/
├── embed/                    # MiniLM (v2.2) - existing
│   ├── config.json
│   ├── tokenizer.json
│   └── onnx/
│       └── model_quantized.onnx (113MB)
└── bge-m3/                   # bge-m3 (v2.3) - TO ADD
    ├── config.json
    ├── tokenizer.json
    └── onnx/
        └── model_quantized.onnx (~280-550MB depending on quantization)
```

**Responsible**: DevOps / Model deployment team

---

### 🟡 IMPORTANT: Compiler-Side Coordination

**Status**: Runtime ready, but compiler must also be updated.

**Compiler Requirements**:
1. ✅ Generate `schema_version` field in manifest.json for v2.3 bundles
2. ⚠️  **Generate `lexical.json` for v2.3 bundles** (compiler may have stopped producing this)
3. ✅ Generate dense embeddings at 1024-dim (bge-m3) for v2.3
4. ❌ Do NOT require `sparse.json` consumption (runtime cannot use it)

**Deployment Coordination**:
- **DO NOT** deploy v2.3 bundles before this runtime is live
- **DO NOT** deploy this runtime without bge-m3 model files
- **Recommended**: Deploy runtime first, then compiler, then v2.3 bundles
- **Fallback**: If lexical.json missing in v2.3 bundles, runtime will degrade to dense-only mode (with warning)

**Responsible**: Compiler team

---

### 🟢 RECOMMENDED: Pre-Deployment Validation

**Test with Real v2.3 Bundle**:
1. Obtain verified v2.3 bundle from compiler team
2. Run end-to-end recall test:
   ```bash
   node test-embedding-recall.mjs <v2.3-bundle.hiv>
   ```
3. Validate:
   - Bundle loads without errors
   - Schema version detected as "2.3"
   - bge-m3 model loads successfully
   - Dense vector search produces reasonable results
   - Lexical.json presence/absence handled correctly

**Measure Performance**:
1. Model load time (first launch vs cached)
2. Inference latency (query embedding)
3. Memory footprint (both models resident)
4. Test on minimum spec device

**Calibrate Confidence Thresholds**:
1. Collect bge-m3 score distributions from test fixtures
2. Compare to MiniLM baseline (documented in code)
3. Validate or adjust thresholds in `hybridSearch.ts`
4. Document findings in `CONFIDENCE_CALIBRATION.md`

**Responsible**: QA / Testing team

---

## Deployment Steps

### 1. Deploy Model Files
```bash
# Copy bge-m3 model files to public/models/bge-m3/
# Verify file sizes match expectations
# Commit and push to repo
```

### 2. Deploy Runtime Code
```bash
# This implementation (all files already committed)
git push origin <branch>
# Deploy to production
```

### 3. Validate in Staging
```bash
# Load a v2.2 bundle - should use MiniLM (unchanged)
# Load a v2.3 bundle - should use bge-m3
# Check browser console for model load logs
# Verify no TypeScript errors
# Run test suite
```

### 4. Deploy Compiler Updates
```bash
# Compiler generates v2.3 bundles with lexical.json
# Verify bundle format via compiler tests
```

### 5. Release v2.3 Bundles
```bash
# Generate v2.3 bundles via compiler
# Distribute to users
# Monitor error logs for dimension mismatches
```

---

## Rollback Plan

### If Model Load Fails
**Symptom**: Users see "model not found" or download hangs

**Fix**:
1. Check model file paths in `public/models/bge-m3/`
2. Verify model files are accessible (not blocked by CDN/cache)
3. Fallback: Remove v2.3 bundles from distribution, keep v2.2 only

### If Dimension Mismatch Detected
**Symptom**: Console logs "dimension mismatch" warnings

**Fix**:
1. Check compiler output: embeddings.bin should be 1024-dim for v2.3
2. Verify runtime detects schema version correctly
3. Regenerate v2.3 bundle with correct dimensions

### If Recall Degrades
**Symptom**: Users report wrong or missing answers

**Fix**:
1. Check confidence thresholds (may need adjustment)
2. Verify lexical.json present in v2.3 bundles
3. Compare dense-only vs hybrid search quality
4. Rollback to v2.2 bundles if unrecoverable

---

## Monitoring & Alerts

**Key Metrics to Watch**:
- [ ] Model load success rate (v2.2 and v2.3)
- [ ] Average inference latency (should be comparable to v2.2)
- [ ] Memory usage (both models resident case)
- [ ] Search confidence gate firing rate (should not spike)
- [ ] Dense-only mode activation frequency (if high, lexical.json missing)

**Error Conditions to Alert On**:
- "Unrecognized schema version" errors (indicates incompatible bundle)
- "Dimension mismatch" warnings (indicates bundle/model version conflict)
- "lexical.json missing" warnings for v2.3 bundles (indicates compiler issue)
- Model load failures (download/parse errors)

---

## Success Criteria

- [ ] bge-m3 model files deployed and loadable
- [ ] v2.3 bundles load without errors
- [ ] Schema version detection works correctly
- [ ] v2.3 with lexical.json achieves comparable recall to v2.2
- [ ] v2.3 without lexical.json degrades gracefully (no crashes)
- [ ] All v2.2 bundles continue working unchanged
- [ ] Combined memory footprint acceptable on target devices
- [ ] No regression in inference latency
- [ ] Test suite passes (17/17 hivLoader + 15/15 schemaVersionRouting)

---

## Post-Deployment Tasks

1. **Monitor for 48 hours**:
   - Check error logs for schema version issues
   - Verify model load success rate
   - Monitor memory usage trends

2. **Measure bge-m3 Distribution**:
   - Collect real query score data
   - Update confidence thresholds if needed
   - Document in CONFIDENCE_CALIBRATION.md

3. **Plan Sparse Vector Support** (Future v2.4):
   - Research browser-compatible sparse generation
   - Design schema v2.4 format
   - Implement when feasible

4. **Deprecation Timeline for v2.2** (Future):
   - Once v2.3 proven stable (3-6 months)
   - Announce deprecation of v2.2 bundles
   - Remove MiniLM model after full migration
   - Clean up dual-path code

---

## Contact & Escalation

**For Runtime Issues**:
- Check implementation: `BGE_M3_IMPLEMENTATION_SUMMARY.md`
- Review code: Files listed in summary
- Test changes: `npm test -- schemaVersionRouting.test.ts`

**For Compiler Issues**:
- Verify schema_version field in manifest.json
- Check lexical.json generation for v2.3
- Validate embedding dimensions (1024 for v2.3)

**For Model Issues**:
- Verify Xenova/bge-m3 ONNX files present
- Check transformers.js version (v2.17.2+)
- Test model load in isolation: `await pipeline('feature-extraction', 'bge-m3')`

---

## Appendix: File Sizes

| Component | v2.2 (MiniLM) | v2.3 (bge-m3) | Notes |
|-----------|---------------|---------------|-------|
| Model ONNX | 113MB | ~280-550MB | Depends on quantization (q4/q8) |
| Total model size | 145MB | ~320-590MB | Including tokenizer, config |
| Bundle embeddings.bin | ~X MB (384-dim) | ~2.7X MB (1024-dim) | 2.67x larger per chunk |
| Bundle lexical.json | Same | Same | If present (pending compiler) |

**Impact on Users**:
- **First v2.3 bundle download**: +280-550MB one-time model download
- **Each v2.3 bundle**: +2.7x embeddings size vs v2.2
- **Both models cached**: ~430-735MB combined (for mixed bundle sets)

---

## Notes

- Implementation complete as of 2026-07-02
- All tests passing (32/32)
- TypeScript compilation clean (minor warnings acceptable)
- Ready for model file deployment
