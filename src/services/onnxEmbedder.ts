/**
 * onnxEmbedder.ts — ONNX Runtime Web query embedding service
 *
 * Disabled due to WASM MIME type issues in production.
 * Uses BM25-only search instead.
 */

let isLoading = false;
let loadError: string | null = null;

export interface EmbedderState {
  isAvailable: boolean;
  isLoading: boolean;
  error: string | null;
}

export function getEmbedderState(): EmbedderState {
  return {
    isAvailable: false,
    isLoading,
    error: loadError,
  };
}

/**
 * Initialize the ONNX embedding model.
 * Currently disabled - uses BM25-only mode.
 */
export async function initEmbedder(): Promise<void> {
  if (isLoading) {
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  isLoading = true;
  loadError = null;

  // Skip ONNX entirely - use BM25-only mode to avoid WASM MIME type errors
  loadError = 'BM25-only mode (ONNX disabled)';
  isLoading = false;
}

/**
 * Embed a query string into a 384-dim float32 vector.
 * Returns null - ONNX is disabled, using BM25-only search.
 */
export async function embedQuery(_query: string): Promise<Float32Array | null> {
  return null;
}
