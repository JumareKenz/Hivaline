/**
 * hivLoader.ts — .hiv file parser and loader
 *
 * Parses a ZIP archive (fflate) containing:
 *   manifest.json, content/chunks.jsonl, index/embeddings.bin,
 *   index/lexical.json, content/sources.json, rules/*, i18n/*
 */

import { unzipSync, strFromU8 } from 'fflate';
import type {
  HIVManifest,
  HIVChunk,
  HIVLexicalIndex,
  HIVSources,
  HIVI18N,
  HIVFile,
} from '@/types/hiv';

/**
 * Unzip a .hiv ArrayBuffer and extract all known files.
 */
export function parseHIVFile(arrayBuffer: ArrayBuffer): HIVFile {
  const zipData = new Uint8Array(arrayBuffer);
  const files = unzipSync(zipData);
  const manifest = parseManifest(files);
  const chunks = parseChunks(files);
  const embeddings = parseEmbeddings(files);
  const lexicalIndex = parseLexicalIndex(files);
  const sources = parseSources(files);
  const rules = parseRules(files);
  const i18n = parseI18n(files);

  return {
    manifest,
    chunks,
    embeddings,
    lexicalIndex,
    sources,
    rules,
    i18n,
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
  return JSON.parse(strFromU8(raw)) as HIVManifest;
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
