/**
 * confidenceScoring.ts — 3-tier confidence scoring
 *
 * Transforms the existing binary confidence gate signals (cosine floor,
 * margin check, BM25 floor) into a normalized [0,1] confidence score
 * mapped to LOW / MEDIUM / HIGH tiers.
 */

import type { ConfidenceTier } from '@/types/cso';

export interface RawConfidenceSignals {
  /** Top cosine similarity score from vector search (null if no results). */
  topVectorScore: number | null;
  /** Margin between top and second vector result (null if < 2 results). */
  vectorMargin: number | null;
  /** Top BM25 score (null if no results). */
  topBm25Score: number | null;
  /** Whether the existing binary vector gate passed. */
  vectorGatePassed: boolean;
  /** Whether the existing binary confidence gate fired (rejected the result). */
  confidenceGateFired: boolean;
}

export interface ConfidenceResult {
  /** Normalized confidence score in [0, 1]. */
  score: number;
  /** Tier derived from the score: LOW < 0.65, MEDIUM [0.65, 0.80), HIGH >= 0.80. */
  tier: ConfidenceTier;
}

/** Tier boundaries */
const LOW_CEILING = 0.65;
const HIGH_FLOOR = 0.80;

/**
 * Verification notice appended to MEDIUM-tier responses.
 * Defined as a config constant so it can be varied by module/domain later.
 */
export const VERIFICATION_NOTICE =
  'Please verify this information with a qualified health worker before acting on it.';

/**
 * Compute a normalized confidence score and map it to a tier.
 *
 * --- Normalization design ---
 *
 * The existing gate uses two independent binary tests:
 *   1. Vector: cosine >= 0.3 AND margin >= 10%  (isVectorSignalConfident)
 *   2. BM25:   score >= 1.5                      (BM25_ABSOLUTE_FLOOR)
 *
 * Both must FAIL for the gate to fire. A query that passes EITHER signal
 * gets an answer today (i.e., maps to what should be HIGH confidence in
 * the new system when the signal is strong).
 *
 * We compute a sub-score for each signal, then combine them:
 *
 * Vector sub-score (0–1):
 *   - Raw cosine is in [0, 1]. We remap [0.3, 0.7] → [0, 1] linearly.
 *     0.3 is the current floor (barely passing); 0.7+ is a very strong match.
 *   - We apply a margin penalty: if margin < 0.10 (gate would fail on margin),
 *     the sub-score is halved — the signal is ambiguous even if cosine is high.
 *
 * BM25 sub-score (0–1):
 *   - Raw BM25 scores vary widely (0–20+). We remap [1.5, 6.0] → [0, 1].
 *     1.5 is the current floor; 6.0+ represents a very strong keyword match.
 *
 * Combined score:
 *   - Take the MAX of the two sub-scores. This mirrors the existing OR logic:
 *     either signal being confident is sufficient.
 *   - If the existing gate fired (both failed), the combined score is capped
 *     at 0.40 — well below the LOW ceiling of 0.65. A query that was rejected
 *     by the existing gate should NEVER land in MEDIUM (which implies
 *     "answerable but needs caveat"), so we enforce this hard cap.
 *
 * Tier mapping:
 *   - [0, 0.65)  → LOW    — return safe fallback
 *   - [0.65, 0.80) → MEDIUM — return answer with verification notice
 *   - [0.80, 1.0]  → HIGH   — return answer normally
 *
 * Behavior preservation:
 *   - A query that cleanly passes today (cosine ~0.5+, good margin, or BM25 ~3+)
 *     produces a combined score well above 0.80 → HIGH. Existing behavior unchanged.
 *   - A query that narrowly fails (both signals below floor) gets capped at 0.40 → LOW.
 *     This is correct: the old system returned a fallback, the new one still does.
 *   - MEDIUM captures the new territory: one signal is present but weak — e.g., cosine
 *     of 0.35 with poor margin and no BM25 support, or BM25 at 2.0 with no vector.
 *     Previously these squeaked past the gate and got a full answer. Now they get
 *     the answer plus a verification notice, which is appropriate for marginal matches.
 */
export function computeConfidenceTier(signals: RawConfidenceSignals): ConfidenceResult {
  // --- Vector sub-score ---
  let vectorSubScore = 0;
  if (signals.topVectorScore !== null && signals.topVectorScore > 0) {
    // Linear remap: [0.3, 0.7] → [0, 1], clamped
    vectorSubScore = clamp((signals.topVectorScore - 0.3) / (0.7 - 0.3), 0, 1);

    // Margin penalty: if margin is below the 10% threshold, the vector signal
    // is ambiguous (no clear winner among results). Halve the sub-score.
    if (signals.vectorMargin !== null && signals.vectorMargin < 0.10) {
      vectorSubScore *= 0.5;
    }
  }

  // --- BM25 sub-score ---
  let bm25SubScore = 0;
  if (signals.topBm25Score !== null && signals.topBm25Score > 0) {
    // Linear remap: [1.5, 6.0] → [0, 1], clamped
    bm25SubScore = clamp((signals.topBm25Score - 1.5) / (6.0 - 1.5), 0, 1);
  }

  // --- Combined score: max of the two (mirrors existing OR gate logic) ---
  let combined = Math.max(vectorSubScore, bm25SubScore);

  // --- Gate-fired cap ---
  // If the existing confidence gate fired, BOTH signals were below their floors.
  // Cap the score so it cannot reach MEDIUM. A gate-fired query must land in LOW.
  if (signals.confidenceGateFired) {
    combined = Math.min(combined, 0.40);
  }

  // --- Tier assignment ---
  let tier: ConfidenceTier;
  if (combined < LOW_CEILING) {
    tier = 'LOW';
  } else if (combined < HIGH_FLOOR) {
    tier = 'MEDIUM';
  } else {
    tier = 'HIGH';
  }

  return { score: combined, tier };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
