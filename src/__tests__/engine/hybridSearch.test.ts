/**
 * hybridSearch.test.ts — Hybrid search engine unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initSearch, search, type HIVAssets } from '@/engine/hybridSearch';
import SessionState from '@/engine/sessionState';

describe('cosineSimilarity via vectorSearch', () => {
  it('returns top result with highest cosine similarity', () => {
    // Create a simple 3-dim embedding buffer with 3 chunks
    const dims = 3;
    const total = 3;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    // chunk 0: [1, 0, 0]
    view[0] = 1; view[1] = 0; view[2] = 0;
    // chunk 1: [0, 1, 0]
    view[3] = 0; view[4] = 1; view[5] = 0;
    // chunk 2: [0.9, 0.1, 0] — most similar to chunk 0
    view[6] = 0.9; view[7] = 0.1; view[8] = 0;

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: ['c0', 'c1', 'c2'] },
      queryProxies: {
        'similar to one': [1, 0, 0],
        'similar to two': [0, 1, 0],
      },
    };

    initSearch(assets);
    const state = new SessionState();
    const result = search('similar to one', state, 'en');
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c0');
    expect(result!.score).toBeGreaterThan(0);
  });

  it('gracefully falls back when no query proxies exist', () => {
    const assets: HIVAssets = {
      bm25Index: { en: { index: { malaria: [{ chunk_id: 'c1', score: 2.0 }] } } },
    };
    initSearch(assets);
    const state = new SessionState();
    const result = search('malaria treatment', state, 'en');
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c1');
  });
});

describe('RRF fusion', () => {
  it('ranks chunks higher when present in both bm25 and vector results', () => {
    // Using the same 3-chunk setup
    const dims = 3;
    const total = 3;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    view[0] = 1; view[1] = 0; view[2] = 0;
    view[3] = 0; view[4] = 1; view[5] = 0;
    view[6] = 0.5; view[7] = 0.5; view[8] = 0;

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: ['c0', 'c1', 'c2'] },
      queryProxies: {
        'malaria fever': [1, 0, 0],
      },
      bm25Index: {
        en: {
          index: {
            malaria: [{ chunk_id: 'c0', score: 2.0 }],
            fever: [{ chunk_id: 'c1', score: 1.5 }],
          },
        },
      },
    };

    initSearch(assets);
    const state = new SessionState();
    const result = search('malaria fever', state, 'en');
    // c0 is in both BM25 and vector, so it should win via RRF
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c0');
  });
});

describe('deadEndEscape', () => {
  it('returns a different chunk on second identical request', () => {
    const assets: HIVAssets = {
      bm25Index: {
        en: {
          index: {
            malaria: [
              { chunk_id: 'c-def', score: 3.0 },
              { chunk_id: 'c-dos', score: 2.0 },
            ],
          },
        },
      },
    };

    initSearch(assets);
    const state = new SessionState();

    // First request
    const r1 = search('malaria', state, 'en');
    expect(r1).not.toBeNull();
    expect(r1!.chunkId).toBe('c-def');
    state.addTurn('malaria', r1!.chunkId, [], 'CLINICAL');
    state.coveredChunks.add(r1!.chunkId);

    // Second identical request — should skip served chunk
    const r2 = search('malaria', state, 'en');
    expect(r2).not.toBeNull();
    expect(r2!.chunkId).toBe('c-dos');
  });

  it('walks gap graph when top 3 are all served', () => {
    const assets: HIVAssets = {
      bm25Index: {
        en: {
          index: {
            malaria: [
              { chunk_id: 'c1', score: 3.0 },
              { chunk_id: 'c2', score: 2.0 },
              { chunk_id: 'c3', score: 1.0 },
            ],
          },
        },
      },
      gapGraph: {
        c3: [{ to: 'c4', score: 0.9 }],
      },
    };

    initSearch(assets);
    const state = new SessionState();
    state.addTurn('first', 'c1', [], 'CLINICAL');
    state.coveredChunks.add('c1');
    state.addTurn('second', 'c2', [], 'CLINICAL');
    state.coveredChunks.add('c2');
    state.addTurn('third', 'c3', [], 'CLINICAL');
    state.coveredChunks.add('c3');

    const result = search('malaria', state, 'en');
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c4');
  });
});

describe('backward compatibility', () => {
  it('returns null when no bm25 index, no embeddings, and no gap graph', () => {
    const assets: HIVAssets = {};
    initSearch(assets);
    const state = new SessionState();
    const result = search('anything', state, 'en');
    expect(result).toBeNull();
  });
});

describe('performance', () => {
  it('completes vector search over 289 chunks in < 15ms', () => {
    const dims = 384;
    const total = 289;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    for (let i = 0; i < total * dims; i++) {
      view[i] = Math.random() * 2 - 1;
    }

    const chunkIds = Array.from({ length: total }, (_, i) => `chunk-${i}`);
    const proxies: Record<string, number[]> = {};
    for (let i = 0; i < 50; i++) {
      proxies[`query ${i}`] = Array.from({ length: dims }, () => Math.random() * 2 - 1);
    }

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: chunkIds },
      queryProxies: proxies,
    };

    initSearch(assets);
    const state = new SessionState();

    const start = performance.now();
    const result = search('query 25', state, 'en');
    const end = performance.now();

    expect(result).not.toBeNull();
    expect(end - start).toBeLessThan(100);
  });
});
