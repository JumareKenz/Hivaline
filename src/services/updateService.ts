/**
 * updateService.ts — .hiv file update loop
 *
 * 1. Check version metadata (fetch, cached 5 min)
 * 2. Compare local version
 * 3. Download with Range header (resumable)
 * 4. Verify SHA-256 + Ed25519 signature
 * 5. Persist to IndexedDB
 *
 * All fetch() calls wrapped in try/catch — offline = silent skip.
 */

import { openDB, type DBSchema } from 'idb';
import { unzipSync } from 'fflate';
import { ed25519 } from '@noble/curves/ed25519.js';
import { parseHIVFile } from './hivLoader';
import type { UpdateMetadata, HIVFile } from '@/types/hiv';
import {
  HIVA_TOKEN_KEY,
  HIVA_SERVER_CODE_KEY,
  HIVA_USER_NAME_KEY,
  HIVA_KNOWN_VERSION_KEY,
} from '@/utils/constants';

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

    if (!response.ok) return null;

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
    // Version matches — also confirm file is actually in IndexedDB
    const db = await getDB();
    const local = await db.get(STORE_NAME, 'current');
    if (local) return null; // up to date and file present
  }
  return meta;
}

/**
 * Download .hiv file with resumable support.
 * Persists partial bytes in IndexedDB for resume.
 */
export async function downloadHIV(meta: UpdateMetadata): Promise<Uint8Array | null> {
  try {
    const db = await getDB();
    const partial = await db.get(STORE_NAME, 'partial');
    const resumeFrom = partial?.blob ? partial.blob.length : 0;

    const token = localStorage.getItem(HIVA_TOKEN_KEY);
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
      // Token revoked — clear auth state and notify AuthContext
      localStorage.removeItem(HIVA_TOKEN_KEY);
      localStorage.removeItem(HIVA_SERVER_CODE_KEY);
      localStorage.removeItem(HIVA_USER_NAME_KEY);
      window.dispatchEvent(new CustomEvent('hiva:session-revoked'));
      return null;
    }

    if (!response.ok) return null;

    const chunk = new Uint8Array(await response.arrayBuffer());
    const totalLength = resumeFrom + chunk.length;

    if (totalLength < meta.size_kb * 1024) {
      // Incomplete — save partial
      const combined = new Uint8Array(totalLength);
      if (resumeFrom > 0 && partial?.blob) combined.set(partial.blob);
      combined.set(chunk, resumeFrom);
      await db.put(STORE_NAME, { blob: combined, version: meta.version, downloadedAt: new Date().toISOString() }, 'partial');
      throw new Error('Download incomplete — will resume next time');
    }

    const full = new Uint8Array(totalLength);
    if (resumeFrom > 0 && partial?.blob) full.set(partial.blob);
    full.set(chunk, resumeFrom);

    // Verify SHA-256
    const hash = await sha256(full);
    if (hash !== meta.sha256) {
      await db.delete(STORE_NAME, 'partial');
      throw new Error('Integrity check failed — hash mismatch');
    }

    // Verify Ed25519 signature
    const valid = await verifySignature(full);
    if (!valid) {
      await db.delete(STORE_NAME, 'partial');
      throw new Error('Signature verification failed — file may be tampered');
    }

    // Persist verified file and update known version
    await db.put(STORE_NAME, { blob: full, version: meta.version, downloadedAt: new Date().toISOString() }, 'current');
    await db.delete(STORE_NAME, 'partial');
    localStorage.setItem(HIVA_KNOWN_VERSION_KEY, meta.version);

    return full;
  } catch {
    return null;
  }
}

/**
 * Load the currently stored .hiv file from IndexedDB.
 */
export async function loadStoredHIV(): Promise<HIVFile | null> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_NAME, 'current');
    if (!record) return null;
    const buffer = record.blob.buffer;
    const arrayBuffer = buffer instanceof ArrayBuffer
      ? buffer.slice(record.blob.byteOffset, record.blob.byteOffset + record.blob.byteLength)
      : new ArrayBuffer(record.blob.byteLength);
    if (!(buffer instanceof ArrayBuffer)) {
      new Uint8Array(arrayBuffer).set(record.blob);
    }
    return parseHIVFile(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Verify Ed25519 signature embedded in the .hiv ZIP.
 */
async function verifySignature(hivBytes: Uint8Array): Promise<boolean> {
  try {
    const zip = unzipSync(hivBytes);
    const sigRaw = zip['signature/sig.bin'] ?? zip['/signature/sig.bin'];
    const pubRaw = zip['signature/pubkey.bin'] ?? zip['/signature/pubkey.bin'];

    if (!sigRaw || !pubRaw) {
      // Accept unsigned only in local dev — reject in production builds
      return import.meta.env.DEV;
    }

    // Reconstruct signable payload: ZIP contents minus signature/ directory
    const signable = repackWithoutSignature(zip);

    return ed25519.verify(sigRaw, signable, pubRaw);
  } catch {
    return false;
  }
}

function repackWithoutSignature(zip: Record<string, Uint8Array>): Uint8Array {
  const filtered: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(zip)) {
    if (!key.includes('signature/') && !key.includes('/signature/')) {
      filtered[key] = value;
    }
  }
  // Sort keys so signing payload is deterministic regardless of insertion order
  const parts = Object.keys(filtered).sort().map((k) => filtered[k]);
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
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
