# Confidence Gate Calibration for bge-m3

## Current Thresholds (Pending Measurement)

These thresholds were designed for MiniLM (384-dim) score distributions and need validation against bge-m3 (1024-dim) distributions:

### Vector Search Confidence (isVectorSignalConfident)
- **Cosine floor**: 0.3 (absolute minimum similarity)
- **Margin requirement**: 10% separation between top and second result
- **Rationale**: Below 0.3 cosine, embedding sees no meaningful similarity. 10% margin prevents noisy clusters from polluting BM25 matches.

### BM25 Confidence
- **BM25 floor**: 1.5 (minimum lexical match quality)
- **Rationale**: Prevents coincidental matches on single generic terms like "dose", "child"

### Dense-Only Mode (v2.3 without lexical.json)
- **Cosine floor**: 0.4 (stricter than normal 0.3)
- **Rationale**: With no lexical signal to validate, require stronger dense signal to avoid false positives

## Measurement Plan

To validate these thresholds for bge-m3:

1. **Collect score distributions** from real query/chunk fixtures:
   - Run test-embedding-recall.mjs against v2.3 bundle
   - Capture dense cosine scores for known-good matches vs random pairs
   - Measure actual score ranges for bge-m3 vs MiniLM

2. **Analyze score distribution characteristics**:
   - Mean/median/p90 for true positive matches
   - Distribution of false positive scores
   - Optimal threshold that maximizes recall while keeping precision high

3. **Compare to existing thresholds**:
   - Do bge-m3 scores cluster higher/lower than MiniLM?
   - Does 0.3 floor still effectively reject random matches?
   - Is 0.4 floor for dense-only mode appropriately conservative?

## Expected Differences

bge-m3 vs MiniLM behavioral differences to watch for:

1. **Pooling strategy**: bge-m3 uses CLS pooling (not mean) → may produce different score distributions
2. **Model capacity**: 1024-dim has more expressiveness → potentially tighter clusters (higher cosine for true matches, lower for false)
3. **Training objective**: bge-m3 optimized for both dense and sparse → dense scores may be more discriminative

## Action Items

- [ ] Collect bge-m3 score distributions from test fixtures
- [ ] Compare distributions to MiniLM baseline
- [ ] Propose adjusted thresholds based on measured data
- [ ] Update thresholds in hybridSearch.ts with data-backed rationale
- [ ] Document final calibration in this file

## Notes

- **DO NOT** adjust thresholds without measurement data
- **DO NOT** assume MiniLM thresholds transfer to bge-m3 unchanged
- Test against real clinical queries (not synthetic data) to capture actual distribution
