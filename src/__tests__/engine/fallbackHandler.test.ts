/**
 * fallbackHandler.test.ts — Coverage-aware fallback unit tests
 */

import { describe, it, expect } from 'vitest';
import { buildFallback } from '@/engine/fallbackHandler';
import SessionState from '@/engine/sessionState';

describe('buildFallback', () => {
  it('returns topic-found-aspect-missing message', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    state.markAspectsCovered(['definition']);

    const coverageManifest = {
      topics: {
        malaria: {
          aspects_covered: ['definition', 'dosage', 'referral'],
        },
      },
    };

    const result = buildFallback('malaria dosage', state, coverageManifest);
    expect(result).toContain('I have information on malaria');
    expect(result).toContain('dosage');
    expect(result).not.toContain('.hiv');
    expect(result).not.toContain('chunk');
  });

  it('returns topic-not-found with closest suggestion', () => {
    const state = new SessionState();
    const coverageManifest = {
      topics: {
        malaria: { aspects_covered: ['definition'] },
        pneumonia: { aspects_covered: ['definition'] },
      },
    };

    const result = buildFallback('maleria treatment', state, coverageManifest);
    expect(result).toContain("I don't have information on");
    expect(result).toContain('malaria');
    expect(result).not.toContain('.hiv');
  });

  it('returns generic fallback when no topics exist', () => {
    const state = new SessionState();
    const result = buildFallback('something random', state, { topics: {} });
    expect(result).toContain("I don't have information on that");
    expect(result).not.toContain('.hiv');
  });

  it('never mentions file names or internal IDs', () => {
    const state = new SessionState();
    const coverageManifest = {
      topics: {
        malaria: { aspects_covered: ['definition'] },
      },
    };

    const result = buildFallback('random query', state, coverageManifest);
    expect(result).not.toMatch(/\.hiv/i);
    expect(result).not.toMatch(/chunk/i);
    expect(result).not.toMatch(/artifact/i);
    expect(result).not.toMatch(/index/i);
  });

  it('always ends with an actionable suggestion or question', () => {
    const state = new SessionState();
    const coverageManifest = {
      topics: {
        malaria: { aspects_covered: ['definition'] },
      },
    };

    const result = buildFallback('malaria', state, coverageManifest);
    expect(result).toMatch(/\?$/);
  });
});
