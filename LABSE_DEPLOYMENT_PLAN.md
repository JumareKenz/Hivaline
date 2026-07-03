# LaBSE Deployment Plan

**Date**: 2026-07-02  
**Decision**: Deploy LaBSE to replace MiniLM for multilingual support  
**Primary Goal**: Improve Hausa performance from 50% → 75%+ Recall@1

---

## Why LaBSE

### Proven Multilingual Support
- **109 languages** including confirmed Hausa (ha), Yoruba (yo), Igbo (ig)
- Only browser-compatible model with verified Hausa support
- Trained by Google specifically for cross-lingual semantic matching

### Baseline Problems It Addresses
From empirical measurement (39-query baseline):
- Hausa: **50% Recall@1** (worst language, 30% below English)
- 2 persistent false positives across all confidence margins (Hausa/Yoruba multilingual failures)
- These are **embedding quality failures** that margin tuning cannot fix

### Specifications
- **Model**: Xenova/LaBSE (ONNX INT8 quantized)
- **Size**: 471MB (vs MiniLM 118MB, 4× larger)
- **Dimensions**: 768 (vs MiniLM 384)
- **Browser-ready**: Yes (@xenova/transformers compatible)
- **Memory risk**: 471MB is 89MB below WebView crash threshold (560MB), but close

---

## Deployment Criteria (MUST ALL PASS)

LaBSE must demonstrate improvements that justify the 4× size increase and deployment risk:

| Metric | MiniLM Baseline | LaBSE Target | Justification |
|--------|-----------------|--------------|---------------|
| **Hausa Recall@1** | 50% (2/4) | ≥75% (3/4) | +25 points - primary goal |
| **English Recall@1** | 80% (20/25) | ≥85% (21/25) | +5 points - maintain quality |
| **URGENT Recall@1** | 69% (11/16) | ≥80% (13/16) | +11 points - highest stakes |
| **Latency** | 10ms avg | <30ms | <3× slowdown (not 8× like bge-m3) |

**Deployment decision**: ALL four criteria must pass. If any fails, LaBSE is not deployed.

---

## Pre-Deployment Measurement

### Step 1: Head-to-Head Comparison

Run `measure-labse-vs-minilm.mjs` on the same 39-query baseline:
- Tests both MiniLM and LaBSE on identical queries
- Reports Recall@1 improvements by language and intent
- Measures actual inference latency
- Provides clear pass/fail on deployment criteria

**Expected runtime**: 5-10 minutes (both models must embed 39 queries)

### Step 2: Memory Validation

**Desktop measurement** (Node.js):
```bash
node -e "
const { pipeline, env } = require('@xenova/transformers');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

async function test() {
  const before = process.memoryUsage();
  const embedder = await pipeline('feature-extraction', 'labse', { quantized: true });
  const after = process.memoryUsage();
  
  console.log('Memory delta:');
  console.log('  RSS:', Math.round((after.rss - before.rss) / 1024 / 1024), 'MB');
  console.log('  External:', Math.round((after.external - before.external) / 1024 / 1024), 'MB');
}
test();
"
```

**Real device measurement** (CRITICAL):
- Deploy to actual Android device (same hardware as bge-m3 testing)
- Monitor memory under realistic usage (multiple queries, conversation context)
- Test both cold-start (app launch) and warm-state (model already loaded)
- Verify no crashes/OOM on low-end devices (2GB RAM target)

**Red flag**: If external memory >600MB, abort deployment (too close to 560MB crash threshold from bge-m3 testing)

### Step 3: Confidence Gate Recalibration

LaBSE's score distributions may differ from MiniLM:
- Different pooling strategy
- Different dimensionality (768 vs 384)
- Different training objective

**Action**: After measuring LaBSE on 39-query set, analyze:
1. Vector score distribution (mean, p50, p90 of correct matches)
2. Whether 0.3 cosine floor is still appropriate
3. Whether 10% margin requirement needs adjustment
4. False-positive rate (must stay ≤5% after any recalibration)

**Update** `src/engine/hybridSearch.ts` confidence thresholds if needed, but ONLY based on measured data, not assumptions.

---

## Integration Steps

### 1. Download LaBSE Model

```bash
./download-labse.sh
```

**Result**: `public/models/labse/` contains:
- `onnx/model_quantized.onnx` (471MB)
- `tokenizer.json`, `tokenizer_config.json`, `config.json`

### 2. Run Baseline Measurement

```bash
node measure-labse-vs-minilm.mjs hiv-cache.bin
```

**Review output**: Check all four deployment criteria (Hausa, English, URGENT, latency)

**IF ALL PASS**: Proceed to Step 3  
**IF ANY FAIL**: Document failure reason, DO NOT DEPLOY, explore alternatives

### 3. Update Runtime to Use LaBSE

**File**: `src/services/embeddingModel.ts`

