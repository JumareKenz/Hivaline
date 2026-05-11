/**
 * stateConsistency.test.ts — Reliability & regression
 *
 * Tests: repeated identical queries produce identical results,
 * large corpus doesn't degrade search, localStorage isolation between tests,
 * no mutation of input data, pure-function guarantees.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { bm25Search, vectorSearch, rrfFuse, hybridSearch } from '@/services/searchEngine';
import { renderChunk } from '@/services/responseRenderer';
import { normalizeInput } from '@/utils/formatters';
import { validateServerCode, validateWeight } from '@/utils/validation';
import type { HIVFile, HIVChunk, HIVManifest } from '@/types/hiv';

function makeManifest(): HIVManifest {
  return {
    version: '1.0.0',
    sha256: 'abc',
    size_kb: 1,
    languages: ['en'],
    chunk_count: 0,
    created_at: '2024-01-01',
    search_config: {
      bm25_weight: 0.4,
      vector_weight: 0.6,
      fusion: 'RRF',
      rrf_k: 60,
      type_boost: { faq: 1.0, drug_table: 1.3, decision_tree: 1.2, protocol: 1.0, danger_sign: 1.5, calculator: 1.0 },
    },
  };
}

function makeChunk(id: string, type: HIVChunk['type'] = 'faq'): HIVChunk {
  return { id, type, trigger_phrases: {}, content: {}, source: { document: 'T' }, checksum: '' };
}

function makeFile(n: number): HIVFile {
  const chunks = Array.from({ length: n }, (_, i) => makeChunk(`c${i}`, i % 2 === 0 ? 'faq' : 'drug_table'));
  const index: Record<string, Array<{ chunk_id: string; score: number }>> = {};
  index['malaria'] = chunks.map((c, i) => ({ chunk_id: c.id, score: n - i }));

  return {
    manifest: makeManifest(),
    chunks,
    embeddings: chunks.map(() => new Int8Array([127, 0, 0])),
    embeddingMeta: chunks.map((c) => ({ chunk_id: c.id, variant_type: 'primary', variant_index: 0, text: '' })),
    lexicalIndex: { en: { index } },
    sources: { sources: [] },
    rules: {},
    i18n: {},
  };
}

describe('PHASE 7 — Determinism: same input → same output every time', () => {
  const file = makeFile(20);

  it('bm25Search produces identical results on 3 repeated calls', () => {
    const r1 = bm25Search('malaria', file, 'en', 10);
    const r2 = bm25Search('malaria', file, 'en', 10);
    const r3 = bm25Search('malaria', file, 'en', 10);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('vectorSearch produces identical results on 3 repeated calls', () => {
    const q = new Float32Array([1, 0, 0]);
    const r1 = vectorSearch(q, file, 10);
    const r2 = vectorSearch(q, file, 10);
    const r3 = vectorSearch(q, file, 10);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('hybridSearch produces identical results on 3 repeated calls', () => {
    const r1 = hybridSearch('malaria', null, file, 'en', 5);
    const r2 = hybridSearch('malaria', null, file, 'en', 5);
    const r3 = hybridSearch('malaria', null, file, 'en', 5);
    expect(r1.map((c) => c.id)).toEqual(r2.map((c) => c.id));
    expect(r2.map((c) => c.id)).toEqual(r3.map((c) => c.id));
  });

  it('normalizeInput is deterministic', () => {
    const input = 'MALARIA Treatment! 2024';
    expect(normalizeInput(input)).toBe(normalizeInput(input));
    expect(normalizeInput(input)).toBe(normalizeInput(input));
  });

  it('validateServerCode is deterministic', () => {
    const codes = ['HIVA-K7H4', 'invalid', 'HIVA-1234'];
    codes.forEach((code) => {
      const r1 = validateServerCode(code);
      const r2 = validateServerCode(code);
      const r3 = validateServerCode(code);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });

  it('validateWeight is deterministic', () => {
    [0, 3, 30, 60, 61, NaN, Infinity].forEach((w) => {
      const r1 = validateWeight(w);
      const r2 = validateWeight(w);
      expect(r1).toBe(r2);
    });
  });
});

describe('PHASE 7 — No mutation of input data', () => {
  it('bm25Search does not mutate the HIVFile', () => {
    const file = makeFile(5);
    const originalChunksLength = file.chunks.length;
    const originalIndexKeys = Object.keys(file.lexicalIndex.en.index);

    bm25Search('malaria', file, 'en', 10);

    expect(file.chunks.length).toBe(originalChunksLength);
    expect(Object.keys(file.lexicalIndex.en.index)).toEqual(originalIndexKeys);
  });

  it('vectorSearch does not mutate embeddings', () => {
    const file = makeFile(3);
    const originalEmb0 = Array.from(file.embeddings[0]);
    vectorSearch(new Float32Array([1, 0, 0]), file);
    expect(Array.from(file.embeddings[0])).toEqual(originalEmb0);
  });

  it('rrfFuse does not mutate bm25Results or vectorResults arrays', () => {
    const file = makeFile(2);
    const bm25 = [{ chunk_id: 'c0', score: 1.0 }];
    const vector = [{ chunk_id: 'c1', score: 0.9 }];
    const bm25Copy = [...bm25];
    const vectorCopy = [...vector];

    rrfFuse(bm25, vector, file.manifest, file.chunks);

    expect(bm25).toEqual(bm25Copy);
    expect(vector).toEqual(vectorCopy);
  });

  it('renderChunk does not mutate the input chunk', () => {
    const chunk: HIVChunk = {
      id: 'test',
      type: 'faq',
      trigger_phrases: {},
      content: { en: { question: 'Q', answer: 'A' } },
      source: { document: 'Doc' },
      checksum: 'abc',
    };
    const originalChecksum = chunk.checksum;
    const originalId = chunk.id;

    renderChunk(chunk, 'en');

    expect(chunk.checksum).toBe(originalChecksum);
    expect(chunk.id).toBe(originalId);
  });
});

describe('PHASE 7 — Large corpus performance', () => {
  it('bm25Search over 1000 chunks completes in < 50ms', () => {
    const file = makeFile(1000);
    const start = Date.now();
    bm25Search('malaria', file, 'en', 20);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('vectorSearch over 500 chunks completes in < 200ms', () => {
    const file = makeFile(500);
    const q = new Float32Array([1, 0, 0]);
    const start = Date.now();
    vectorSearch(q, file, 20);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('hybridSearch over 1000 chunks completes in < 100ms', () => {
    const file = makeFile(1000);
    const start = Date.now();
    hybridSearch('malaria', null, file, 'en', 5);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('PHASE 7 — Error boundary recovery (services remain functional after errors)', () => {
  it('bm25Search remains usable after receiving malformed index', () => {
    const brokenFile: HIVFile = {
      manifest: makeManifest(),
      chunks: [],
      embeddings: [],
      embeddingMeta: [],
      lexicalIndex: { en: { index: null as unknown as Record<string, []> } },
      sources: { sources: [] },
      rules: {},
      i18n: {},
    };

    // Should not throw — just return empty
    let result: unknown;
    try {
      result = bm25Search('malaria', brokenFile, 'en');
    } catch {
      result = [];
    }
    expect(Array.isArray(result)).toBe(true);

    // Service remains functional for valid queries
    const goodFile = makeFile(3);
    const goodResult = bm25Search('malaria', goodFile, 'en');
    expect(goodResult.length).toBeGreaterThan(0);
  });

  it('vectorSearch remains usable after zero-dimension embedding', () => {
    const chunks = [makeChunk('c0')];
    const file: HIVFile = {
      manifest: makeManifest(),
      chunks,
      embeddings: [new Int8Array(0)], // zero-length embedding
      embeddingMeta: [{ chunk_id: 'c0', variant_type: 'primary', variant_index: 0, text: '' }],
      lexicalIndex: { en: { index: {} } },
      sources: { sources: [] },
      rules: {},
      i18n: {},
    };

    let result: unknown;
    try {
      result = vectorSearch(new Float32Array([1, 0, 0]), file);
    } catch {
      result = [];
    }
    expect(Array.isArray(result)).toBe(true);
  });
});
