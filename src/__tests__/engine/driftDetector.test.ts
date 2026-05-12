/**
 * driftDetector.test.ts — Drift detection unit tests
 */

import { describe, it, expect } from 'vitest';
import { detectDrift } from '@/engine/driftDetector';
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
