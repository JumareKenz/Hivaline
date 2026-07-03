/**
 * embeddingModel.ts — On-device query embedding via ONNX (Xenova/transformers)
 *
 * Supports two embedding models for schema version compatibility:
 *   - v2.2 bundles: paraphrase-multilingual-MiniLM-L12-v2 (384-dim, mean pooling)
 *   - v2.3 bundles: Xenova/bge-m3 (1024-dim dense-only, cls pooling)
 *
 * Models are downloaded ONCE (first launch, online) and cached in the WebView's
 * persistent Cache Storage. Every later load is served from cache for offline use.
 *
 * Network safety: callers must never invoke embedQuery() unless the model is
 * already loaded (see modelManager.isEmbeddingModelReady) so a query can never
 * trigger a download or hang. embedQuery is additionally wrapped in try/catch
 * at the search layer as a last-resort guard.
 */

// Model IDs for local model loading
const MODEL_ID_MINILM = 'embed';      // v2.2: MiniLM 384-dim
const MODEL_ID_BGE_M3 = 'bge-m3';     // v2.3: bge-m3 1024-dim dense-only

export type EmbeddingModelType = 'minilm' | 'bge-m3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstanceMiniLM: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstanceBgeM3: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromiseMiniLM: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromiseBgeM3: Promise<any> | null = null;

export interface ModelProgress {
  status: string;
  /** 0–100 while downloading a file. */
  progress?: number;
  file?: string;
}

export type ProgressFn = (p: ModelProgress) => void;

/** True once the specified model pipeline is resident in memory (cached or freshly loaded). */
export function isModelLoaded(modelType: EmbeddingModelType): boolean {
  return modelType === 'minilm' ? pipelineInstanceMiniLM !== null : pipelineInstanceBgeM3 !== null;
}

/**
 * Load (and on first run, download + cache) the embedding pipeline for the specified model type.
 * Resolves from the persistent Cache API when available — works offline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getEmbeddingModel(modelType: EmbeddingModelType, onProgress?: ProgressFn): Promise<any> {
  if (modelType === 'minilm') {
    if (pipelineInstanceMiniLM) return pipelineInstanceMiniLM;
    if (loadingPromiseMiniLM) return loadingPromiseMiniLM;

    loadingPromiseMiniLM = loadPipeline(MODEL_ID_MINILM, 'mean', onProgress);
    try {
      pipelineInstanceMiniLM = await loadingPromiseMiniLM;
      return pipelineInstanceMiniLM;
    } catch (err) {
      loadingPromiseMiniLM = null;
      throw err;
    }
  } else {
    // bge-m3
    if (pipelineInstanceBgeM3) return pipelineInstanceBgeM3;
    if (loadingPromiseBgeM3) return loadingPromiseBgeM3;

    loadingPromiseBgeM3 = loadPipeline(MODEL_ID_BGE_M3, 'cls', onProgress);
    try {
      pipelineInstanceBgeM3 = await loadingPromiseBgeM3;
      return pipelineInstanceBgeM3;
    } catch (err) {
      loadingPromiseBgeM3 = null;
      throw err;
    }
  }
}

/**
 * Internal helper to load a pipeline with specified pooling strategy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPipeline(modelId: string, pooling: 'mean' | 'cls', onProgress?: ProgressFn): Promise<any> {
  console.log(`[embeddingModel] Starting model load for ${modelId}...`);
  const { pipeline, env } = await import('@xenova/transformers');
  console.log('[embeddingModel] Transformers library imported');

  // Serve model files from the app's own static assets (public/models/).
  // No remote fetch needed — works fully offline from first launch.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  env.localModelPath = '/models/';
  console.log('[embeddingModel] Environment configured:', { localModelPath: env.localModelPath });

  console.log(`[embeddingModel] Loading pipeline for model: ${modelId} with pooling: ${pooling}`);
  const pipe = await pipeline('feature-extraction', modelId, {
    quantized: true,
    progress_callback: (p: any) => {
      console.log(`[embeddingModel] Progress (${modelId}):`, p);
      onProgress?.(p);
    },
  });
  console.log(`[embeddingModel] Pipeline loaded successfully for ${modelId}`);
  return pipe;
}

/**
 * Embed a query string into a normalized float vector using the specified model.
 * Throws if the model is not loadable (offline + uncached) — callers guard with
 * isEmbeddingModelReady() and a try/catch BM25 fallback.
 */
export async function embedQuery(text: string, modelType: EmbeddingModelType): Promise<Float32Array> {
  const model = await getEmbeddingModel(modelType);
  const pooling = modelType === 'minilm' ? 'mean' : 'cls';
  const output = await model(text, { pooling, normalize: true });
  return output.data as Float32Array;
}
