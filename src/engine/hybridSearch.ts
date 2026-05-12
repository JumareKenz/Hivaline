/**
 * hybridSearch.ts — Three-stage search with BM25, vector similarity, and gap graph traversal
 *
 * Fuses BM25 (existing), vector similarity (new), and gap graph boost (new),
 * then ranks results using RRF (Reciprocal Rank Fusion).
 */

import type SessionState from './sessionState';

export interface HIVAssets {
  embeddingsBuffer?: ArrayBuffer;
  embeddingsIndex?: {
    dimensions?: number;
    total_chunks?: number;
    chunk_ids?: string[];
  };
  queryProxies?: Record<string, number[]>;
  gapGraph?: Record<string, Array<{ to: string; score: number; label?: string }>>;
  bm25Index?: Record<string, { index: Record<string, Array<{ chunk_id: string; score: number }>> }>;
  chunks?: Array<{ id: string; content?: Record<string, unknown> }>;
}

export interface SearchResult {
  chunkId: string;
  score: number;
}

let globalAssets: HIVAssets | null = null;

/**
 * Initialize search assets from parsed .hiv. Call once on .hiv load, not on every query.
 * @param hivAssets — parsed assets from the .hiv file
 */
export function initSearch(hivAssets: HIVAssets): void {
  globalAssets = hivAssets;
}

/**
 * Tokenize a string into unigrams.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
}

/**
 * Set intersection helper.
 */
function setIntersection(a: Set<string>, b: Set<string>): string[] {
  const result: string[] = [];
  for (const item of a) {
    if (b.has(item)) result.push(item);
  }
  return result;
}

/**
 * Cosine similarity between two number arrays.
 */
function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

/**
 * Vector search using query proxies (no on-device model).
 * Finds best-matching proxy by Jaccard similarity, then cosine-similarity against all chunk vectors.
 */
function vectorSearch(rewrittenQuery: string, _language: string, topK = 10): SearchResult[] {
  const assets = globalAssets;
  if (!assets?.queryProxies || !assets.embeddingsBuffer || !assets.embeddingsIndex) {
    return [];
  }

  const queryTokens = new Set(tokenize(rewrittenQuery));

  // Find best-matching query proxy by Jaccard similarity
  let bestProxy: number[] | null = null;
  let bestJaccard = -1;

  for (const [proxyText, proxyVector] of Object.entries(assets.queryProxies)) {
    const proxyTokens = new Set(tokenize(proxyText));
    const inter = setIntersection(queryTokens, proxyTokens).length;
    const union = new Set([...queryTokens, ...proxyTokens]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard > bestJaccard) {
      bestJaccard = jaccard;
      bestProxy = proxyVector;
    }
  }

  if (!bestProxy) return [];

  const dims = assets.embeddingsIndex.dimensions ?? 384;
  const totalChunks = assets.embeddingsIndex.total_chunks ?? 0;
  const float32View = new Float32Array(assets.embeddingsBuffer);

  const results: SearchResult[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * dims;
    const chunkVec = float32View.subarray(offset, offset + dims);
    const score = cosineSimilarity(bestProxy, chunkVec);
    const chunkId = assets.embeddingsIndex.chunk_ids?.[i] ?? String(i);
    results.push({ chunkId, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Boost candidates that are reachable from the last served chunk via the gap graph.
 */
function gapGraphBoost(candidates: SearchResult[], lastChunkId: string | null, gapGraph: Record<string, Array<{ to: string; score: number }>> | undefined): SearchResult[] {
  if (!lastChunkId || !gapGraph) return candidates;
  const edges = gapGraph[lastChunkId] ?? [];
  return candidates.map((c) => {
    const edge = edges.find((e) => e.to === c.chunkId);
    const boost = edge ? edge.score * 0.25 : 0;
    return { ...c, score: c.score + boost };
  });
}

/**
 * Reciprocal Rank Fusion — merge two ranked lists.
 */
function rrfFuse(bm25Results: SearchResult[], vectorResults: SearchResult[], k = 60): SearchResult[] {
  const scores = new Map<string, number>();
  const ranks = new Map<string, { bm25: number; vector: number }>();

  bm25Results.forEach((r, i) => {
    ranks.set(r.chunkId, { bm25: i + 1, vector: Infinity });
  });

  vectorResults.forEach((r, i) => {
    const existing = ranks.get(r.chunkId);
    if (existing) {
      existing.vector = i + 1;
    } else {
      ranks.set(r.chunkId, { bm25: Infinity, vector: i + 1 });
    }
  });

  for (const [chunkId, { bm25, vector }] of ranks) {
    const score = 1 / (k + bm25) + 1 / (k + vector);
    scores.set(chunkId, score);
  }

  return Array.from(scores.entries())
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Dead-end escape: avoid returning already-served chunks.
 * If top 3 candidates were all served, walk one hop in gap graph.
 */
function deadEndEscape(fused: SearchResult[], sessionState: SessionState, gapGraph: Record<string, Array<{ to: string; score: number }>> | undefined): SearchResult | null {
  if (!fused || fused.length === 0) return null;

  // Skip already-served chunks
  const fresh = fused.filter((r) => !sessionState.wasChunkServed(r.chunkId));
  if (fresh.length > 0) {
    return fresh[0];
  }

  // If all top were served, walk one hop in gap graph from last served chunk
  const lastChunkId = sessionState.turnBuffer.length > 0
    ? sessionState.turnBuffer[sessionState.turnBuffer.length - 1].chunkId
    : null;

  if (lastChunkId && gapGraph?.[lastChunkId]) {
    const edges = gapGraph[lastChunkId];
    for (const edge of edges) {
      if (!sessionState.wasChunkServed(edge.to)) {
        return { chunkId: edge.to, score: edge.score ?? 0.5 };
      }
    }
  }

  // Absolute fallback: return first result even if served
  return fused[0] || null;
}

/**
 * BM25 search from pre-scored lexical index.
 */
function bm25Search(query: string, language: string, bm25Index: HIVAssets['bm25Index']): SearchResult[] {
  if (!bm25Index || !bm25Index[language]) return [];
  const idx = bm25Index[language].index || {};
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\w]/g, ''))
    .filter((t) => t.length >= 2);

  const scores: Record<string, number> = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] || 0) + score;
    }
  }

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([chunkId, score]) => ({ chunkId, score }));
}

/**
 * Full hybrid search pipeline.
 * @param rewrittenQuery — enriched query string
 * @param sessionState — current session state
 * @param language — language code (default 'en')
 * @param hivAssets — optional assets (falls back to initSearch globals)
 * @returns top SearchResult or null
 */
export function search(rewrittenQuery: string, sessionState: SessionState, language = 'en', hivAssets?: HIVAssets): SearchResult | null {
  const assets = hivAssets || globalAssets || {};

  // Stage 1: BM25 (existing)
  const bm25 = bm25Search(rewrittenQuery, language, assets.bm25Index);

  // Stage 2: Vector search (new)
  const vector = vectorSearch(rewrittenQuery, language, 10);

  // Stage 3: Gap graph boost on merged candidates
  const lastChunkId = sessionState.turnBuffer.length > 0
    ? sessionState.turnBuffer[sessionState.turnBuffer.length - 1].chunkId
    : null;
  const merged = [...bm25, ...vector];
  gapGraphBoost(merged, lastChunkId, assets.gapGraph);

  // Stage 4: RRF fusion on the separate ranked lists
  const fused = rrfFuse(bm25, vector);

  // Stage 5: Dead-end escape
  return deadEndEscape(fused, sessionState, assets.gapGraph);
}
