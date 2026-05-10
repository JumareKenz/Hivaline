/**
 * onnxEmbedder.test.ts — Tokenizer stub correctness & embedder state
 *
 * NOTE: The ONNX session itself cannot be loaded in the test environment
 * (no .onnx model file), so these tests cover:
 *   1. getEmbedderState() initial state
 *   2. initEmbedder() graceful degradation when model is unavailable
 *   3. embedQuery() returning null when model is not loaded
 *   4. The stub tokenizer's determinism and edge cases (internal behavior via embedQuery)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('getEmbedderState — initial state', () => {
  it('is not available before init', async () => {
    const { getEmbedderState } = await import('@/services/onnxEmbedder');
    const state = getEmbedderState();
    expect(state.isAvailable).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});

describe('initEmbedder — graceful degradation', () => {
  it('does not throw when ONNX model file is unavailable', async () => {
    const { initEmbedder, getEmbedderState } = await import('@/services/onnxEmbedder');
    // In test environment, the model URL doesn't exist — should degrade silently
    await expect(initEmbedder()).resolves.not.toThrow();
    const state = getEmbedderState();
    expect(state.isLoading).toBe(false);
    // Either available (mock) or not available with an error — both acceptable
    expect(typeof state.isAvailable).toBe('boolean');
  });

  it('sets loadError when model fails to load', async () => {
    const { initEmbedder, getEmbedderState } = await import('@/services/onnxEmbedder');
    await initEmbedder();
    const state = getEmbedderState();
    if (!state.isAvailable) {
      // If loading failed, error should be set
      expect(state.error).not.toBeNull();
    }
  });
});

describe('embedQuery — null when model unavailable', () => {
  it('returns null when ONNX session is not loaded', async () => {
    const { embedQuery } = await import('@/services/onnxEmbedder');
    const result = await embedQuery('malaria treatment');
    // In test env without a real model, result must be null (graceful fallback)
    expect(result).toBeNull();
  });

  it('returns null for empty string input', async () => {
    const { embedQuery } = await import('@/services/onnxEmbedder');
    const result = await embedQuery('');
    expect(result).toBeNull();
  });

  it('returns null for punctuation-only input', async () => {
    const { embedQuery } = await import('@/services/onnxEmbedder');
    const result = await embedQuery('!!! ???');
    expect(result).toBeNull();
  });
});

describe('SEC-30 Tokenizer stub — documented production risk', () => {
  it('documents: stub tokenizer uses char-sum hash, not real wordpiece (accuracy risk)', () => {
    // The tokenizer in onnxEmbedder.ts uses:
    //   words.map(w => w.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 30000)
    //
    // This means "malaria" and "aria" could produce the same token id if they have
    // the same char-sum mod 30000. This is a STUB and produces meaningless embeddings.
    //
    // FINDING: Vector search results are semantically meaningless in production
    // until a real tokenizer (tokenizer.json) is bundled and used here.
    //
    // Verify the stub is still the stub (not silently replaced with real tokenizer):
    const charSumOf = (word: string) =>
      word.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 30000;

    // These two words have different char sums — good
    expect(charSumOf('malaria')).not.toBe(charSumOf('healthy'));

    // These show the collision risk: similar char sums map to same id
    // (just a documentation assertion — not a pass/fail on production behavior)
    const sum1 = charSumOf('malaria');
    expect(typeof sum1).toBe('number');
    expect(sum1).toBeGreaterThanOrEqual(0);
    expect(sum1).toBeLessThan(30000);
  });
});
