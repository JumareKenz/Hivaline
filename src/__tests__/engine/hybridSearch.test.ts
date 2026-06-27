/**
 * hybridSearch.test.ts — Vector-only search engine unit tests
 */

import { describe, it, expect } from 'vitest';
import { initSearch, search, type HIVAssets } from '@/engine/hybridSearch';
import SessionState from '@/engine/sessionState';

describe('cosineSimilarity via vectorSearch', () => {
  it('returns top result with highest cosine similarity', async () => {
    const dims = 3;
    const total = 3;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    view[0] = 1; view[1] = 0; view[2] = 0;
    view[3] = 0; view[4] = 1; view[5] = 0;
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
    const result = await search('similar to one', state, 'en');
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c0');
    expect(result!.score).toBeGreaterThan(0);
  });

  it('returns null when no proxies and no variant embeddings exist', async () => {
    const assets: HIVAssets = {};
    initSearch(assets);
    const state = new SessionState();
    const result = await search('malaria treatment', state, 'en');
    expect(result).toBeNull();
  });
});

describe('deadEndEscape', () => {
  it('returns a different chunk on second identical request', async () => {
    const dims = 3;
    const total = 2;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    view[0] = 1; view[1] = 0; view[2] = 0;
    view[3] = 0.9; view[4] = 0.1; view[5] = 0;

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: ['c-def', 'c-dos'] },
      queryProxies: { 'malaria': [1, 0, 0] },
    };

    initSearch(assets);
    const state = new SessionState();

    const r1 = await search('malaria', state, 'en');
    expect(r1).not.toBeNull();
    expect(r1!.chunkId).toBe('c-def');
    state.addTurn('malaria', r1!.chunkId, [], 'CLINICAL');
    state.coveredChunks.add(r1!.chunkId);

    const r2 = await search('malaria', state, 'en');
    expect(r2).not.toBeNull();
    expect(r2!.chunkId).toBe('c-dos');
  });

  it('walks gap graph when top results are all served', async () => {
    const dims = 3;
    const total = 3;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    view[0] = 1; view[1] = 0; view[2] = 0;
    view[3] = 0.9; view[4] = 0.1; view[5] = 0;
    view[6] = 0.8; view[7] = 0.2; view[8] = 0;

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: ['c1', 'c2', 'c3'] },
      queryProxies: { 'malaria': [1, 0, 0] },
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

    const result = await search('malaria', state, 'en');
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('c4');
  });
});

describe('backward compatibility', () => {
  it('returns null when no embeddings and no gap graph', async () => {
    const assets: HIVAssets = {};
    initSearch(assets);
    const state = new SessionState();
    const result = await search('anything', state, 'en');
    expect(result).toBeNull();
  });
});

describe('performance', () => {
  it('completes vector search over 289 chunks in < 100ms', async () => {
    const dims = 384;
    const total = 289;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    for (let i = 0; i < total * dims; i++) {
      view[i] = Math.random() * 2 - 1;
    }

    // Ensure chunk-25 has a strong match with its proxy (unit vector in first dim)
    const targetProxy = new Array(dims).fill(0);
    targetProxy[0] = 1;
    for (let j = 0; j < dims; j++) {
      view[25 * dims + j] = targetProxy[j];
    }

    const chunkIds = Array.from({ length: total }, (_, i) => `chunk-${i}`);
    const proxies: Record<string, number[]> = {};
    for (let i = 0; i < 50; i++) {
      proxies[`query ${i}`] = i === 25
        ? targetProxy
        : Array.from({ length: dims }, () => Math.random() * 2 - 1);
    }

    const assets: HIVAssets = {
      embeddingsBuffer: buffer,
      embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: chunkIds },
      queryProxies: proxies,
    };

    initSearch(assets);
    const state = new SessionState();

    const start = performance.now();
    const result = await search('query 25', state, 'en');
    const end = performance.now();

    expect(result).not.toBeNull();
    expect(end - start).toBeLessThan(100);
  });
});
