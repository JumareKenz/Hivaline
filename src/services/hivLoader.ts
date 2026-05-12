/**
 * hivLoader.ts — .hiv file parser and loader
 *
 * Parses a ZIP archive (fflate) containing:
 *   manifest.json, content/chunks.jsonl, index/embeddings.bin,
 *   index/lexical.json, content/sources.json, rules/*, i18n/*
 *   data/data.db (SQLite - optional, for v2.1+ format)
 */

import { unzipSync, strFromU8 } from 'fflate';
import initSqlJs from 'sql.js';
import type {
  HIVManifest,
  HIVChunk,
  HIVLexicalIndex,
  HIVSources,
  HIVI18N,
  HIVFile,
  SQLiteDatabase,
  QueryExecResult,
} from '@/types/hiv';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/**
 * Unzip a .hiv ArrayBuffer and extract all known files.
 */
export async function parseHIVFile(arrayBuffer: ArrayBuffer): Promise<HIVFile> {
  const zipData = new Uint8Array(arrayBuffer);
  const files = unzipSync(zipData);
  const manifest = parseManifest(files);
  const chunks = parseChunks(files);

  // If manifest claims chunks exist but none passed validation, the file is effectively empty
  if (manifest.chunk_count > 0 && chunks.length === 0) {
    throw new Error('.hiv file contains no valid chunks — all entries have empty content');
  }

  const { embeddings, meta: embeddingMeta } = parseEmbeddings(files);
  const lexicalIndex = parseLexicalIndex(files);
  const sources = parseSources(files);
  const rules = parseRules(files);
  const i18n = parseI18n(files);

  // Try to load SQLite database if present
  let db: SQLiteDatabase | undefined;
  try {
    db = await parseDatabase(files);
  } catch {
    /* No SQLite database found, using JSON fallback */
  }

  return {
    manifest,
    chunks,
    embeddings,
    embeddingMeta,
    lexicalIndex,
    sources,
    rules,
    i18n,
    db,
  };
}

function getFile(files: Record<string, Uint8Array>, path: string): Uint8Array | undefined {
  // Normalize: strip leading/trailing slashes, prefer non-empty entries
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  for (const key of Object.keys(files)) {
    const k = key.replace(/^\/+/, '').replace(/\/+$/, '');
    if (k === clean && files[key].length > 0) {
      return files[key];
    }
  }
  return undefined;
}

function parseManifest(files: Record<string, Uint8Array>): HIVManifest {
  const raw = getFile(files, 'manifest.json');
  if (!raw) throw new Error('.hiv missing manifest.json');
  const manifest = JSON.parse(strFromU8(raw)) as HIVManifest;

  // Backward compatible: normalize document_sources from legacy document_source
  if (!manifest.document_sources && manifest.document_source) {
    manifest.document_sources = [manifest.document_source];
  }

  return manifest;
}

function parseChunks(files: Record<string, Uint8Array>): HIVChunk[] {
  const raw = getFile(files, 'content/chunks.jsonl');
  if (!raw) throw new Error('.hiv missing content/chunks.jsonl');

  const text = strFromU8(raw);
  const lines = text.split('\n').filter((l) => l.trim());
  const chunks: HIVChunk[] = [];

  for (const line of lines) {
    try {
      const chunk = JSON.parse(line) as HIVChunk;
      if (isValidChunk(chunk)) {
        chunks.push(chunk);
      }
    } catch {
      /* Skip malformed JSONL lines */
    }
  }

  return chunks;
}

function isValidChunk(chunk: HIVChunk): boolean {
  if (!chunk.id || !chunk.type) return false;
  if (!chunk.content || typeof chunk.content !== 'object') return false;

  const hasMeaningfulContent = Object.entries(chunk.content).some(([, langContent]) => {
    if (!langContent || typeof langContent !== 'object') return false;
    return Object.keys(langContent).length > 0;
  });

  return hasMeaningfulContent;
}

function parseEmbeddings(
  files: Record<string, Uint8Array>
): { embeddings: Int8Array[]; meta: import('@/types/hiv').EmbeddingMetadata[] } {
  const raw = getFile(files, 'index/embeddings.bin');
  if (!raw) return { embeddings: [], meta: [] }; // Optional: BM25-only mode

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const chunkCount = view.getUint32(0, true);      // number of chunks (informational)
  const dim = view.getUint32(4, true);             // embedding dimension
  const embeddingsCount = view.getUint32(8, true); // total embeddings
  const metadataLen = view.getUint32(12, true);    // JSON metadata length

  let offset = 16; // header is 16 bytes (4 uint32s)

  // Parse metadata JSON
  let meta: import('@/types/hiv').EmbeddingMetadata[] = [];
  if (metadataLen > 0 && offset + metadataLen <= raw.byteLength) {
    const metaBytes = raw.slice(offset, offset + metadataLen);
    try {
      const metaStr = strFromU8(metaBytes);
      meta = JSON.parse(metaStr) as import('@/types/hiv').EmbeddingMetadata[];
    } catch {
      /* Failed to parse embeddings metadata JSON — continue without metadata */
    }
  }
  offset += metadataLen;

  // CRITICAL VALIDATION: metadata count must match embeddings count
  // If they mismatch, the binary is corrupt — fall back to BM25-only
  if (meta.length > 0 && meta.length !== embeddingsCount) {
    return { embeddings: [], meta: [] };
  }

  // CRITICAL VALIDATION: ensure we don't read past the buffer
  const expectedDataBytes = embeddingsCount * dim;
  if (offset + expectedDataBytes > raw.byteLength) {
    return { embeddings: [], meta: [] };
  }

  // Sanity check: chunk count should be positive if there are embeddings
  if (chunkCount === 0 && embeddingsCount > 0) {
    return { embeddings: [], meta: [] };
  }

  // Parse quantized embeddings: int8[embeddingsCount][dim]
  const data = new Int8Array(raw.buffer, raw.byteOffset + offset);
  const embeddings: Int8Array[] = [];
  for (let i = 0; i < embeddingsCount; i++) {
    embeddings.push(data.slice(i * dim, (i + 1) * dim));
  }

  return { embeddings, meta };
}

