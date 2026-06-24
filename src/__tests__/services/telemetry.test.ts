/**
 * telemetry.test.ts — anonymous error-report + feedback client.
 * Verifies privacy (no query_text), offline-skip, throttling, and payload shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { reportError, submitFeedback, __resetTelemetry } from '@/services/telemetry';

let fetchMock: ReturnType<typeof vi.fn>;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}
function lastUrl(): string {
  return fetchMock.mock.calls.at(-1)![0] as string;
}

beforeEach(async () => {
  __resetTelemetry();
  await Preferences.clear();
  setOnline(true);
  fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submitFeedback', () => {
  it('posts to /feedback WITHOUT query_text and with an anonymous device hash', async () => {
    await submitFeedback({ chunkId: 'chunk-42', rating: 1, latencyMs: 234.7, version: '2026.06.04.42' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toContain('/api/hiv/feedback');
    const body = lastBody();
    expect(body.chunk_id).toBe('chunk-42');
    expect(body.rating).toBe(1);
    expect(body.latency_ms).toBe(235); // rounded
    expect(body.version).toBe('2026.06.04.42');
    expect(typeof body.device_id_hash).toBe('string');
    expect((body.device_id_hash as string).length).toBe(64); // sha256 hex
    // Privacy guarantee: clinical query text must never be sent.
    expect('query_text' in body).toBe(false);
  });

  it('uses a stable device hash across calls', async () => {
    await submitFeedback({ chunkId: 'a', rating: 1, latencyMs: 1 });
    const h1 = lastBody().device_id_hash;
    await submitFeedback({ chunkId: 'b', rating: -1, latencyMs: 2 });
    const h2 = lastBody().device_id_hash;
    expect(h1).toBe(h2);
  });

  it('is silently skipped when offline', async () => {
    setOnline(false);
    await submitFeedback({ chunkId: 'x', rating: 1, latencyMs: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reportError', () => {
  it('posts to /error-report with type + details + version', async () => {
    await reportError('engine_search_failed', 'boom', '2026.06.04.42');
    expect(lastUrl()).toContain('/api/hiv/error-report');
    const body = lastBody();
    expect(body.error_type).toBe('engine_search_failed');
    expect(body.details).toBe('boom');
    expect(body.version).toBe('2026.06.04.42');
    expect(typeof body.device_id_hash).toBe('string');
  });

  it('throttles repeated reports of the same error_type', async () => {
    await reportError('engine_search_failed', 'first');
    await reportError('engine_search_failed', 'second');
    expect(fetchMock).toHaveBeenCalledTimes(1); // second is throttled
  });

  it('does not throttle different error types', async () => {
    await reportError('type_a', 'x');
    await reportError('type_b', 'y');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(reportError('whatever', 'details')).resolves.toBeUndefined();
  });
});
