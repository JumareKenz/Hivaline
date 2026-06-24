/**
 * driftDetector.test.ts — Drift detection and extractPrimaryTopic unit tests
 */

import { describe, it, expect } from 'vitest';
import { detectDrift, extractPrimaryTopic } from '@/engine/driftDetector';
import SessionState from '@/engine/sessionState';

describe('detectDrift', () => {
  it('does not fire when currentTopic is null', () => {
    const state = new SessionState();
    const result = detectDrift('malaria treatment', ['malaria'], state);
    expect(result.isDrift).toBe(false);
    expect(result.newTopic).toBeNull();
  });

  it('does not fire on follow-up within same topic', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    const result = detectDrift('what is the dose for malaria', ['malaria'], state);
    expect(result.isDrift).toBe(false);
    expect(result.newTopic).toBe('malaria');
  });

  it('fires on genuine topic shift', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    // Query has no token overlap with "malaria" and matched chunk is about pneumonia
    const result = detectDrift('tell me about pneumonia symptoms', ['pneumonia'], state);
    expect(result.isDrift).toBe(true);
    expect(result.newTopic).toBe('pneumonia');
  });

  it('does not fire when query shares tokens with current topic', () => {
    const state = new SessionState();
    state.currentTopic = 'newborn care';
    // "newborn" overlaps with "newborn care"
    const result = detectDrift('newborn feeding schedule', ['feeding'], state);
    expect(result.isDrift).toBe(false);
  });

  it('does not fire when matched chunk includes current topic', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    const result = detectDrift('unrelated query words here', ['malaria', 'fever'], state);
    expect(result.isDrift).toBe(false);
    expect(result.newTopic).toBe('malaria');
  });
});

/* ─── extractPrimaryTopic ─── */

describe('extractPrimaryTopic', () => {
  const COVERAGE = {
    'malaria': { aspects_covered: ['treatment', 'prevention'] },
    'antenatal care': { aspects_covered: ['schedule', 'danger signs'] },
    'outbreak preparedness': { aspects_covered: ['response', 'referral'] },
    'newborn care': { aspects_covered: ['feeding', 'resuscitation'] },
    'child health': { aspects_covered: ['immunization', 'nutrition'] },
  };

  // Priority 1: query match over chunk topics (5 fixtures)

  it('uses topic from coverage manifest when user names it in query', () => {
    const state = new SessionState();
    const result = extractPrimaryTopic(
      'what is antenatal care?',
      ['pregnancy', 'anc overview'],
      state,
      COVERAGE,
      0.5
    );
    expect(result).toBe('antenatal care');
  });

  it('uses query-mentioned topic even when chunk topics differ', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    const result = extractPrimaryTopic(
      'tell me about outbreak preparedness',
      ['tb', 'newborn care'],
      state,
      COVERAGE,
      0.3
    );
    expect(result).toBe('outbreak preparedness');
  });

  it('matches manifest topic via token overlap', () => {
    const state = new SessionState();
    const result = extractPrimaryTopic(
      'newborn care guidelines please',
      ['neonatal', 'feeding'],
      state,
      COVERAGE,
      0.4
    );
    expect(result).toBe('newborn care');
  });

  it('prefers explicit query mention over strong chunk match', () => {
    const state = new SessionState();
    const result = extractPrimaryTopic(
      'what about child health immunization',
      ['malaria', 'fever'],
      state,
      COVERAGE,
      0.9
    );
    expect(result).toBe('child health');
  });

  it('uses query-named topic for "Outbreak Preparedness and Response"', () => {
    const state = new SessionState();
    state.currentTopic = 'newborn care';
    const result = extractPrimaryTopic(
      'what is Outbreak Preparedness and Response',
      ['tb', 'newborn care', 'outbreak preparedness'],
      state,
      COVERAGE,
      0.4
    );
    expect(result).toBe('outbreak preparedness');
  });

  // Priority 2: falls back to chunk.topics[0] when query has no topic

  it('falls back to chunk.topics[0] when query has no known topic and score > 0.6', () => {
    const state = new SessionState();
    const result = extractPrimaryTopic(
      'what are the danger signs?',
      ['malaria', 'fever'],
      state,
      COVERAGE,
      0.8
    );
    expect(result).toBe('malaria');
  });

  it('falls back to chunk.topics[0] when no currentTopic exists', () => {
    const state = new SessionState();
    const result = extractPrimaryTopic(
      'random query here',
      ['child health', 'nutrition'],
      state,
      COVERAGE,
      0.3
    );
    expect(result).toBe('child health');
  });

  // Topic does NOT update when fused score < 0.6 and query has no topic signal

  it('keeps currentTopic when fused score < 0.6 and query has no topic signal', () => {
    const state = new SessionState();
    state.currentTopic = 'antenatal care';
    const result = extractPrimaryTopic(
      'what are the danger signs?',
      ['tb', 'infection'],
      state,
      COVERAGE,
      0.3
    );
    expect(result).toBe('antenatal care');
  });

  it('does not use topics[1..n] from chunk when score is weak', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    const result = extractPrimaryTopic(
      'tell me more details',
      ['neonatal', 'tb', 'malaria'],
      state,
      COVERAGE,
      0.4
    );
    // Should keep "malaria" because the weak match neonatal is not trusted
    expect(result).toBe('malaria');
  });

  // "Outbreak Preparedness and Response" → topic = "outbreak preparedness", not "tb"

  it('resolves "Outbreak Preparedness and Response" correctly, not "tb"', () => {
    const state = new SessionState();
    state.currentTopic = 'antenatal care';
    const result = extractPrimaryTopic(
      'what is Outbreak Preparedness and Response',
      ['tb', 'outbreak preparedness', 'newborn care'],
      state,
      COVERAGE,
      0.5
    );
    expect(result).toBe('outbreak preparedness');
    expect(result).not.toBe('tb');
    expect(result).not.toBe('newborn care');
  });

  // Consecutive weak matches do not overwrite a strong topic (3 fixtures)

  it('consecutive weak match 1: keeps strong topic on first weak hit', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    const r1 = extractPrimaryTopic('what about dosing?', ['tb', 'infection'], state, COVERAGE, 0.3);
    expect(r1).toBe('malaria');
  });

  it('consecutive weak match 2: keeps strong topic on second weak hit', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    // Simulate two consecutive weak matches
    extractPrimaryTopic('what about dosing?', ['tb', 'infection'], state, COVERAGE, 0.3);
    const r2 = extractPrimaryTopic('and the schedule?', ['neonatal', 'feeding'], state, COVERAGE, 0.25);
    expect(r2).toBe('malaria');
  });

  it('consecutive weak match 3: strong match finally shifts topic', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    // Two weak matches should not shift
    extractPrimaryTopic('what about dosing?', ['tb'], state, COVERAGE, 0.3);
    extractPrimaryTopic('and the schedule?', ['neonatal'], state, COVERAGE, 0.25);
    // Now a strong match should shift
    const r3 = extractPrimaryTopic('tell me about newborn care', ['newborn care'], state, COVERAGE, 0.9);
    expect(r3).toBe('newborn care');
  });
});
