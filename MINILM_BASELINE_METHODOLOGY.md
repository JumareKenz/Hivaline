# MiniLM Baseline Retrieval Measurement — Methodology

**Date**: 2026-07-02  
**Purpose**: Establish empirical baseline of current MiniLM retrieval quality BEFORE any embedding model replacement investigation  
**Model**: `paraphrase-multilingual-MiniLM-L12-v2` (384-dim, quantized INT8)  
**Bundle**: `2026.06.24.62` (997 chunks, v2.2 schema)

---

## Why This Measurement

The entire bge-m3 investigation (multiple model candidates, native runtime feasibility, quantization exploration across three model families) was **motivated by an assumed retrieval-quality problem that was never empirically measured**. Every investigation focused on "is candidate X viable" without first establishing:

1. **Is there actually a quality problem with the current model?**
2. **If so, how severe, and in which dimensions?**
3. **What numeric improvement would justify replacement cost?**

This task corrects that gap. These numbers become the baseline every future candidate must beat.

---

## Test Set Construction

### Coverage Dimensions

1. **Language representation**:
   - English: 24 queries (primary language, baseline performance)
   - Hausa: 4 queries (major Nigerian language, historically uncertain performance)
   - Yoruba: 4 queries (major Nigerian language, historically uncertain performance)
   - Igbo: 4 queries (major Nigerian language, historically uncertain performance)
   - Pidgin: 2 queries (West African English variant, colloquial phrasing)
   - **Total**: 38 queries

2. **Clinical intent types**:
   - URGENT: Life-threatening conditions, danger signs, emergency protocols
   - DEFINE: Terminology clarification ("What is X?")
   - DETAIL: Deep-dive explanations, side effects, interactions
   - PROCEDURE: Step-by-step workflows ("How to screen for TB")
   - DOSAGE: Weight-based medication dosing queries
   - UNKNOWN: Out-of-domain queries (should be rejected by confidence gate)

3. **Query complexity**:
   - Single-concept: "What is PMTCT?"
   - Multi-concept: "ART regimen for pregnant woman with TB"
   - Dosage-specific: "ARV dose for 10kg child"
   - Colloquial/informal: Pidgin phrasing, natural user language

### Query Sources

**PRIMARY**: Hand-crafted queries representing realistic clinical phrasing patterns based on:
- Existing test harness queries (test-embedding-recall.mjs, retrievalRelevance.test.ts)
- Domain knowledge of clinical information needs
- Nigerian language translation of core clinical concepts

**LIMITATION ACKNOWLEDGED**: Real user query data (from `hiva_query_log` localStorage buffer) is NOT accessible in this Node.js measurement environment. Real production queries would:
- Reveal actual user phrasing patterns (likely more varied/messy than synthetic test queries)
- Show frequency distribution of intent types
- Capture edge cases not anticipated in hand-crafted sets

**MITIGATION**: Query set includes:
- Informal/colloquial phrasing (Pidgin)
- Multi-concept queries simulating realistic clinical complexity
- Dosage queries with specific weight ranges (common user pattern)
- Expected-reject cases (out-of-domain) to test confidence gate

For production validation, the `window.__hiva_export_log()` function should be called after real usage sessions to extract actual query patterns, then this harness re-run with real data.

### Nigerian Language Queries

Hausa/Yoruba/Igbo test cases were **explicitly constructed** for this measurement because:
1. Prior investigations informally characterized Nigerian-language performance as "weak but functional" without quantifying it
2. The multilingual model replacement motivation hinges on whether this weakness is severe enough to justify complex alternatives (LaBSE, SONAR, LLM-translation-before-embedding)
3. **No existing test coverage** for these languages in the prior test harnesses

Each Nigerian-language query:
- Translates a core clinical concept (HIV treatment initiation, malaria signs, pediatric dosing, newborn danger signs)
- Maps to an expected English-content chunk (bundle is English-only)
- Tests MiniLM's cross-lingual semantic matching capability
- Includes `note:` field with English translation for result interpretation

**Expected behavior**: MiniLM's multilingual training should match Nigerian-language queries to semantically equivalent English chunks via the shared embedding space. Performance drop vs English queries quantifies the multilingual capability gap.

