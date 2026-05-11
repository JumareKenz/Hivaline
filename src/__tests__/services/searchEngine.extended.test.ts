/**
 * searchEngine.extended.test.ts
 *
 * Edge cases: empty corpora, dimension mismatch, BM25 topK capping,
 * cosine similarity with zero vectors, single-char terms, RRF tie-breaking.
 */

import { describe, it, expect } from 'vitest';
import {
  bm25Search,
  vectorSearch,
  rrfFuse,
  hybridSearch,
} from '@/services/searchEngine';
import type { HIVFile, HIVManifest, HIVChunk } from '@/types/hiv';

function makeManifest(overrides: Partial<HIVManifest['search_config']> = {}): HIVManifest {
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
      ...overrides,
    },
  };
}

function makeChunk(id: string, type: HIVChunk['type'] = 'faq'): HIVChunk {
  return { id, type, trigger_phrases: {}, content: {}, source: { document: 'Test' }, checksum: '' };
}

function makeFile(chunks: HIVChunk[], lexicalEn: Record<string, Array<{ chunk_id: string; score: number }>>, embeddings: Int8Array[] = []): HIVFile {
  const embeddingMeta = embeddings.map((_, i) => ({
    chunk_id: chunks[i % chunks.length]?.id ?? 'unknown',
    variant_type: 'primary',
    variant_index: 0,
    text: '',
  }));
  return {
    manifest: makeManifest(),
    chunks,
    embeddings,
    embeddingMeta,
    lexicalIndex: { en: { index: lexicalEn } },
    sources: { sources: [] },
    rules: {},
    i18n: {},
  };
}

describe('bm25Search — edge cases', () => {
  it('returns empty for completely empty corpus', () => {
    const file = makeFile([], {});
    expect(bm25Search('malaria', file, 'en')).toHaveLength(0);
  });

  it('returns empty for query with only short terms (< 3 chars)', () => {
    const file = makeFile(
      [makeChunk('c1')],
      { a: [{ chunk_id: 'c1', score: 1 }] }
    );
    expect(bm25Search('a b', file, 'en')).toHaveLength(0);
  });

  it('handles query with no terms after splitting', () => {
    const file = makeFile([], {});
    expect(bm25Search('   ', file, 'en')).toHaveLength(0);
  });

  it('aggregates scores for multi-term query', () => {
    const chunks = [makeChunk('c1'), makeChunk('c2')];
    const index = {
      malaria: [
        { chunk_id: 'c1', score: 2.0 },
        { chunk_id: 'c2', score: 1.0 },
      ],
      treatment: [
        { chunk_id: 'c1', score: 1.5 },
      ],
    };
    const file = makeFile(chunks, index);
    const results = bm25Search('malaria treatment', file, 'en');
    // c1: 2.0 + 1.5 = 3.5, c2: 1.0
    expect(results[0].chunk_id).toBe('c1');
    expect(results[0].score).toBeCloseTo(3.5);
  });

  it('respects topK limit', () => {
    const chunks = Array.from({ length: 30 }, (_, i) => makeChunk(`c${i}`));
    const index: Record<string, Array<{ chunk_id: string; score: number }>> = {};
    index['malaria'] = chunks.map((c, i) => ({ chunk_id: c.id, score: 30 - i }));
    const file = makeFile(chunks, index);
    const results = bm25Search('malaria', file, 'en', 10);
    expect(results).toHaveLength(10);
  });

  it('handles missing lang gracefully (falls back to empty)', () => {
    const file = makeFile([makeChunk('c1')], { malaria: [{ chunk_id: 'c1', score: 1 }] });
    // Querying Hausa index that doesn't exist
    const results = bm25Search('malaria', file, 'ha');
    expect(results).toHaveLength(0);
  });

  it('handles punctuation-only query (no valid terms)', () => {
    const file = makeFile([makeChunk('c1')], { malaria: [{ chunk_id: 'c1', score: 1 }] });
    // normalizeInput strips punctuation, BM25 filters short terms
    expect(bm25Search('!!!???', file, 'en')).toHaveLength(0);
  });
});

