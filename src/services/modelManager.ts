/**
 * modelManager.ts — deferred embedding-model lifecycle + readiness gate
 *
 * Orchestrates the one-time download/warm-up of the on-device embedding model
 * and exposes a synchronous readiness flag the search layer consults so a
 * clinical query never triggers a download or blocks on the network.
 *
 *  - warmupEmbeddingModel(): kick off the download/cache load in the background.
 *  - isEmbeddingModelReady(): true once the model is resident (cached or loaded).
 *  - subscribeModelState(): observe status/progress for a one-time UI indicator.
 *  - getModelLoadTiming(): diagnostic timing data for latency analysis.
 *
 * Offline before the model is cached → warm-up fails → status 'unavailable' →
 * search degrades to BM25. A later reconnect can retry via warmupEmbeddingModel().
 */


export type ModelStatus = 'idle' | 'downloading' | 'ready' | 'unavailable';

export interface ModelState {
  status: ModelStatus;
  /** 0–100 */
  progress: number;
}

export interface ModelLoadTiming {
  warmupStartedAt: number | null;
  readyAt: number | null;
  coldStartMs: number | null;
  source: 'cache' | 'download' | 'unknown';
}

let state: ModelState = { status: 'idle', progress: 0 };
const listeners = new Set<(s: ModelState) => void>();

const timing: ModelLoadTiming = {
  warmupStartedAt: null,
  readyAt: null,
  coldStartMs: null,
  source: 'unknown',
};

export function getModelState(): ModelState {
  return state;
}

export function getModelLoadTiming(): ModelLoadTiming {
  return { ...timing };
}

/** Synchronous gate used by the search layer before embedding a query. */
export function isEmbeddingModelReady(): boolean {
  // NativeRetriever owns all embedding — JS WebView embedding path is removed.
  // Only report ready if our own state machine says so (never call the removed stubs).
  return state.status === 'ready';
}

export function subscribeModelState(fn: (s: ModelState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

/**
 * No-op: JS WebView embedding path removed. All embedding now via NativeRetriever.
 * Kept so call sites don't need to be updated.
 */
export async function warmupEmbeddingModel(): Promise<void> {
  // NativeRetriever handles its own lifecycle — nothing to warm up here.
}

/** Test helper: reset module state. */
export function __resetModelManager(): void {
  state = { status: 'idle', progress: 0 };
  timing.warmupStartedAt = null;
  timing.readyAt = null;
  timing.coldStartMs = null;
  timing.source = 'unknown';
  listeners.clear();
}
