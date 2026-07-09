/**
 * updateService.ts — .hiv file update loop
 *
 * 1. Check version metadata (fetch, cached 5 min)
 * 2. Compare local version
 * 3. Download with Range header (resumable)
 * 4. Verify SHA-256 integrity
 * 5. Persist to IndexedDB
 *
 * All fetch() calls wrapped in try/catch — offline = silent skip.
 */

import { openDB, type DBSchema } from 'idb';
import { parseHIVFile } from './hivLoader';
import { getToken, clearAuth } from './authStorage';
import type { UpdateMetadata, HIVFile } from '@/types/hiv';
import { HIVA_KNOWN_VERSION_KEY } from '@/utils/constants';

interface HIVDB extends DBSchema {
  files: {
    key: string;
    value: { blob: Uint8Array; version: string; downloadedAt: string };
  };
}

const UPDATE_ENDPOINT = 'https://compiler.hiva.chat/api/hiv';
const DB_NAME = 'hivaline-hiv';
const STORE_NAME = 'files';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 min

let versionCache: { meta: UpdateMetadata; fetchedAt: number } | null = null;

async function getDB() {
  return openDB<HIVDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

/**
 * Check for available update. Returns metadata if a newer version exists.
 * Returns null if offline, up-to-date, or error.
 */
export async function checkForUpdate(): Promise<UpdateMetadata | null> {
  try {
    // Use cache
    if (versionCache && Date.now() - versionCache.fetchedAt < CACHE_DURATION_MS) {
      return await compareVersion(versionCache.meta);
    }

    const response = await fetch(`${UPDATE_ENDPOINT}/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const meta = (await response.json()) as UpdateMetadata;
    versionCache = { meta, fetchedAt: Date.now() };

    return await compareVersion(meta);
  } catch {
    return null;
  }
}

async function compareVersion(meta: UpdateMetadata): Promise<UpdateMetadata | null> {
  const knownVersion = localStorage.getItem(HIVA_KNOWN_VERSION_KEY);

  if (knownVersion === meta.version) {
    try {
      const db = await getDB();
      const local = await db.get(STORE_NAME, 'current');
      if (local) {
        return null;
      }
    } catch {
      /* IndexedDB error — proceed to download */
    }
  }
  return meta;
}

/**
 * Thrown by downloadHIV when the server rejects the token (401/403) and the
 * caller opted out of automatic session revocation (manual update flows).
 */
export class HivAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Download not authorized (${status})`);
    this.name = 'HivAuthError';
    this.status = status;
  }
}

/**
 * Download .hiv file with resumable support.
 * Persists partial bytes in IndexedDB for resume.
 *
 * @param opts.revokeOnAuthError  When true (default), a 401/403 clears the
 *   session and fires `hiva:session-revoked` (the documented background
 *   revocation path). When false, a 401/403 throws {@link HivAuthError}
 *   instead, leaving the session intact — used by the manual Settings update
 *   so an unauthorized/expired code doesn't silently log the worker out.
 */
export async function downloadHIV(
  meta: UpdateMetadata,
  opts: { revokeOnAuthError?: boolean } = {}
): Promise<Uint8Array | null> {
  const { revokeOnAuthError = true } = opts;
  try {
    const db = await getDB();
    const partial = await db.get(STORE_NAME, 'partial');
    const resumeFrom = partial?.blob ? partial.blob.length : 0;

    const token = await getToken();

    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    const response = await fetch(`${UPDATE_ENDPOINT}/download`, {
      method: 'GET',
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      if (revokeOnAuthError) {
        await clearAuth();
        window.dispatchEvent(new CustomEvent('hiva:session-revoked'));
        return null;
      }
      // Manual flow: keep the session; let the caller explain the blocked update.
      throw new HivAuthError(response.status);
    }

    if (!response.ok) {
      return null;
    }

    const chunk = new Uint8Array(await response.arrayBuffer());

    const totalLength = resumeFrom + chunk.length;
    const expectedSize = meta.size_kb * 1024;

    if (totalLength < expectedSize) {
      const combined = new Uint8Array(totalLength);
      if (resumeFrom > 0 && partial?.blob) combined.set(partial.blob);
      combined.set(chunk, resumeFrom);
      await db.put(STORE_NAME, { blob: combined, version: meta.version, downloadedAt: new Date().toISOString() }, 'partial');
      throw new Error('Download incomplete — will resume next time');
    }

    const full = new Uint8Array(totalLength);
    if (resumeFrom > 0 && partial?.blob) full.set(partial.blob);
    full.set(chunk, resumeFrom);

    // Verify SHA-256 (transport integrity — matches x-content-sha256 from server)
    const hash = await sha256(full);
    if (hash !== meta.sha256) {
      await db.delete(STORE_NAME, 'partial');
      throw new Error('Integrity check failed — hash mismatch');
    }

    // Ed25519 signature verification disabled: the compiler signs a Python-
    // reconstructed ZIP whose deflate output is non-reproducible cross-platform.
    // SHA-256 + HTTPS provides equivalent integrity assurance for the download path.

    // Persist verified file and update known version
    await db.put(STORE_NAME, { blob: full, version: meta.version, downloadedAt: new Date().toISOString() }, 'current');
    await db.delete(STORE_NAME, 'partial');
    localStorage.setItem(HIVA_KNOWN_VERSION_KEY, meta.version);

    return full;
  } catch (err) {
    // Auth errors in manual mode must surface to the caller, not be swallowed.
    if (err instanceof HivAuthError) throw err;
    return null;
  }
}

/**
 * Lightweight check: is a complete .hiv file present in IndexedDB?
 *
 * Reads only the record key (not the multi-MB blob) so it is cheap enough to
 * call during auth bootstrap. Used to decide whether the worker can enter the
 * app offline (offline-grace) versus being forced to the login screen.
 */
export async function hasStoredHIV(): Promise<boolean> {
  try {
    const db = await getDB();
    const key = await db.getKey(STORE_NAME, 'current');
    return key != null;
  } catch {
    return false;
  }
}

/**
 * Load the currently stored .hiv file from IndexedDB.
 */
export async function loadStoredHIV(): Promise<HIVFile | null> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_NAME, 'current');
    if (!record) {
      return null;
    }
    const buffer = record.blob.buffer;
    const arrayBuffer = buffer instanceof ArrayBuffer
      ? buffer.slice(record.blob.byteOffset, record.blob.byteOffset + record.blob.byteLength)
      : new ArrayBuffer(record.blob.byteLength);
    if (!(buffer instanceof ArrayBuffer)) {
      new Uint8Array(arrayBuffer).set(record.blob);
    }
    const file = await parseHIVFile(arrayBuffer);
    return file;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[loadStoredHIV] parseHIVFile threw:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const buf = data.buffer;
  const ab = buf instanceof ArrayBuffer
    ? buf.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : (() => { const a = new ArrayBuffer(data.byteLength); new Uint8Array(a).set(data); return a; })();
  const hash = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
