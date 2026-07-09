/**
 * embeddingModel.ts — REMOVED (legacy WebView embedding path)
 *
 * This module provided WebView-based query embedding for v2.2/v2.3 bundles.
 * It has been removed as part of the NativeRetriever migration.
 *
 * All embedding now happens via NativeRetriever:
 *   - Native ObjectBox + HNSW search
 *   - EmbeddingGemma-300M (256-dim Matryoshka)
 *   - See: android/app/src/main/java/com/hiva/runtime/retriever/NativeRetrieverPlugin.kt
 *
 * USE_NATIVE_RETRIEVER flag kept as 1-release rollback safety valve only.
 * Will be removed entirely in next release.
 */

// Legacy type kept for compatibility during migration
export type EmbeddingModelType = 'minilm' | 'bge-m3';

export interface ModelProgress {
  status: string;
  progress?: number;
  file?: string;
}

export type ProgressFn = (p: ModelProgress) => void;

/**
 * REMOVED: Legacy WebView embedding path deleted.
 * All embedding now via NativeRetriever (ObjectBox + EmbeddingGemma).
 *
 * This stub exists only for 1-release rollback compatibility.
 * Callers should check USE_NATIVE_RETRIEVER flag and use NativeRetriever instead.
 */
export function isModelLoaded(_modelType: EmbeddingModelType): boolean {
  console.warn('[embeddingModel] REMOVED: Legacy WebView embedding path is no longer supported. Use NativeRetriever.');
  return false;
}

/**
 * REMOVED: Legacy model loading deleted.
 * Throws error to surface misconfigurations.
 */
export async function getEmbeddingModel(_modelType: EmbeddingModelType, _onProgress?: ProgressFn): Promise<never> {
  throw new Error(
    'Legacy WebView embedding path removed. ' +
    'Configure USE_NATIVE_RETRIEVER=true and use NativeRetriever (ObjectBox + EmbeddingGemma). ' +
    'See: android/app/src/main/java/com/hiva/runtime/retriever/NativeRetrieverPlugin.kt'
  );
}

/**
 * REMOVED: Legacy query embedding deleted.
 * Throws error to surface misconfigurations.
 */
export async function embedQuery(_text: string, _modelType: EmbeddingModelType): Promise<never> {
  throw new Error(
    'Legacy WebView embedding path removed. ' +
    'Configure USE_NATIVE_RETRIEVER=true and use NativeRetriever (ObjectBox + EmbeddingGemma).'
  );
}