---

## Measurement Metrics

### Recall@K
- **Recall@1**: Correct chunk is the top-ranked result (user sees it immediately)
- **Recall@5**: Correct chunk appears in top 5 (user can scan/find it)
- **Recall@10**: Correct chunk appears in top 10 (retrievable but buried)

**Why all three**: Recall@1 alone hides whether near-misses are rank 2 or rank 50. A system with Recall@1=70% but Recall@5=95% has a different problem (ranking) than one with Recall@5=72% (missing the content entirely).

### Mean Reciprocal Rank (MRR)
Average of `1/rank` for the first correct result per query.
- MRR close to 1.0 → correct answers consistently rank #1
- MRR << 1.0 → correct answers often buried in results

Distinguishes "top result is perfect" from "correct answer at rank 8".

### Confidence Gate Analysis
The production pipeline uses a confidence gate to decide whether to:
- Show the top result directly, or
- Fallback to "I need more information" / escalate to synthesis layer

**Gate logic** (from hybridSearch.ts):
- Vector score < 0.3 → REJECT
- Vector margin < 10% (top result vs 2nd result) → REJECT
- BM25 score < 1.5 AND vector not confident → REJECT
- Dense-only mode (no BM25): require vector score ≥ 0.4

**Measured**:
- **False positive rate**: Gate passed the query but retrieved the wrong chunk (or should have rejected out-of-domain)
- **False negative rate**: Gate rejected the query but the correct chunk WAS in top 10 (had an answer, unnecessarily cautious)

**Why this matters**: Gate miscalibration is a **separate failure mode** from embedding quality:
- High FP rate → users see confident wrong answers (erodes trust)
- High FN rate → users get "I don't know" when the system actually knows (poor UX)
- Embedding model swap won't fix gate calibration if thresholds don't transfer

---

## Pipeline Fidelity

The measurement runs the **production retrieval pipeline** exactly:
1. Synonym expansion (query rewriter)
2. BM25 lexical search
3. MiniLM vector search (real model, not mock)
4. Confidence gate evaluation
5. RRF (Reciprocal Rank Fusion) of BM25 + vector results
6. Return top-K ranked chunks

**What's NOT simulated**:
- Intent classification effects on search (assumed DETAIL intent for all)
- Slot extraction / structured query decomposition
- LLM synthesis layer (separate from retrieval)
- Multi-turn conversation context

**Why**: The goal is to isolate **retrieval quality** (does the right chunk appear in top-K?) from synthesis quality (does the LLM generate a good answer from that chunk?). A retrieval baseline must measure retrieval, not the full system.

---

## Interpretation Guidelines

### English Performance

**High Recall@1 (>85%)**: Original bge-m3 motivation was likely speculative, not addressing a real measured problem. No embedding model swap justified.

**Moderate Recall@1 (70-85%)**: Quality issues exist but may not be embedding-dimensionality related. Investigate:
- Are failures clustered by query pattern? (e.g., multi-concept queries, dosage specificity)
- Are they BM25 failures (lexical mismatch) or vector failures?
- Could chunking strategy changes fix this more cheaply than model swap?

**Low Recall@1 (<70%)**: Confirmed quality problem. Embedding model replacement or alternative approaches (LLM-translation, better chunking) warranted. Set **minimum improvement threshold**: new model must achieve ≥15% absolute gain (e.g., 65% → 80%) to justify complexity/cost.

### Nigerian Language Performance

Compare Hausa/Yoruba/Igbo Recall@1 to English baseline:

**Within 10% of English** (e.g., English 80%, Nigerian 70-80%): Multilingual capability is "functional" — confirms informal prior characterization. Specialized multilingual model (LaBSE, SONAR) would improve this but **is it worth the cost?**

**10-30% below English** (e.g., English 80%, Nigerian 50-70%): Meaningful degradation. Investigate:
- Is it query phrasing (translation quality in test cases)?
- Is it semantic drift (MiniLM's multilingual training doesn't cover these languages well)?
- Would LLM-translation-before-embedding (translate Hausa → English, then use MiniLM) close the gap more cheaply than deploying LaBSE/SONAR?

