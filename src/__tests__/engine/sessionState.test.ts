/**
 * sessionState.test.ts — SessionState unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SessionState from '@/engine/sessionState';

describe('SessionState', () => {
  let state: SessionState;

  beforeEach(() => {
    state = new SessionState();
  });

  describe('constructor', () => {
    it('initializes with empty buffers and null slots', () => {
      expect(state.turnBuffer).toEqual([]);
      expect(state.topicStack).toEqual([]);
      expect(state.slotMemory.patientAge).toBeNull();
      expect(state.slotMemory.patientWeightKg).toBeNull();
      expect(state.coveredChunks.size).toBe(0);
      expect(state.coveredAspects.size).toBe(0);
      expect(state.pendingGaps).toEqual([]);
      expect(state.sentimentHistory).toEqual([]);
      expect(state.currentTopic).toBeNull();
      expect(state.turnCount).toBe(0);
    });
  });

  describe('addTurn', () => {
    it('adds a turn and increments turnCount', () => {
      state.addTurn('hello', 'chunk-1', ['definition'], 'GREETING');
      expect(state.turnBuffer).toHaveLength(1);
      expect(state.turnCount).toBe(1);
      expect(state.turnBuffer[0].query).toBe('hello');
      expect(state.turnBuffer[0].chunkId).toBe('chunk-1');
    });

    it('trims turnBuffer to max 8 entries', () => {
      for (let i = 0; i < 10; i++) {
        state.addTurn(`q${i}`, `chunk-${i}`, [], 'CLINICAL');
      }
      expect(state.turnBuffer).toHaveLength(8);
      expect(state.turnBuffer[0].query).toBe('q2');
      expect(state.turnBuffer[7].query).toBe('q9');
    });

    it('adds chunkId to coveredChunks', () => {
      state.addTurn('test', 'chunk-a', [], 'CLINICAL');
      expect(state.wasChunkServed('chunk-a')).toBe(true);
    });
  });

  describe('wasChunkServed', () => {
    it('returns false for unserved chunks', () => {
      expect(state.wasChunkServed('unknown')).toBe(false);
    });

    it('returns true for served chunks', () => {
      state.addTurn('test', 'served', [], 'CLINICAL');
      expect(state.wasChunkServed('served')).toBe(true);
    });
  });

  describe('markAspectsCovered / getUncoveredAspects', () => {
    it('marks aspects as covered', () => {
      state.markAspectsCovered(['definition', 'dosage']);
      expect(state.coveredAspects.has('definition')).toBe(true);
      expect(state.coveredAspects.has('dosage')).toBe(true);
    });

    it('returns uncovered aspects', () => {
      state.markAspectsCovered(['definition']);
      const all = ['definition', 'dosage', 'referral'];
      expect(state.getUncoveredAspects(all)).toEqual(['dosage', 'referral']);
    });

    it('returns all aspects when none are covered', () => {
      const all = ['definition', 'dosage'];
      expect(state.getUncoveredAspects(all)).toEqual(['definition', 'dosage']);
    });

    it('returns empty array when all aspects are covered', () => {
      state.markAspectsCovered(['definition', 'dosage']);
      expect(state.getUncoveredAspects(['definition', 'dosage'])).toEqual([]);
    });
  });

  describe('detectTopicShift', () => {
    it('returns false when currentTopic is null', () => {
      expect(state.detectTopicShift('malaria')).toBe(false);
    });

    it('returns false when topic is unchanged', () => {
      state.currentTopic = 'malaria';
      expect(state.detectTopicShift('malaria')).toBe(false);
    });

    it('returns true when topic changes', () => {
      state.currentTopic = 'malaria';
      expect(state.detectTopicShift('pneumonia')).toBe(true);
    });
  });

  describe('onTopicShift', () => {
    it('pushes old topic to topicStack and resets aspects', () => {
      state.currentTopic = 'malaria';
      state.markAspectsCovered(['definition']);
      state.onTopicShift('pneumonia');
      expect(state.currentTopic).toBe('pneumonia');
      expect(state.topicStack).toContain('malaria');
      expect(state.coveredAspects.size).toBe(0);
    });

    it('preserves slot memory across topic shifts', () => {
      state.slotMemory.patientAge = '3 years';
      state.currentTopic = 'malaria';
      state.onTopicShift('pneumonia');
      expect(state.slotMemory.patientAge).toBe('3 years');
    });

    it('trims topicStack to max 5', () => {
      state.topicStack = ['a', 'b', 'c', 'd', 'e'];
      state.currentTopic = 'old';
      state.onTopicShift('new');
      expect(state.topicStack).toHaveLength(5);
      expect(state.topicStack[0]).toBe('old');
      expect(state.topicStack[4]).toBe('d');
    });
  });

  describe('pushSentiment / getDominantSentiment', () => {
    it('returns calm when no sentiment history', () => {
      expect(state.getDominantSentiment()).toBe('calm');
    });

    it('returns the only sentiment', () => {
      state.pushSentiment('panic');
      expect(state.getDominantSentiment()).toBe('panic');
    });

    it('returns dominant from last 3', () => {
      state.pushSentiment('calm');
      state.pushSentiment('panic');
      state.pushSentiment('panic');
      state.pushSentiment('confused');
      // last 3: panic, panic, confused → panic is dominant
      expect(state.getDominantSentiment()).toBe('panic');
    });

    it('trims sentimentHistory to max 5', () => {
      for (let i = 0; i < 7; i++) {
        state.pushSentiment('calm');
      }
      expect(state.sentimentHistory).toHaveLength(5);
    });
  });

  describe('normalizeAge', () => {
    it('normalizes 3 years to 36 months', () => {
      expect(state.normalizeAge('3 years')).toBe(36);
    });

    it('normalizes 6 months to 6 months', () => {
      expect(state.normalizeAge('6 months')).toBe(6);
    });

    it('normalizes 2 weeks to ~0 months', () => {
      expect(state.normalizeAge('2 weeks')).toBe(0);
    });

    it('normalizes 15 days to ~0 months', () => {
      expect(state.normalizeAge('15 days')).toBe(0);
    });

    it('returns null for invalid input', () => {
      expect(state.normalizeAge('old')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(state.normalizeAge('')).toBeNull();
    });
  });

  describe('normalizeWeight', () => {
    it('normalizes 15 kg to 15', () => {
      expect(state.normalizeWeight('15 kg')).toBe(15);
    });

    it('normalizes 1500 grams to 1.5', () => {
      expect(state.normalizeWeight('1500 grams')).toBe(1.5);
    });

    it('returns null for invalid input', () => {
      expect(state.normalizeWeight('heavy')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(state.normalizeWeight('')).toBeNull();
    });
  });
});