function parseLexicalIndex(files: Record<string, Uint8Array>): HIVLexicalIndex {
  const raw = getFile(files, 'index/lexical.json');
  if (!raw) throw new Error('.hiv missing index/lexical.json');
  return JSON.parse(strFromU8(raw)) as HIVLexicalIndex;
}

function parseSources(files: Record<string, Uint8Array>): HIVSources {
  const raw = getFile(files, 'content/sources.json');
  if (!raw) return { sources: [] };
  return JSON.parse(strFromU8(raw)) as HIVSources;
}

function parseRules(files: Record<string, Uint8Array>): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(files)) {
    if (key.startsWith('rules/') || key.startsWith('/rules/')) {
      const id = key.replace(/^\/?rules\//, '').replace(/\.json$/, '');
      rules[id] = JSON.parse(strFromU8(value));
    }
  }
  return rules;
}

function parseI18n(files: Record<string, Uint8Array>): Record<string, HIVI18N> {
  const i18n: Record<string, HIVI18N> = {};
  for (const [key, value] of Object.entries(files)) {
    if (key.startsWith('i18n/') || key.startsWith('/i18n/')) {
      const lang = key.replace(/^\/?i18n\//, '').replace(/\.json$/, '');
      i18n[lang] = JSON.parse(strFromU8(value)) as HIVI18N;
    }
  }
  return i18n;
}

async function parseDatabase(files: Record<string, Uint8Array>): Promise<SQLiteDatabase | undefined> {
  const dbFile = getFile(files, 'data/data.db');
  if (!dbFile) return undefined;

  if (!SQL) {
    SQL = await initSqlJs({ locateFile: (file: string) => `./${file}` });
  }

  const dbBuffer = dbFile.buffer.slice(
    dbFile.byteOffset,
    dbFile.byteOffset + dbFile.byteLength
  ) as ArrayBuffer;
  const database = new SQL.Database(new Uint8Array(dbBuffer));

  return {
    run: (sql: string, params?: unknown[]) => {
      database.run(sql, params as (string | number | null | Uint8Array)[]);
    },
    exec: (sql: string, params?: unknown[]): QueryExecResult[] => {
      if (!params || params.length === 0) {
        const results = database.exec(sql);
        return results.map((r: { columns: string[]; values: unknown[][] }) => ({
          columns: r.columns,
          values: r.values,
        }));
      }

      const stmt = database.prepare(sql);
      try {
        stmt.bind(params as (string | number | null | Uint8Array)[]);
        const columns = stmt.getColumnNames();
        const values: unknown[][] = [];
        while (stmt.step()) {
          values.push(stmt.get());
        }
        return [{ columns, values }];
      } finally {
        stmt.free();
      }
    },
    getRowsModified: () => database.getRowsModified(),
    close: () => database.close(),
  };
}

/**
 * Query SQLite database for chunks by ID - O(1) lookup
 */
export function getChunkFromDB(db: SQLiteDatabase | undefined, chunkId: string): HIVChunk | null {
  if (!db) return null;

  try {
    const results = db.exec('SELECT content_json FROM chunks WHERE id = ?', [chunkId]);
    if (results.length > 0 && results[0].values.length > 0) {
      const contentJson = results[0].values[0][0];
      if (typeof contentJson === 'string') {
        return JSON.parse(contentJson) as HIVChunk;
      }
    }
  } catch {
    /* DB query error — silently fall back to JSON chunks */
  }
  return null;
}

/**
 * Search SQLite using FTS or LIKE
 */
export function searchChunksDB(
  db: SQLiteDatabase | undefined,
  query: string,
  limit = 10
): HIVChunk[] {
  if (!db) return [];

  try {
    // Try FTS5 first, fallback to LIKE
    let results: QueryExecResult[] = [];

    try {
      results = db.exec('SELECT content_json FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?', [`${query}*`, limit]);
    } catch {
      // Fallback to LIKE search on all text fields
      results = db.exec('SELECT content_json FROM chunks WHERE content_json LIKE ? LIMIT ?', [`%${query}%`, limit]);
    }

    if (results.length > 0) {
      return results[0].values
        .map(row => {
          if (typeof row[0] === 'string') {
            try {
              return JSON.parse(row[0]) as HIVChunk;
            } catch {
              return null;
            }
          }
          return null;
        })
        .filter(Boolean) as HIVChunk[];
    }
  } catch {
    /* DB search error — silently fall back to JSON chunks */
  }

  return [];
}