**>30% below English** (e.g., English 80%, Nigerian <50%): Severe multilingual failure. LaBSE (confirmed Hausa/Yoruba/Igbo support) or LLM-translation approach is justified IF Nigerian-language usage is significant enough to prioritize.

### Intent-Type Breakdown

**DOSAGE queries perform worse**: Likely a chunking problem (dosage tables need finer-grained chunks) or BM25 issue (weight-specific lexical match), not embedding dimensionality. Model swap won't fix this.

**URGENT queries perform worse**: Could indicate multi-concept retrieval weakness (e.g., "pregnant woman with HIV and TB" packs multiple clinical dimensions). This WOULD be helped by higher-dimensional embeddings (bge-m3 1024-dim) — but only if the performance gap is large and the 8× latency penalty is acceptable.

**DEFINE queries perform well, DETAIL queries worse**: May indicate that MiniLM handles simple concept-matching well but struggles with nuanced distinctions. Could point to dimensionality limits.

### Confidence Gate

**High FP rate (>15%)**: Gate is too permissive. Tighten thresholds (raise vector floor from 0.3 to 0.35, or margin from 10% to 15%). No model swap needed.

**High FN rate (>20%)**: Gate is too conservative. Relax thresholds or trust vector more. No model swap needed.

**Both rates acceptable (<10% each)**: Gate is well-calibrated for MiniLM score distributions. **IMPORTANT**: If model swap happens (bge-m3, etc.), these thresholds WILL need recalibration — bge-m3's score distribution is different (CLS pooling vs mean, 1024-dim vs 384-dim). Don't assume thresholds transfer.

---

## Next Steps Based on Findings

### IF English Recall@1 > 85% AND Nigerian languages within 15% of English:
**VERDICT**: No confirmed quality problem justifies embedding model replacement.
**ACTION**: Close bge-m3/LaBSE/SONAR investigations as speculative. Focus optimization elsewhere (chunking, BM25 tuning, synthesis quality).

### IF English Recall@1 is 70-85% with pattern-specific failures:
**VERDICT**: Quality issues exist but may not be model-related.
**ACTION**: Before any model swap, investigate root causes:
- Run failure pattern analysis (which query types fail? Why?)
- Test chunking strategy changes
- Test BM25 index improvements (better tokenization, synonym expansion)
- Measure whether issue is retrieval or synthesis

### IF English Recall@1 < 70%:
**VERDICT**: Confirmed retrieval quality problem.
**ACTION**: Embedding model replacement is justified IF:
1. A candidate can demonstrate ≥15% absolute improvement (e.g., 65% → 80%)
2. Latency penalty is acceptable (<3× slowdown)
3. Memory footprint fits device constraints (<300MB incremental)

### IF Nigerian language performance is >30% below English:
**VERDICT**: Multilingual capability gap is severe.
**ACTION**: Two paths, evaluate both before choosing:
1. **LaBSE/SONAR**: Deploy specialized multilingual model (if size/latency acceptable)
2. **LLM-translation-before-embedding**: Use existing on-device LLM to translate Hausa/Yoruba/Igbo → English before embedding with MiniLM. Cheaper (no new embedding model), leverages confirmed-working MiniLM, but adds translation latency and risk of translation errors affecting retrieval.

---

## Output Artifact

This measurement produces a complete report including:
- Overall Recall@1/5/10 and MRR
- Language-specific breakdown (English vs Hausa vs Yoruba vs Igbo vs Pidgin)
- Intent-type breakdown
- Confidence gate false positive/negative rates
- Detailed failure analysis (which queries failed, what was retrieved instead)
- Confidence gate error analysis

This report becomes the **reference baseline** for all future embedding model investigations. Any candidate model must be measured with this same harness and demonstrate clear, quantified improvement to justify replacement.

---

**Measurement Harness**: `measure-minilm-baseline.mjs`  
**Bundle**: `hiv-cache.bin` (2026.06.24.62)  
**Test Set**: 38 queries (24 English, 4 Hausa, 4 Yoruba, 4 Igbo, 2 Pidgin)  
**Run Command**: `node measure-minilm-baseline.mjs hiv-cache.bin`
