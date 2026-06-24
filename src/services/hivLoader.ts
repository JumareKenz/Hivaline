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
  VariantEmbeddingRecord,
} from '@/types/hiv';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

/* ─── Capabilities Detection ─── */

/**
 * Flags indicating which optional features the loaded .hiv file supports.
 * Run detectCapabilities() immediately after parseHIVFile() to populate.
 */
export interface HivCapabilities {
  hasEmbeddings: boolean;
  hasLexicalIndex: boolean;
  hasGapGraph: boolean;
  hasCoverageManifest: boolean;
  hasAcronymChunks: boolean;
  hasHeadingChunks: boolean;
  hasQueryProxies: boolean;
  schemaVersion: string;
}

/**
 * Inspect a parsed HIVFile and return capability flags.
 * Logs a single structured warning if acronym/heading chunks are absent.
 *
 * @param hivFile — parsed .hiv result from parseHIVFile()
 * @returns HivCapabilities snapshot
 */
export function detectCapabilities(hivFile: HIVFile): HivCapabilities {
  const hasEmbeddings = hivFile.embeddings.length > 0 && hivFile.embeddings[0]?.length > 0;
  const hasLexicalIndex = hivFile.manifest.retrievalCapabilities?.hasLexicalIndex
    ?? (hivFile.lexicalIndex !== undefined && Object.keys(hivFile.lexicalIndex).length > 0);
  const hasQueryProxies = hivFile.queryProxies !== undefined && Object.keys(hivFile.queryProxies).length > 0;

  const rules = hivFile.rules as Record<string, unknown>;
  const manifestExt = hivFile.manifest as unknown as Record<string, unknown>;

  const rawGapGraph =
    (rules.gap_graph as Record<string, unknown> | undefined) ??
    (manifestExt.gap_graph as Record<string, unknown> | undefined);
  const hasGapGraph = rawGapGraph !== undefined && rawGapGraph !== null && Object.keys(rawGapGraph).length > 0;

  const rawCoverage =
    (rules.coverage_manifest as Record<string, unknown> | undefined) ??
    (manifestExt.coverage_manifest as Record<string, unknown> | undefined);
  const hasCoverageManifest = rawCoverage !== undefined && rawCoverage !== null && Object.keys(rawCoverage).length > 0;

  const hasAcronymChunks = hivFile.chunks.some((c) => {
    const meta = (c as unknown as Record<string, unknown>).extra_metadata as Record<string, unknown> | undefined;
    return meta?.is_acronym_entry === true;
  });

  const hasHeadingChunks = hivFile.chunks.some((c) => {
    const meta = (c as unknown as Record<string, unknown>).extra_metadata as Record<string, unknown> | undefined;
    return meta?.is_heading_entry === true;
  });

  const schemaVersion = hivFile.manifest.version ?? 'unknown';

  if (!hasAcronymChunks || !hasHeadingChunks) {
    // eslint-disable-next-line no-console
    console.warn('HIVA: loaded .hiv lacks acronym/heading chunks — recompile recommended');
  }

  return {
    hasEmbeddings,
    hasLexicalIndex,
    hasGapGraph,
    hasCoverageManifest,
    hasAcronymChunks,
    hasHeadingChunks,
    hasQueryProxies,
    schemaVersion,
  };
}

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

  const { embeddings, meta: embeddingMeta, chunkIds } = parseEmbeddings(files);
  const lexicalIndex = parseLexicalIndex(files);
  const sources = parseSources(files);
  const rules = parseRules(files);
  const i18n = parseI18n(files);
  const gapGraph = parseGapGraph(files);
  const coverageManifest = parseCoverageManifest(files);

  // Query proxies (Tier 3 fallback for vector search when embedding model isn't warm)
  const queryProxies = parseQueryProxies(files);

  // Variant embeddings (dense vector search)
  const { matrix: variantEmbeddings, count: variantCount, dims: embeddingDims } = parseVariantEmbeddings(files);
  const variantEmbeddingsIndex = parseVariantEmbeddingsIndex(files);

  if (!variantEmbeddings) {
    // eslint-disable-next-line no-console
    console.warn('[HIVA] variant_embeddings.bin not found — falling back to query proxy search. Recompile for best results.');
  }

  // Try to load SQLite database if present
  let db: SQLiteDatabase | undefined;
  try {
    db = await parseDatabase(files);
  } catch {
    /* No SQLite database found, using JSON fallback */
  }

  // Merge gap_graph and coverage_manifest into rules for backward compatibility
  if (gapGraph && Object.keys(gapGraph).length > 0) {
    rules.gap_graph = gapGraph;
  }
  if (coverageManifest && Object.keys(coverageManifest).length > 0) {
    rules.coverage_manifest = coverageManifest;
  }

  return {
    manifest,
    chunks,
    embeddings,
    embeddingMeta,
    embeddingChunkIds: chunkIds,
    lexicalIndex,
    sources,
    rules,
    i18n,
    gapGraph,
    db,
    variantEmbeddings,
    variantEmbeddingsIndex,
    variantCount,
    embeddingDims,
    queryProxies,
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
): { embeddings: Int8Array[]; meta: import('@/types/hiv').EmbeddingMetadata[]; chunkIds: string[] } {
  const raw = getFile(files, 'index/embeddings.bin');
  if (!raw) {
    console.log('[parseEmbeddings] embeddings.bin not found');
    return { embeddings: [], meta: [], chunkIds: [] }; // Optional: BM25-only mode
  }

  // Parse embeddings_index.json to get chunk ID mapping
  const indexRaw = getFile(files, 'index/embeddings_index.json');
  let chunkIds: string[] = [];
  if (indexRaw) {
    try {
      const indexData = JSON.parse(strFromU8(indexRaw)) as { index: Record<string, string> };
      const indexMap = indexData.index;
      // Convert object {0: "uuid", 1: "uuid"} to array ["uuid", "uuid"]
      chunkIds = Object.keys(indexMap).sort((a, b) => Number(a) - Number(b)).map(k => indexMap[k]);
    } catch (err) {
      console.warn('[parseEmbeddings] Failed to parse embeddings_index.json:', err);
    }
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const chunkCount = view.getUint32(0, true);  // number of chunks
  const dim = view.getUint32(4, true);         // embedding dimension

  // Simple format: [uint32: count][uint32: dim][float32: embeddings...]
  // The embeddings start at offset 8 (after the 2 uint32 headers)
  const offset = 8;
  const expectedBytes = chunkCount * dim * 4; // float32 = 4 bytes per value

  if (offset + expectedBytes > raw.byteLength) {
    console.log('[parseEmbeddings] VALIDATION FAILED: file too small');
    return { embeddings: [], meta: [], chunkIds: [] };
  }

  // Read float32 embeddings and convert to Int8Array (quantize to -127..127)
  const floatData = new Float32Array(raw.buffer, raw.byteOffset + offset, chunkCount * dim);
  const embeddings: Int8Array[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const chunkFloats = floatData.slice(i * dim, (i + 1) * dim);
    const quantized = new Int8Array(dim);

    // Quantize float32 [-1, 1] to int8 [-127, 127]
    for (let j = 0; j < dim; j++) {
      quantized[j] = Math.round(Math.max(-1, Math.min(1, chunkFloats[j])) * 127);
    }

    embeddings.push(quantized);
  }

  return { embeddings, meta: [], chunkIds };
}

function parseLexicalIndex(files: Record<string, Uint8Array>): HIVLexicalIndex | undefined {
  const raw = getFile(files, 'index/lexical.json');
  if (!raw) return undefined;
  try {
    return JSON.parse(strFromU8(raw)) as HIVLexicalIndex;
  } catch {
    return undefined;
  }
}

function parseSources(files: Record<string, Uint8Array>): HIVSources {
  const raw = getFile(files, 'content/sources.json');
  if (!raw) return { sources: [] };
  return JSON.parse(strFromU8(raw)) as HIVSources;
}

function parseGapGraph(files: Record<string, Uint8Array>): Record<string, Array<{ to: string; score: number; label?: string }>> | undefined {
  const raw = getFile(files, 'index/gap_graph.json');
  if (!raw) return undefined;
  try {
    return JSON.parse(strFromU8(raw)) as Record<string, Array<{ to: string; score: number; label?: string }>>;
  } catch {
    return undefined;
  }
}

function parseCoverageManifest(files: Record<string, Uint8Array>): Record<string, unknown> | undefined {
  const raw = getFile(files, 'index/coverage_manifest.json');
  if (!raw) return undefined;
  try {
    return JSON.parse(strFromU8(raw)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
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

function parseQueryProxies(files: Record<string, Uint8Array>): Record<string, number[]> | undefined {
  const raw = getFile(files, 'index/query_proxies.json');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(strFromU8(raw));
    // Format: { "en": [ { pattern: string, vector: number[] }, ... ] }
    const entries = parsed?.en ?? parsed?.entries ?? [];
    if (Array.isArray(entries)) {
      const result: Record<string, number[]> = {};
      for (const entry of entries) {
        if (entry.pattern && Array.isArray(entry.vector)) {
          result[entry.pattern] = entry.vector;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
    // Fallback: already in Record<string, number[]> format
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number[]>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseVariantEmbeddings(files: Record<string, Uint8Array>): { matrix: Float32Array | null; count: number; dims: number } {
  const raw = getFile(files, 'index/variant_embeddings.bin');
  if (!raw) return { matrix: null, count: 0, dims: 0 };

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const N = view.getInt32(0, true);
  const D = view.getInt32(4, true);

  const expectedBytes = 8 + N * D * 4;
  if (raw.byteLength < expectedBytes) {
    return { matrix: null, count: 0, dims: 0 };
  }

  const matrix = new Float32Array(raw.buffer, raw.byteOffset + 8, N * D);
  return { matrix, count: N, dims: D };
}

function parseVariantEmbeddingsIndex(files: Record<string, Uint8Array>): VariantEmbeddingRecord[] | null {
  const raw = getFile(files, 'index/variant_embeddings_index.json');
  if (!raw) return null;
  try {
    return JSON.parse(strFromU8(raw)) as VariantEmbeddingRecord[];
  } catch {
    return null;
  }
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