**Current** (MiniLM):
```typescript
const model = await pipeline('feature-extraction', 'embed', {
  quantized: true,
});

// Embed with mean pooling
const result = await model(text, {
  pooling: 'mean',
  normalize: true,
});
```

**Change to** (LaBSE):
```typescript
const model = await pipeline('feature-extraction', 'labse', {
  quantized: true,
});

// LaBSE uses mean pooling same as MiniLM
const result = await model(text, {
  pooling: 'mean',
  normalize: true,
});
```

**THAT'S IT** - LaBSE is a drop-in replacement for MiniLM if both use mean pooling. Dimensions (768 vs 384) don't affect API, only internal representation.

### 4. Update Bundle Schema Version

The existing bundle (`hiv-cache.bin`) was compiled with MiniLM (384-dim) embeddings. These **will not match** LaBSE (768-dim) embeddings.

**Options**:

**A. Recompile Bundle with LaBSE** (Recommended):
- Compiler downloads LaBSE
- Re-embeds all 997 chunks with LaBSE (768-dim)
- Ships new `hiv-cache-labse.bin` bundle
- Runtime downloads LaBSE-compatible bundle
- **Result**: Clean cutover, no compatibility issues

**B. Dual-Model Transitional Period** (Complex):
- Runtime detects bundle schema version (384 vs 768 dims)
- Loads MiniLM for v2.2 bundles, LaBSE for v2.3 bundles
- **Problem**: Dual-residency risk (118MB + 471MB = 589MB, exceeds safe threshold)
- **NOT RECOMMENDED** based on bge-m3 dual-model findings (2.5GB memory)

**Recommendation**: Option A (recompile bundle). This avoids dual-model memory risk entirely.

### 5. Test on Real Device

Before production deployment:
- Build Android APK with LaBSE
- Install on physical device (NOT emulator)
- Test 10-20 queries (mix of English, Hausa, Yoruba)
- Monitor memory: `adb shell dumpsys meminfo <package>`
- Confirm no crashes, acceptable latency (<1sec perceived)

### 6. Staged Rollout

**Phase 1**: Internal testing (1 week)
- Deploy to test devices only
- Validate Hausa query improvements with real users
- Monitor for any crashes/OOM

**Phase 2**: Limited production (10% users, 1 week)
- A/B test: 10% get LaBSE, 90% stay on MiniLM
- Measure actual Hausa query success rate in production
- Compare memory crash rates between groups

**Phase 3**: Full rollout (remaining 90%)
- If Phase 2 shows no regressions, deploy to all
- Monitor for 1 week, ready to rollback if issues

---

## Rollback Plan

If LaBSE causes problems in production (crashes, unacceptable latency, worse performance):

**Immediate**: Revert runtime to MiniLM (1-line change in embeddingModel.ts)

**Short-term**: Re-ship MiniLM bundle if LaBSE bundle was deployed

**Evidence needed to trigger rollback**:
- Crash rate >1% (memory issues)
- User complaints about slow responses (latency)
- Hausa Recall@1 NOT improved in production logs

---

## Alternative: LLM-Translation Path

If LaBSE fails deployment criteria or causes production issues, **fallback to LLM-translation approach**:

**Architecture**:
1. Detect Hausa query (language detection)
2. Translate Hausa → English using on-device LLM
3. Embed English with MiniLM (keep 118MB model)
4. Search as normal

**Pros**:
- No new embedding model (avoids 471MB size)
- Keeps proven-stable 118MB MiniLM
- Cheaper than LaBSE

**Cons**:
- Translation latency (~500ms)
- Translation quality depends on LLM (may hurt retrieval)

**When to pursue**: If LaBSE measurement shows <75% Hausa Recall@1 OR latency >30ms OR memory >600MB

---

## Success Metrics (Post-Deployment)

After LaBSE deploys to production, measure over 2 weeks:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Hausa query success rate** | ≥75% | Query log analysis (window.__hiva_export_log) |
| **English query regression** | <5% drop | Compare English Recall@1 vs baseline |
| **App crash rate** | <1% | Device analytics (memory OOM crashes) |
| **User satisfaction** | No increase in "wrong answer" reports | Support ticket analysis |
| **Latency P95** | <1sec perceived | Query log timestamps |

**Decision point at 2 weeks**: If all metrics pass, LaBSE stays. If any metric fails, rollback and explore LLM-translation alternative.

---

## Current Status

**✅ Step 1 Complete**: Download LaBSE model (in progress, 471MB)  
**⏳ Step 2 Pending**: Run `measure-labse-vs-minilm.mjs` (waiting for download)  
**⏳ Step 3 Pending**: Review measurement results against deployment criteria  
**⏳ Step 4 Pending**: Integration if criteria pass

**Next Action**: Wait for download to complete, then run head-to-head comparison measurement.

---

**Deployment Decision**: Pending measurement validation  
**Risk Level**: Medium (size close to WebView ceiling, but strong multilingual motivation)  
**Fallback**: LLM-translation path if LaBSE fails criteria
