/**
 * queryLogger.ts — Lightweight on-device production query logging
 *
 * Logs every query locally (never sends data over the network) for diagnostic
 * review when users report bad answers. Stored in localStorage with a rolling
 * buffer (last 200 queries) to avoid unbounded storage growth.
 *
 * Each entry records: query text, search tier, top-1 chunk ID + title + score,
 * confidence gate status, and whether the "I don't know" path fired.
 */

import type { VectorTier } from '@/engine/hybridSearch';

const STORAGE_KEY = 'hiva_query_log';
const MAX_ENTRIES = 200;

export interface QueryLogEntry {
  ts: number;
  query: string;
  rewritten: string;
  tier: VectorTier;
  topChunkId: string | null;
  topChunkTitle: string | null;
  topBm25Score: number | null;
  topVectorScore: number | null;
  fusedScore: number | null;
  vectorGatePassed: boolean;
  confidenceGateFired: boolean;
  responseType: string;
}

let buffer: QueryLogEntry[] | null = null;

function loadBuffer(): QueryLogEntry[] {
  if (buffer !== null) return buffer;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    buffer = raw ? JSON.parse(raw) : [];
  } catch {
    buffer = [];
  }
  return buffer!;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // Storage full — trim more aggressively
    if (buffer && buffer.length > 50) {
      buffer = buffer.slice(-50);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer)); } catch { /* give up */ }
    }
  }
}

export function logQuery(entry: QueryLogEntry): void {
  const entries = loadBuffer();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    buffer = entries.slice(-MAX_ENTRIES);
  }
  persist();
}

export function getQueryLog(): QueryLogEntry[] {
  return loadBuffer().slice();
}

export function exportQueryLog(): string {
  return JSON.stringify(loadBuffer(), null, 2);
}

export function clearQueryLog(): void {
  buffer = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
