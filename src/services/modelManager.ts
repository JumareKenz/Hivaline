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

import { getEmbeddingModel, isModelLoaded, type ModelProgress } from './embeddingModel';

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
let warmupPromise: Promise<void> | null = null;
const listeners = new Set<(s: ModelState) => void>();

const timing: ModelLoadTiming = {
  warmupStartedAt: null,
  readyAt: null,
  coldStartMs: null,
  source: 'unknown',
};

function emit(next: Partial<ModelState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

export function getModelState(): ModelState {
  return state;
}

export function getModelLoadTiming(): ModelLoadTiming {
  return { ...timing };
}

/** Synchronous gate used by the search layer before embedding a query. */
export function isEmbeddingModelReady(): boolean {
  return state.status === 'ready' || isModelLoaded();
}

export function subscribeModelState(fn: (s: ModelState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

/**
 * Download/load the embedding model in the background (idempotent).
 * Safe to call repeatedly — e.g. on .hiv load and again on network reconnect.
 * Logs timing data for cold-start latency analysis on real devices.
 */
export async function warmupEmbeddingModel(): Promise<void> {
  if (state.status === 'ready' || isModelLoaded()) {
    if (state.status !== 'ready') emit({ status: 'ready', progress: 100 });
    return;
  }
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    timing.warmupStartedAt = performance.now();
    timing.source = 'unknown';
    emit({ status: 'downloading', progress: state.progress });

    // eslint-disable-next-line no-console
    console.log('[modelManager] warmup started at', Math.round(timing.warmupStartedAt), 'ms after page load');

    try {
      let sawProgress = false;
      await getEmbeddingModel((p: ModelProgress) => {
        if (p && p.status === 'progress' && typeof p.progress === 'number') {
          sawProgress = true;
          emit({ progress: Math.max(0, Math.min(100, Math.round(p.progress))) });
        }
        if (p && p.status === 'done') {
          timing.source = sawProgress ? 'download' : 'cache';
        }
      });

      timing.readyAt = performance.now();
      timing.coldStartMs = Math.round(timing.readyAt - (timing.warmupStartedAt ?? timing.readyAt));
      if (timing.source === 'unknown') {
        timing.source = 'cache';
      }

      // eslint-disable-next-line no-console
      console.log(
        `[modelManager] model READY in ${timing.coldStartMs}ms (source: ${timing.source})`,
      );

      emit({ status: 'ready', progress: 100 });
    } catch {
      const elapsed = Math.round(performance.now() - (timing.warmupStartedAt ?? 0));
      // eslint-disable-next-line no-console
      console.warn(`[modelManager] warmup FAILED after ${elapsed}ms — degrading to BM25`);
      emit({ status: 'unavailable', progress: 0 });
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

/** Test helper: reset module state. */
export function __resetModelManager(): void {
  state = { status: 'idle', progress: 0 };
  warmupPromise = null;
  timing.warmupStartedAt = null;
  timing.readyAt = null;
  timing.coldStartMs = null;
  timing.source = 'unknown';
  listeners.clear();
}
