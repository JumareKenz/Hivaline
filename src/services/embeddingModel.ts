/**
 * embeddingModel.ts — On-device query embedding via ONNX (Xenova/transformers)
 *
 * The quantized paraphrase-multilingual-MiniLM-L12-v2 (~50MB) is downloaded
 * ONCE (first launch, online) and cached in the WebView's persistent Cache
 * Storage (caches.open('transformers-cache')). Every later load — including
 * fully offline — is served from that cache, so query embedding works offline
 * after the first sync. Until the model is cached, search degrades to BM25.
 *
 * Network safety: callers must never invoke embedQuery() unless the model is
 * already loaded (see modelManager.isEmbeddingModelReady) so a query can never
 * trigger a 50MB download or hang. embedQuery is additionally wrapped in
 * try/catch at the search layer as a last-resort guard.
 */

const MODEL_ID = 'embed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromise: Promise<any> | null = null;

export interface ModelProgress {
  status: string;
  /** 0–100 while downloading a file. */
  progress?: number;
  file?: string;
}

export type ProgressFn = (p: ModelProgress) => void;

/** True once the pipeline is resident in memory (cached or freshly loaded). */
export function isModelLoaded(): boolean {
  return pipelineInstance !== null;
}

/**
 * Load (and on first run, download + cache) the embedding pipeline.
 * Resolves from the persistent Cache API when available — works offline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getEmbeddingModel(onProgress?: ProgressFn): Promise<any> {
  if (pipelineInstance) return pipelineInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    console.log('[embeddingModel] Starting model load...');
    const { pipeline, env } = await import('@xenova/transformers');
    console.log('[embeddingModel] Transformers library imported');

    // Serve model files from the app's own static assets (public/models/).
    // No remote fetch needed — works fully offline from first launch.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = true;
    env.localModelPath = '/models/';
    console.log('[embeddingModel] Environment configured:', { localModelPath: env.localModelPath });

    // The ONNX model is 118MB. For faster loading, we rely on the browser's
    // native transformers.js runtime which will use the best available backend.
    // No explicit backend configuration needed — it auto-detects.

    console.log('[embeddingModel] Loading pipeline for model:', MODEL_ID);
    pipelineInstance = await pipeline('feature-extraction', MODEL_ID, {
      quantized: true,
      progress_callback: (p: any) => {
        console.log('[embeddingModel] Progress:', p);
        onProgress?.(p);
      },
    });
    console.log('[embeddingModel] Pipeline loaded successfully');
    return pipelineInstance;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    // Reset so a later attempt (e.g. on reconnect) can retry the download.
    loadingPromise = null;
    throw err;
  }
}

/**
 * Embed a query string into a normalized float vector.
 * Throws if the model is not loadable (offline + uncached) — callers guard with
 * isEmbeddingModelReady() and a try/catch BM25 fallback.
 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const model = await getEmbeddingModel();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}
