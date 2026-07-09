/**
 * nativeRetrieverService.ts — Thin TypeScript wrapper around the NativeRetriever
 * Capacitor plugin (ObjectBox + EmbeddingGemma-300M HNSW retrieval on Android).
 *
 * Feature-flagged via BUILD_USE_NATIVE_RETRIEVER (set in android/app/build.gradle).
 * When false (default), the existing JS hybridSearch path runs unchanged.
 *
 * API contract with the Kotlin plugin:
 *   loadBundle(path)         -> { success: boolean, chunkCount: number, embeddingDims: number }
 *   search(query, topK)      -> { results: NativeSearchResult[] }
 *   isReady()                -> { ready: boolean }
 *   unload()                 -> { success: boolean }
 */

import { registerPlugin } from '@capacitor/core';

export interface NativeSearchResult {
  chunkId: string;
  rawText: string;
  displayTitle: string;
  chunkType: string;
  score: number;
}

export interface NativeLoadResult {
  success: boolean;
  chunkCount: number;
  embeddingDims: number;
}

export interface NativeSearchResponse {
  results: NativeSearchResult[];
}

export interface EmbeddingModelInfo {
  downloaded: boolean;
  path: string;
  sizeMB: number;
}

export interface EmbeddingDownloadResult {
  success: boolean;
  path: string;
  sizeMB: number;
}

interface NativeRetrieverPlugin {
  loadBundle(options: { path: string }): Promise<NativeLoadResult>;
  search(options: { query: string; topK: number }): Promise<NativeSearchResponse>;
  isReady(): Promise<{ ready: boolean }>;
  unload(): Promise<{ success: boolean }>;
  isEmbeddingModelDownloaded(): Promise<EmbeddingModelInfo>;
  downloadEmbeddingModel(options?: { url?: string }): Promise<EmbeddingDownloadResult>;
}

const NativeRetriever = registerPlugin<NativeRetrieverPlugin>('NativeRetriever');

type RetrieverStatus = 'idle' | 'loading' | 'ready' | 'error';

let status: RetrieverStatus = 'idle';
let loadPromise: Promise<void> | null = null;

export function getNativeRetrieverStatus(): RetrieverStatus {
  return status;
}

/**
 * Load the .hiv bundle into ObjectBox + HNSW index.
 * Parses pre-computed EmbeddingGemma-300M vectors from index/embeddings.bin.
 * Idempotent — safe to call repeatedly.
 *
 * @param bundlePath — absolute path to the .hiv file in the app's files directory
 */
export async function loadNativeBundle(bundlePath: string): Promise<void> {
  if (status === 'ready') return;
  if (status === 'loading' && loadPromise) return loadPromise;

  status = 'loading';
  loadPromise = (async () => {
    try {
      const result = await NativeRetriever.loadBundle({ path: bundlePath });
      if (!result.success) throw new Error('NativeRetriever.loadBundle returned success=false');
      console.log(`[NativeRetriever] Loaded ${result.chunkCount} chunks, ${result.embeddingDims}D embeddings`);
      status = 'ready';
    } catch (err) {
      status = 'error';
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

/**
 * Run a semantic search query via ObjectBox HNSW + EmbeddingGemma-300M.
 * Query is prefixed with the asymmetric retrieval prefix on the native side.
 * Returns an empty array if the retriever is not ready.
 */
export async function nativeSearch(
  query: string,
  topK = 5,
): Promise<NativeSearchResult[]> {
  if (status !== 'ready') return [];
  try {
    const response = await NativeRetriever.search({ query, topK });
    return response.results;
  } catch (err) {
    console.warn('[NativeRetriever] search failed:', err);
    return [];
  }
}

export async function isNativeRetrieverReady(): Promise<boolean> {
  if (status === 'ready') return true;
  try {
    const { ready } = await NativeRetriever.isReady();
    if (ready) status = 'ready';
    return ready;
  } catch {
    return false;
  }
}

export async function unloadNativeRetriever(): Promise<void> {
  await NativeRetriever.unload();
  status = 'idle';
  loadPromise = null;
}

/**
 * Check if the EmbeddingGemma-300M ONNX (q8) model is downloaded on-device.
 */
export async function isEmbeddingModelDownloaded(): Promise<EmbeddingModelInfo> {
  try {
    return await NativeRetriever.isEmbeddingModelDownloaded();
  } catch {
    return { downloaded: false, path: '', sizeMB: 0 };
  }
}

/**
 * Download the EmbeddingGemma-300M ONNX (q8) model to device internal storage.
 * Only needed once; survives app updates.
 *
 * @param url — optional override URL. Defaults to HuggingFace EmbeddingGemma q8 ONNX.
 */
export async function downloadEmbeddingModel(url?: string): Promise<EmbeddingDownloadResult> {
  return NativeRetriever.downloadEmbeddingModel(url ? { url } : {});
}
