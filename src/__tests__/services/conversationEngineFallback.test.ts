/**
 * conversationEngineFallback.test.ts — FIX 2: conversationEngine.respond() must
 * return a graceful clinical fallback (never reject / freeze the UI) when the
 * search subsystem fails (e.g. an offline embedding error).
 */

import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import type { HIVFile, HIVChunk } from '@/types/hiv';

// Make search reject; keep the rest of hybridSearch intact.
vi.mock('@/engine/hybridSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/hybridSearch')>();
  return {
    ...actual,
    initSearch: vi.fn(),
    search: vi.fn().mockRejectedValue(new Error('search subsystem failed')),
  };
});
// Stop FAQ detectors from short-circuiting before search is reached.
vi.mock('@/engine/appFaqDetector', () => ({ getAppFaqResponse: () => null }));
vi.mock('@/engine/clinicalFaqDetector', () => ({ getClinicalFaqResponse: () => null }));

import { ConversationEngine } from '@/services/conversationEngine';

function makeMinimalHIVFile(): HIVFile {
  const chunk: HIVChunk = {
    id: 'c1',
    type: 'protocol',
    trigger_phrases: { en: ['malaria'] },
    content: { en: { answer: 'Give ACT.' } },
    source: { document: 'FMOH' },
    checksum: 'x',
  };
  return {
    manifest: {
      version: 'test', sha256: 't', size_kb: 1, languages: ['en'], chunk_count: 1,
      created_at: '2026-01-01',
      search_config: { bm25_weight: 1, vector_weight: 0, fusion: 'RRF', rrf_k: 60, type_boost: {} as Record<string, number> },
    },
    chunks: [chunk],
    embeddings: [],
    embeddingMeta: [],
    lexicalIndex: { en: { index: { malaria: [{ chunk_id: 'c1', score: 2 }] } } },
    sources: { sources: [] },
    rules: {},
    i18n: {},
  };
}

describe('conversationEngine.respond — graceful fallback when search throws', () => {
  it('returns a clinical fallback (does not reject/freeze) on search failure', async () => {
    const engine = new ConversationEngine(makeMinimalHIVFile());

    const res = await engine.respond('malaria treatment for a child');

    expect(res).toBeTruthy();
    expect(res.type).toBe('fallback');
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
    expect(res.suggestedFollowUps.length).toBeGreaterThan(0);
  });
});
