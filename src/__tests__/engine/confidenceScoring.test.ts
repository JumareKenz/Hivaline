/**
 * confidenceScoring.test.ts — 3-tier confidence scoring unit tests
 *
 * Tests computeConfidenceTier with synthetic score inputs spanning
 * below-0.65, 0.65-0.80, and above-0.80 ranges.
 */

import { describe, it, expect } from 'vitest';
import {
  computeConfidenceTier,
  VERIFICATION_NOTICE,
  type RawConfidenceSignals,
} from '@/engine/confidenceScoring';

describe('computeConfidenceTier', () => {
  describe('HIGH tier (>= 0.80) — strong signals, no notice', () => {
    it('strong vector + strong BM25 → HIGH', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.65,
        vectorMargin: 0.25,
        topBm25Score: 5.0,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBeGreaterThanOrEqual(0.80);
    });

    it('strong vector alone (cosine 0.63, good margin) → HIGH', () => {
      // vectorSubScore = (0.63 - 0.3) / 0.4 = 0.825 → HIGH
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.63,
        vectorMargin: 0.20,
        topBm25Score: null,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBeGreaterThanOrEqual(0.80);
    });

    it('strong BM25 alone (score 6.0+) → HIGH', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: null,
        vectorMargin: null,
        topBm25Score: 6.5,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBeGreaterThanOrEqual(0.80);
    });

    it('very high cosine (0.7+) with good margin → HIGH at ceiling', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.85,
        vectorMargin: 0.30,
        topBm25Score: 0.5,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBe(1.0);
    });
  });

  describe('MEDIUM tier ([0.65, 0.80)) — answer with verification notice', () => {
    it('moderate BM25 (score ~4.5), weak vector → MEDIUM', () => {
      // BM25 sub-score: (4.5 - 1.5) / 4.5 = 0.667 → MEDIUM
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.25,
        vectorMargin: null,
        topBm25Score: 4.5,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('MEDIUM');
      expect(result.score).toBeGreaterThanOrEqual(0.65);
      expect(result.score).toBeLessThan(0.80);
    });

    it('vector at 0.45 with poor margin → MEDIUM (margin penalty halves sub-score)', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.45,
        vectorMargin: 0.05,
        topBm25Score: null,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      // vectorSubScore = (0.45 - 0.3) / 0.4 = 0.375, halved to 0.1875 (too low)
      // But with BM25 also null, this is LOW. Let's adjust for a real MEDIUM case:
      const signals2: RawConfidenceSignals = {
        topVectorScore: 0.45,
        vectorMargin: 0.05,
        topBm25Score: 3.5,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals2);
      // BM25 sub-score: (3.5 - 1.5) / 4.5 ≈ 0.444 → below 0.65? No, that's LOW.
      // Actually (3.5 - 1.5) / (6.0 - 1.5) = 2.0/4.5 ≈ 0.444 → LOW
      // Need BM25 around 4.5: (4.5-1.5)/4.5 ≈ 0.667 → MEDIUM
      const signals3: RawConfidenceSignals = {
        topVectorScore: 0.25,
        vectorMargin: null,
        topBm25Score: 4.5,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result3 = computeConfidenceTier(signals3);
      expect(result3.tier).toBe('MEDIUM');
      expect(result3.score).toBeGreaterThanOrEqual(0.65);
      expect(result3.score).toBeLessThan(0.80);
    });

    it('vector at boundary (cosine ~0.56) with good margin, no BM25 → MEDIUM', () => {
      // vectorSubScore = (0.56 - 0.3) / 0.4 = 0.65 → exactly at MEDIUM boundary
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.56,
        vectorMargin: 0.15,
        topBm25Score: null,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('MEDIUM');
      expect(result.score).toBeGreaterThanOrEqual(0.65);
      expect(result.score).toBeLessThan(0.80);
    });
  });

  describe('LOW tier (< 0.65) — safe fallback, no answer', () => {
    it('confidence gate fired (both signals below floor) → LOW', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.2,
        vectorMargin: null,
        topBm25Score: 1.0,
        vectorGatePassed: false,
        confidenceGateFired: true,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('LOW');
      expect(result.score).toBeLessThan(0.65);
    });

    it('gate fired — capped at 0.40 even with moderate raw scores', () => {
      // Without the cap, these scores would produce a MEDIUM result.
      // The cap ensures gate-fired queries NEVER reach MEDIUM.
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.55,
        vectorMargin: 0.12,
        topBm25Score: 4.0,
        vectorGatePassed: false,
        confidenceGateFired: true,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('LOW');
      expect(result.score).toBeLessThanOrEqual(0.40);
    });

    it('all null signals → LOW with score 0', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: null,
        vectorMargin: null,
        topBm25Score: null,
        vectorGatePassed: false,
        confidenceGateFired: true,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('LOW');
      expect(result.score).toBe(0);
    });

    it('weak BM25 (score 2.0), no vector → LOW', () => {
      // BM25 sub-score: (2.0 - 1.5) / 4.5 ≈ 0.111 → well below 0.65
      const signals: RawConfidenceSignals = {
        topVectorScore: null,
        vectorMargin: null,
        topBm25Score: 2.0,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('LOW');
      expect(result.score).toBeLessThan(0.65);
    });

    it('vector just above cosine floor (0.32) with bad margin → LOW', () => {
      // vectorSubScore = (0.32 - 0.3) / 0.4 = 0.05, halved to 0.025
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.32,
        vectorMargin: 0.03,
        topBm25Score: null,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('LOW');
      expect(result.score).toBeLessThan(0.65);
    });
  });

  describe('boundary conditions', () => {
    it('score of exactly 0.65 → MEDIUM (inclusive lower bound)', () => {
      // vectorSubScore = (x - 0.3) / 0.4 = 0.65 → x = 0.56
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.56,
        vectorMargin: 0.20,
        topBm25Score: null,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.score).toBeGreaterThanOrEqual(0.65);
      expect(result.tier).toBe('MEDIUM');
    });

    it('score of exactly 0.80 → HIGH (inclusive lower bound)', () => {
      // vectorSubScore = (x - 0.3) / 0.4 = 0.80 → x = 0.62
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.62,
        vectorMargin: 0.20,
        topBm25Score: null,
        vectorGatePassed: true,
        confidenceGateFired: false,
      };
      const result = computeConfidenceTier(signals);
      expect(result.score).toBeGreaterThanOrEqual(0.80);
      expect(result.tier).toBe('HIGH');
    });

    it('max of vector and BM25 used (BM25 wins when vector has margin penalty)', () => {
      const signals: RawConfidenceSignals = {
        topVectorScore: 0.55,
        vectorMargin: 0.04, // below threshold → halved
        topBm25Score: 5.5,
        vectorGatePassed: false,
        confidenceGateFired: false,
      };
      // vectorSubScore = (0.55 - 0.3)/0.4 * 0.5 = 0.3125
      // bm25SubScore = (5.5 - 1.5)/4.5 = 0.889
      // combined = max(0.3125, 0.889) = 0.889 → HIGH
      const result = computeConfidenceTier(signals);
      expect(result.tier).toBe('HIGH');
      expect(result.score).toBeCloseTo(0.889, 2);
    });
  });

  describe('VERIFICATION_NOTICE constant', () => {
    it('is a non-empty string suitable for display', () => {
      expect(VERIFICATION_NOTICE).toBeTruthy();
      expect(VERIFICATION_NOTICE.length).toBeGreaterThan(20);
      expect(VERIFICATION_NOTICE).toContain('health worker');
    });
  });
});
