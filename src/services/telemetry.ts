/**
 * telemetry.ts — anonymous, best-effort telemetry (error reports + feedback)
 *
 * Privacy & safety rules:
 *  - NON-ESSENTIAL: every call is fire-and-forget. It never blocks the UI,
 *    never throws, and is silently skipped when offline (matches the offline-
 *    grace contract — analytics/feedback are dropped, not queued forever).
 *  - ANONYMOUS: identifies the install only by a SHA-256 hash of a random,
 *    app-generated UUID (no device identifiers).
 *  - NO CLINICAL TEXT: feedback deliberately omits the query_text from the
 *    backend spec — only chunk_id + rating + latency leave the device.
 *  - NO AUTH: these endpoints are unauthenticated, so they work in grace mode.
 */

import { Preferences } from '@capacitor/preferences';
import { HIVA_KNOWN_VERSION_KEY } from '@/utils/constants';

const TELEMETRY_ENDPOINT = 'https://compiler.hiva.chat/api/hiv';
const DEVICE_ID_KEY = 'hivaline_device_id';
const ERROR_THROTTLE_MS = 5 * 60 * 1000; // at most one report per error_type / 5 min

export type FeedbackRating = 1 | -1 | 0;

let deviceIdHashCache: string | null = null;
const lastReportedAt = new Map<string, number>();

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function currentVersion(explicit?: string): string {
  if (explicit) return explicit;
  try {
    return localStorage.getItem(HIVA_KNOWN_VERSION_KEY) || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function toHex(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stable, anonymous per-install identifier: SHA-256 of a random UUID in Preferences. */
async function getDeviceIdHash(): Promise<string> {
  if (deviceIdHashCache) return deviceIdHashCache;
  try {
    let { value: id } = await Preferences.get({ key: DEVICE_ID_KEY });
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await Preferences.set({ key: DEVICE_ID_KEY, value: id });
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
    deviceIdHashCache = await toHex(digest);
    return deviceIdHashCache;
  } catch {
    return 'unknown';
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<void> {
  if (isOffline()) return; // non-essential: drop when offline
  try {
    await fetch(`${TELEMETRY_ENDPOINT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    /* telemetry is best-effort — swallow all errors */
  }
}

/**
 * Report a runtime error. Throttled per error_type to avoid flooding the
 * backend (e.g. a repeated offline-embed failure).
 */
export async function reportError(
  errorType: string,
  details: string,
  version?: string
): Promise<void> {
  const now = Date.now();
  if (now - (lastReportedAt.get(errorType) ?? 0) < ERROR_THROTTLE_MS) return;
  lastReportedAt.set(errorType, now);

  const device_id_hash = await getDeviceIdHash();
  await post('/error-report', {
    version: currentVersion(version),
    device_id_hash,
    error_type: errorType,
    details: details.slice(0, 500), // cap payload
  });
}

/**
 * Submit query feedback. query_text is intentionally NOT sent (privacy).
 */
export async function submitFeedback(params: {
  chunkId: string | null;
  rating: FeedbackRating;
  latencyMs: number;
  version?: string;
}): Promise<void> {
  const device_id_hash = await getDeviceIdHash();
  await post('/feedback', {
    version: currentVersion(params.version),
    device_id_hash,
    chunk_id: params.chunkId,
    rating: params.rating,
    latency_ms: Math.round(params.latencyMs),
    // query_text intentionally omitted — clinical text never leaves the device
  });
}

/** Test helper: reset module caches. */
export function __resetTelemetry(): void {
  deviceIdHashCache = null;
  lastReportedAt.clear();
}