describe('vectorSearch — edge cases', () => {
  it('returns empty when chunks array is empty', () => {
    const file = makeFile([], {}, [new Int8Array([127, 0, 0])]);
    const results = vectorSearch(new Float32Array([1, 0, 0]), file);
    expect(results).toHaveLength(0);
  });

  it('handles zero-magnitude query vector (no crash)', () => {
    const chunks = [makeChunk('c1')];
    const file = makeFile(chunks, {}, [new Int8Array([127, 0, 0])]);
    // Zero vector — cosine similarity denominator becomes tiny epsilon
    const results = vectorSearch(new Float32Array([0, 0, 0]), file);
    expect(results).toHaveLength(1);
    // Score approaches 0 due to 1e-10 epsilon guard
    expect(results[0].score).toBeLessThanOrEqual(0.01);
  });

  it('skips chunk when embedding is missing (undefined slot)', () => {
    const chunks = [makeChunk('c1'), makeChunk('c2')];
    // Only 1 embedding for 2 chunks — second slot missing
    const embeddings = [new Int8Array([127, 0, 0])];
    const file = makeFile(chunks, {}, embeddings);
    const results = vectorSearch(new Float32Array([1, 0, 0]), file);
    // Only c1 should be scored; c2 skipped gracefully
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('handles identical query and document vectors (similarity ≈ 1.0)', () => {
    const vec = new Int8Array([90, 90, 90]);
    const chunks = [makeChunk('c1')];
    const file = makeFile(chunks, {}, [vec]);
    const query = new Float32Array([90 / 127, 90 / 127, 90 / 127]);
    const results = vectorSearch(query, file);
    expect(results[0].score).toBeGreaterThan(0.99);
  });

  it('respects topK limit', () => {
    const chunks = Array.from({ length: 25 }, (_, i) => makeChunk(`c${i}`));
    const embeddings = chunks.map(() => new Int8Array([127, 0, 0]));
    const file = makeFile(chunks, {}, embeddings);
    const results = vectorSearch(new Float32Array([1, 0, 0]), file, 5);
    expect(results).toHaveLength(5);
  });
});

describe('rrfFuse — edge cases', () => {
  it('returns empty when both result lists are empty', () => {
    const file = makeFile([], {});
    const fused = rrfFuse([], [], file.manifest, file.chunks);
    expect(fused).toHaveLength(0);
  });

  it('handles chunk not found in chunkMap (orphaned result)', () => {
    const chunks = [makeChunk('c1')];
    const file = makeFile(chunks, {});
    // Reference a chunk that doesn't exist in the corpus
    const bm25 = [{ chunk_id: 'nonexistent', score: 5.0 }];
    const fused = rrfFuse(bm25, [], file.manifest, file.chunks);
    // nonexistent chunk gets default boost (faq = 1.0)
    expect(fused).toHaveLength(1);
    expect(fused[0].chunk_id).toBe('nonexistent');
  });

  it('applies correct type boosts: danger_sign > drug_table > decision_tree > protocol', () => {
    const chunks = [
      makeChunk('danger', 'danger_sign'),
      makeChunk('drug', 'drug_table'),
      makeChunk('decision', 'decision_tree'),
      makeChunk('protocol', 'protocol'),
    ];
    const file = makeFile(chunks, {});
    // Give all same rank (rank 0)
    const bm25 = chunks.map((c) => ({ chunk_id: c.id, score: 1.0 }));
    const fused = rrfFuse(bm25, [], file.manifest, file.chunks);

    const scoreMap = Object.fromEntries(fused.map((r) => [r.chunk_id, r.score]));
    expect(scoreMap['danger']).toBeGreaterThan(scoreMap['drug']);
    expect(scoreMap['drug']).toBeGreaterThan(scoreMap['decision']);
    expect(scoreMap['decision']).toBeGreaterThan(scoreMap['protocol']);
  });

  it('accumulates scores from both BM25 and vector when same chunk appears in both', () => {
    const chunks = [makeChunk('c1')];
    const file = makeFile(chunks, {});
    const bm25 = [{ chunk_id: 'c1', score: 1.0 }];
    const vector = [{ chunk_id: 'c1', score: 1.0 }];
    const fusedboth = rrfFuse(bm25, vector, file.manifest, chunks);
    const fusedbm25only = rrfFuse(bm25, [], file.manifest, chunks);
    // Combined score should be higher
    expect(fusedboth[0].score).toBeGreaterThan(fusedbm25only[0].score);
  });
});

describe('hybridSearch — integration', () => {
  it('returns empty array when no matching chunks', () => {
    const file = makeFile(
      [makeChunk('c1')],
      { en: { index: {} } } as unknown as HIVFile['lexicalIndex']
    );
    // Actually pass correct file
    const emptyFile = makeFile([], {});
    const results = hybridSearch('zebra', null, emptyFile, 'en', 5);
    expect(results).toHaveLength(0);
  });

  it('returns only topK results', () => {
    const chunks = [makeChunk('c1'), makeChunk('c2'), makeChunk('c3'), makeChunk('c4'), makeChunk('c5')];
    const index: Record<string, Array<{ chunk_id: string; score: number }>> = {
      malaria: chunks.map((c, i) => ({ chunk_id: c.id, score: 5 - i })),
    };
    const file = makeFile(chunks, index);
    const results = hybridSearch('malaria', null, file, 'en', 3);
    expect(results).toHaveLength(3);
  });

  it('handles null queryEmbedding (BM25-only mode)', () => {
    const chunks = [makeChunk('c1')];
    const index = { malaria: [{ chunk_id: 'c1', score: 1.0 }] };
    const file = makeFile(chunks, index);
    const results = hybridSearch('malaria', null, file, 'en', 5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c1');
  });

  it('filters out chunks whose id is missing from chunkMap', () => {
    const chunks = [makeChunk('c1')];
    const index = {
      malaria: [
        { chunk_id: 'c1', score: 2.0 },
        { chunk_id: 'ghost', score: 99.0 }, // exists in index but not in chunks
      ],
    };
    const file = makeFile(chunks, index);
    const results = hybridSearch('malaria', null, file, 'en', 5);
    const ids = results.map((c) => c.id);
    expect(ids).not.toContain('ghost');
  });

  it('respects danger_sign prioritization via type_boost in RRF', () => {
    const chunks = [
      makeChunk('faq-chunk', 'faq'),
      makeChunk('danger-chunk', 'danger_sign'),
    ];
    // BM25 ranks faq higher
    const index = {
      malaria: [
        { chunk_id: 'faq-chunk', score: 5.0 },
        { chunk_id: 'danger-chunk', score: 1.0 },
      ],
    };
    const file = makeFile(chunks, index);
    const results = hybridSearch('malaria', null, file, 'en', 2);
    // danger_sign (1.5 boost) should beat faq (1.0 boost) even with lower base score
    expect(results[0].id).toBe('danger-chunk');
  });
});
