/**
 * modelManager.test.ts — FIX 2: deferred model warm-up state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let loaded = false;
const getEmbeddingModel = vi.fn();

vi.mock('@/services/embeddingModel', () => ({
  getEmbeddingModel: (...args: unknown[]) => getEmbeddingModel(...args),
  isModelLoaded: () => loaded,
}));

import {
  warmupEmbeddingModel,
  getModelState,
  isEmbeddingModelReady,
  subscribeModelState,
  __resetModelManager,
} from '@/services/modelManager';

beforeEach(() => {
  loaded = false;
  getEmbeddingModel.mockReset();
  __resetModelManager();
});

describe('modelManager', () => {
  it('starts idle and not ready', () => {
    expect(getModelState().status).toBe('idle');
    expect(isEmbeddingModelReady()).toBe(false);
  });

  it('transitions downloading → ready on successful warm-up', async () => {
    const seen: string[] = [];
    subscribeModelState((s) => seen.push(s.status));

    getEmbeddingModel.mockImplementation(async (onProgress?: (p: unknown) => void) => {
      onProgress?.({ status: 'progress', progress: 50 });
      loaded = true;
      return {};
    });

    await warmupEmbeddingModel();

    expect(getModelState().status).toBe('ready');
    expect(isEmbeddingModelReady()).toBe(true);
    expect(seen).toContain('downloading');
    expect(seen).toContain('ready');
  });

  it('transitions to unavailable when warm-up fails (offline), allowing retry', async () => {
    getEmbeddingModel.mockRejectedValueOnce(new Error('offline'));
    await warmupEmbeddingModel();
    expect(getModelState().status).toBe('unavailable');
    expect(isEmbeddingModelReady()).toBe(false);

    // Retry succeeds once connectivity returns.
    getEmbeddingModel.mockImplementationOnce(async () => { loaded = true; return {}; });
    await warmupEmbeddingModel();
    expect(getModelState().status).toBe('ready');
  });

  it('is idempotent once ready (no second download)', async () => {
    getEmbeddingModel.mockImplementation(async () => { loaded = true; return {}; });
    await warmupEmbeddingModel();
    await warmupEmbeddingModel();
    expect(getEmbeddingModel).toHaveBeenCalledTimes(1);
  });
});
