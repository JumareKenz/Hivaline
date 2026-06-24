/**
 * embedFallback.test.ts — When embedQuery throws (offline/failure), search
 * returns null (loading state) rather than crashing the pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/embeddingModel', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('offline: model fetch failed')),
  isModelLoaded: () => true,
}));
vi.mock('@/services/modelManager', () => ({
  isEmbeddingModelReady: () => true,
}));

import { search, initSearch, type HIVAssets } from '@/engine/hybridSearch';
import SessionState from '@/engine/sessionState';

describe('hybridSearch — returns null when embedQuery throws', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null (loading gate) when variant embedding fails offline', async () => {
    const dims = 4;
    const assets: HIVAssets = {
      variantEmbeddings: new Float32Array(dims),
      variantEmbeddingsIndex: [
        { chunk_id: 'c1', field_type: 'primary_question', lang: 'en', text: 'malaria' },
      ],
      variantCount: 1,
      embeddingDims: dims,
    };

    initSearch(assets);
    const state = new SessionState();

    const result = await search('malaria treatment', state, 'en', assets);
    expect(result).toBeNull();
  });
});
