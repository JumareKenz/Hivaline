/**
 * searchEngine.test.ts — Hybrid search (BM25 + Vector + RRF) tests
 */

import { describe, it, expect } from 'vitest';
import { bm25Search, vectorSearch, rrfFuse, hybridSearch } from '@/services/searchEngine';
import type { HIVFile, HIVManifest, HIVChunk } from '@/types/hiv';

function makeHIVFile(chunks: HIVChunk[], lexicalIndex: HIVFile['lexicalIndex'], embeddings?: Int8Array[]): HIVFile {
  const manifest: HIVManifest = {
    version: '1.0.0',
    sha256: 'abc',
    size_kb: 1,
    languages: ['en'],
    chunk_count: chunks.length,
    created_at: '2024-01-01',
    search_config: {
      bm25_weight: 0.4,
      vector_weight: 0.6,
      fusion: 'RRF',
      rrf_k: 60,
      type_boost: {
        faq: 0.9,
        drug_table: 1.3,
        decision_tree: 1.2,
        protocol: 1.0,
        danger_sign: 1.5,
        calculator: 1.0,
      },
    },
  };

  const resolvedEmbeddings = embeddings ?? [];
  return {
    manifest,
    chunks,
    embeddings: resolvedEmbeddings,
    embeddingMeta: resolvedEmbeddings.map((_, i) => ({
      chunk_id: chunks[i % chunks.length]?.id ?? 'unknown',
      variant_type: 'primary',
      variant_index: 0,
      text: '',
    })),
    lexicalIndex,
    sources: { sources: [] },
    rules: {},
    i18n: {},
  };
}

describe('bm25Search', () => {
  it('finds exact term matches', () => {
    const chunks: HIVChunk[] = [
      { id: 'c1', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'A' }, checksum: '' },
    ];
    const index = {
      en: {
        index: {
          malaria: [{ chunk_id: 'c1', score: 1.5 }],
        },
      },
    };
    const hiv = makeHIVFile(chunks, index);
    const results = bm25Search('malaria', hiv, 'en');

    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe('c1');
  });

  it('returns empty for unknown terms', () => {
    const hiv = makeHIVFile([], { en: { index: {} } });
    const results = bm25Search('covid', hiv, 'en');
    expect(results).toHaveLength(0);
  });

  it('filters terms shorter than 3 chars', () => {
    const chunks: HIVChunk[] = [
      { id: 'c1', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'A' }, checksum: '' },
    ];
    const index = {
      en: {
        index: {
          art: [{ chunk_id: 'c1', score: 1.0 }],
        },
      },
    };
    const hiv = makeHIVFile(chunks, index);
    const results = bm25Search('art', hiv, 'en');
    expect(results).toHaveLength(1);

    const resultsShort = bm25Search('a', hiv, 'en');
    expect(resultsShort).toHaveLength(0);
  });
});

describe('vectorSearch', () => {
  it('computes cosine similarity', () => {
    // Two 3-dim vectors, one matches query [1,0,0], other is orthogonal
    const emb1 = new Int8Array([127, 0, 0]); // [1, 0, 0] when dequantized
    const emb2 = new Int8Array([0, 127, 0]); // [0, 1, 0]

    const chunks: HIVChunk[] = [
      { id: 'c1', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'A' }, checksum: '' },
      { id: 'c2', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'B' }, checksum: '' },
    ];

    const hiv = makeHIVFile(chunks, { en: { index: {} } }, [emb1, emb2]);
    const query = new Float32Array([1, 0, 0]);
    const results = vectorSearch(query, hiv);

    expect(results[0].chunk_id).toBe('c1');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns empty when no embeddings', () => {
    const hiv = makeHIVFile([], { en: { index: {} } });
    const results = vectorSearch(new Float32Array([1, 0, 0]), hiv);
    expect(results).toHaveLength(0);
  });
});

describe('rrfFuse', () => {
  it('boosts danger_sign type', () => {
    const chunks: HIVChunk[] = [
      { id: 'c1', type: 'danger_sign', trigger_phrases: {}, content: {}, source: { document: 'A' }, checksum: '' },
      { id: 'c2', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'B' }, checksum: '' },
    ];
    const hiv = makeHIVFile(chunks, { en: { index: {} } });

    const bm25 = [{ chunk_id: 'c2', score: 2.0 }];
    const vector = [{ chunk_id: 'c1', score: 1.0 }];

    const fused = rrfFuse(bm25, vector, hiv.manifest, hiv.chunks);

    // c1 gets danger_sign boost (1.5x), c2 gets faq boost (0.9x)
    expect(fused[0].chunk_id).toBe('c1');
  });
});

describe('hybridSearch', () => {
  it('returns topK chunks sorted by fused score', () => {
    const chunks: HIVChunk[] = [
      { id: 'c1', type: 'faq', trigger_phrases: {}, content: {}, source: { document: 'A' }, checksum: '' },
      { id: 'c2', type: 'drug_table', trigger_phrases: {}, content: {}, source: { document: 'B' }, checksum: '' },
    ];
    const index = {
      en: {
        index: {
          malaria: [
            { chunk_id: 'c1', score: 1.0 },
            { chunk_id: 'c2', score: 2.0 },
          ],
        },
      },
    };

    const hiv = makeHIVFile(chunks, index);
    const results = hybridSearch('malaria', null, hiv, 'en', 2);

    expect(results).toHaveLength(2);
    // c2 has higher BM25 score (2.0 vs 1.0) and drug_table boost (1.3)
    expect(results[0].id).toBe('c2');
  });
});
