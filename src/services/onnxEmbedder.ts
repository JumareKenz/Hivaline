/**
 * onnxEmbedder.ts — ONNX Runtime Web query embedding service
 *
 * Loads a paraphrase-multilingual-MiniLM-L12-v2 ONNX model
 * and produces 384-dim float32 query embeddings.
 *
 * If the model is unavailable, falls back gracefully to BM25-only.
 */

import type * as ort from 'onnxruntime-web';

let ortModule: typeof ort | null = null;
let session: ort.InferenceSession | null = null;
let isLoading = false;
let loadError: string | null = null;

const MODEL_URL = './models/paraphrase-multilingual-MiniLM-L12-v2.onnx';

export interface EmbedderState {
  isAvailable: boolean;
  isLoading: boolean;
  error: string | null;
}

export function getEmbedderState(): EmbedderState {
  return {
    isAvailable: session !== null,
    isLoading,
    error: loadError,
  };
}

async function loadORT(): Promise<typeof ort> {
  if (ortModule) return ortModule;
  ortModule = await import('onnxruntime-web');
  return ortModule;
}

/**
 * Initialize the ONNX embedding model.
 * Call once on app startup or before first vector search.
 */
export async function initEmbedder(): Promise<void> {
  if (session) return;
  if (isLoading) {
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  isLoading = true;
  loadError = null;

  try {
    const ort = await loadORT();
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;

    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'ONNX model failed to load';
    session = null;
  } finally {
    isLoading = false;
  }
}

/**
 * Embed a query string into a 384-dim float32 vector.
 * Returns null if the model is not loaded.
 */
export async function embedQuery(query: string): Promise<Float32Array | null> {
  if (!session) {
    await initEmbedder();
    if (!session) return null;
  }

  try {
    const ort = await loadORT();
    const tokens = tokenize(query);
    const inputIds = new BigInt64Array(tokens.map((n) => BigInt(n)));
    const attentionMask = new BigInt64Array(tokens.map(() => 1n));

    const inputTensor = new ort.Tensor('int64', inputIds, [1, tokens.length]);
    const maskTensor = new ort.Tensor('int64', attentionMask, [1, tokens.length]);

    const results = await session.run({
      input_ids: inputTensor,
      attention_mask: maskTensor,
    });

    const output = results.sentence_embedding as ort.Tensor;
    if (!output || !output.data) return null;

    const data = output.data as Float32Array;
    return normalizeVector(new Float32Array(data));
  } catch (err) {
    return null;
  }
}

/* ─── Helpers ─── */

/**
 * Very simple word-piece tokenizer stub.
 * In production, use the model's real tokenizer (e.g. via Transformers.js
 * or a bundled tokenizer.json).
 */
function tokenize(text: string): number[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  // Simple word-to-id mapping: just use char code sums as stable ids
  // This is a STUB — replace with real tokenizer for production accuracy
  return words.map((w) => w.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 30000);
}

function normalizeVector(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-10) return vec;
  for (let i = 0; i < vec.length; i++) {
    vec[i] /= norm;
  }
  return vec;
}
