/**
 * nativeRetrieverService.ts — Thin TypeScript wrapper around the NativeRetriever
 * Capacitor plugin (ObjectBox + E5-small-v2 HNSW retrieval on Android).
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
  downloadEmbeddingModel(options?: Record<string, never>): Promise<EmbeddingDownloadResult>;
}

const NativeRetriever = registerPlugin<NativeRetrieverPlugin>('NativeRetriever');

type RetrieverStatus = 'idle' | 'loading' | 'ready' | 'error';

let status: RetrieverStatus = 'idle';
let loadPromise: Promise<void> | null = null;

export function getNativeRetrieverStatus(): RetrieverStatus {
  return status;
}

/**
 * Load the .hiva bundle into ObjectBox + HNSW index.
 * Parses pre-computed E5-small-v2 384-dim vectors from index/embeddings.bin.
 * Idempotent — safe to call repeatedly.
 *
 * @param bundlePath — absolute path to the .hiva file in the app's files directory
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
 * Run a semantic search query via ObjectBox HNSW + E5-small-v2.
 * Query is prefixed with "query: " on the native side.
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
 * Check if the E5-small-v2 fused ONNX model is downloaded on-device.
 */
export async function isEmbeddingModelDownloaded(): Promise<EmbeddingModelInfo> {
  try {
    return await NativeRetriever.isEmbeddingModelDownloaded();
  } catch {
    return { downloaded: false, path: '', sizeMB: 0 };
  }
}

/**
 * Copy the E5-small-v2 fused ONNX model from APK assets to device storage.
 * Only needed once on first launch; persists across app updates.
 */
export async function downloadEmbeddingModel(): Promise<EmbeddingDownloadResult> {
  return NativeRetriever.downloadEmbeddingModel({});
}
