/**
 * queryRewriter.test.ts — Query rewriter unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rewriteQuery } from '@/engine/queryRewriter';
import SessionState from '@/engine/sessionState';

describe('rewriteQuery', () => {
  let sessionState: SessionState;

  beforeEach(() => {
    sessionState = new SessionState();
  });

  describe('Stage 1 — Pronoun passthrough', () => {
    it('preserves raw query with pronouns (topic continuity handled in hybridSearch)', () => {
      sessionState.currentTopic = 'malaria';
      const result = rewriteQuery('what is it', 'CLINICAL', sessionState);
      expect(result.rewritten).toContain('what');
      expect(result.rewritten).toContain('is');
    });

    it('preserves "this" in query (resolved by hybridSearch title bonus)', () => {
      sessionState.currentTopic = 'newborn care';
      const result = rewriteQuery('what does this cover', 'SCOPE', sessionState);
      expect(result.rewritten).toContain('cover');
    });

    it('preserves "that" in query (resolved by hybridSearch title bonus)', () => {
      sessionState.currentTopic = 'ACT';
      const result = rewriteQuery('dose for that', 'DETAIL', sessionState);
      expect(result.rewritten).toContain('dose');
    });

    it('preserves query unchanged when currentTopic is null', () => {
      const result = rewriteQuery('what is it', 'CLINICAL', sessionState);
      expect(result.rewritten).toBe('what is it');
    });
  });

  describe('Stage 2 — Gap injection', () => {
    it('appends first pending gap for AFFIRM intent', () => {
      sessionState.pendingGaps = ['dosage'];
      const result = rewriteQuery('yes', 'AFFIRM', sessionState);
      expect(result.rewritten).toContain('dosage');
    });

    it('appends first pending gap for CLINICAL intent', () => {
      sessionState.pendingGaps = ['referral'];
      const result = rewriteQuery('tell me more', 'CLINICAL', sessionState);
      expect(result.rewritten).toContain('referral');
    });

    it('does not inject gap when pendingGaps is empty', () => {
      const result = rewriteQuery('yes', 'AFFIRM', sessionState);
      expect(result.rewritten).toBe('yes');
    });
  });

  describe('Stage 3 — Slot injection', () => {
    it('appends chiefComplaint to query', () => {
      sessionState.slotMemory.chiefComplaint = 'malaria';
      const result = rewriteQuery('what is the dose', 'DETAIL', sessionState);
      expect(result.rewritten).toContain('malaria');
    });

    it('appends "infant neonate" for age < 24 months', () => {
      sessionState.slotMemory.patientAgeMonths = 6;
      const result = rewriteQuery('fever treatment', 'CLINICAL', sessionState);
      expect(result.rewritten).toContain('infant');
    });

    it('appends "child" for age >= 24 months', () => {
      sessionState.slotMemory.patientAgeMonths = 36;
      const result = rewriteQuery('fever treatment', 'CLINICAL', sessionState);
      expect(result.rewritten).toContain('child');
      expect(result.rewritten).not.toContain('infant');
    });

    it('does not append age modifier when age is null', () => {
      const result = rewriteQuery('fever treatment', 'CLINICAL', sessionState);
      expect(result.rewritten).not.toContain('infant');
      expect(result.rewritten).not.toContain('child');
    });
  });

  describe('Stage 4 — Topic continuity (handled in hybridSearch)', () => {
    it('does NOT prepend currentTopic to query (handled by search title bonus)', () => {
      sessionState.currentTopic = 'malaria';
      const result = rewriteQuery('what about it', 'CLINICAL', sessionState);
      expect(result.rewritten.startsWith('malaria')).toBe(false);
      expect(result.rewritten).toContain('what');
    });

    it('preserves query unmodified regardless of clinical keyword count', () => {
      sessionState.currentTopic = 'malaria';
      const result = rewriteQuery('my patient has malaria and fever', 'CLINICAL', sessionState);
      expect(result.rewritten).toContain('malaria');
      expect(result.rewritten).toContain('fever');
    });
  });

  describe('detectedTopic and isTopicShift', () => {
    it('detects topic shift when new topic differs', () => {
      sessionState.currentTopic = 'malaria';
      // Use a query with >= 2 clinical keywords so topic continuity does not prepend currentTopic
      const result = rewriteQuery('what is pneumonia with fever', 'DEFINE', sessionState);
      // extractTopic returns the first matching keyword ('fever' appears before 'pneumonia' in the list)
      expect(result.detectedTopic).toBe('fever');
      expect(result.isTopicShift).toBe(true);
    });

    it('does not detect topic shift when topic is same', () => {
      sessionState.currentTopic = 'malaria';
      const result = rewriteQuery('malaria dose', 'DETAIL', sessionState);
      expect(result.detectedTopic).toBe('malaria');
      expect(result.isTopicShift).toBe(false);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate terms', () => {
      sessionState.currentTopic = 'malaria';
      sessionState.slotMemory.chiefComplaint = 'malaria';
      const result = rewriteQuery('malaria treatment', 'CLINICAL', sessionState);
      const words = result.rewritten.split(' ');
      const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^\w]/g, '')).filter(Boolean));
      expect(words.filter(Boolean).length).toBe(uniqueWords.size);
    });
  });
});
