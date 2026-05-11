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
  const embeddings = parseEmbeddings(files);
  const lexicalIndex = parseLexicalIndex(files);
  const sources = parseSources(files);
  const rules = parseRules(files);
  const i18n = parseI18n(files);
  
  // Try to load SQLite database if present
  let db: SQLiteDatabase | undefined;
  try {
    db = await parseDatabase(files);
  } catch (e) {
    console.log('[hivLoader] No SQLite database found, using JSON fallback');
  }

  return {
    manifest,
    chunks,
    embeddings,
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
  return lines.map((line) => JSON.parse(line) as HIVChunk);
}

function parseEmbeddings(files: Record<string, Uint8Array>): Int8Array[] {
  const raw = getFile(files, 'index/embeddings.bin');
  if (!raw) return []; // Optional: BM25-only mode

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = view.getUint32(0, true); // little-endian
  const dims = view.getUint32(4, true);
  const data = new Int8Array(raw.buffer, raw.byteOffset + 8);

  const embeddings: Int8Array[] = [];
  for (let i = 0; i < count; i++) {
    embeddings.push(data.slice(i * dims, (i + 1) * dims));
  }
  return embeddings;
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
  
  console.log('[hivLoader] Found SQLite database, loading...');
  
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
    exec: (sql: string): QueryExecResult[] => {
      const results = database.exec(sql);
      return results.map((r: { columns: string[]; values: unknown[][] }) => ({
        columns: r.columns,
        values: r.values,
      }));
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
    const results = db.exec(`SELECT content_json FROM chunks WHERE id = '${chunkId}'`);
    if (results.length > 0 && results[0].values.length > 0) {
      const contentJson = results[0].values[0][0];
      if (typeof contentJson === 'string') {
        return JSON.parse(contentJson) as HIVChunk;
      }
    }
  } catch (e) {
    console.error('[hivLoader] DB query error:', e);
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
      results = db.exec(`
        SELECT content_json FROM chunks_fts 
        WHERE chunks_fts MATCH '${query.replace(/'/g, "''")}*' 
        LIMIT ${limit}
      `);
    } catch {
      // Fallback to LIKE search on all text fields
      results = db.exec(`
        SELECT content_json FROM chunks 
        WHERE content_json LIKE '%${query.replace(/'/g, "''")}%'
        LIMIT ${limit}
      `);
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
  } catch (e) {
    console.error('[hivLoader] DB search error:', e);
  }
  
  return [];
}
