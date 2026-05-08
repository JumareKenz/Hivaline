/**
 * searchEngine.ts — Hybrid BM25 + Vector search with RRF fusion
 *
 * BM25 runs from pre-scored lexical index (no computation).
 * Vector search uses cosine similarity over int8 quantized embeddings.
 * RRF fuses both result lists with configurable weights + type boosting.
 */

import type {
  HIVFile,
  HIVChunk,
  HIVManifest,
  HIVChunkType,
  SearchResult,
} from '@/types/hiv';

/**
 * BM25 lexical search over pre-scored inverted index.
 */
export function bm25Search(
  query: string,
  hivFile: HIVFile,
  lang = 'en',
  topK = 20
): SearchResult[] {
  const idx = hivFile.lexicalIndex[lang]?.index ?? {};
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  const scores: Record<string, number> = {};
  for (const term of terms) {
    const postings = idx[term] ?? [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] ?? 0) + score;
    }
  }

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([chunk_id, score]) => ({ chunk_id, score }));
}

/**
 * Vector semantic search using cosine similarity.
 * Embeddings are int8 quantized (float32 × 127).
 */
export function vectorSearch(
  queryEmbedding: Float32Array,
  hivFile: HIVFile,
  topK = 20
): SearchResult[] {
  const { embeddings, chunks } = hivFile;
  if (embeddings.length === 0 || chunks.length === 0) return [];

  const scores: SearchResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkVec = embeddings[i];
    if (!chunkVec || chunkVec.length === 0) continue;

    const floatVec = dequantize(chunkVec);
    const similarity = cosineSimilarity(queryEmbedding, floatVec);
    scores.push({ chunk_id: chunks[i].id, score: similarity });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Reciprocal Rank Fusion — combines BM25 and vector ranks.
 */
export function rrfFuse(
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  manifest: HIVManifest,
  chunks: HIVChunk[]
): SearchResult[] {
  const { bm25_weight, vector_weight, rrf_k, type_boost } = manifest.search_config;

  const scores: Record<string, number> = {};

  bm25Results.forEach(({ chunk_id }, rank) => {
    scores[chunk_id] = (scores[chunk_id] ?? 0) + bm25_weight * (1 / (rrf_k + rank + 1));
  });

  vectorResults.forEach(({ chunk_id }, rank) => {
    scores[chunk_id] = (scores[chunk_id] ?? 0) + vector_weight * (1 / (rrf_k + rank + 1));
  });

  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  return Object.entries(scores)
    .map(([chunk_id, score]) => {
      const chunk = chunkMap.get(chunk_id);
      const boost = type_boost[(chunk?.type as HIVChunkType) ?? 'faq'] ?? 1.0;
      return { chunk_id, score: score * boost };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Full hybrid search: BM25 + vector → RRF → topK.
 */
export function hybridSearch(
  query: string,
  queryEmbedding: Float32Array | null,
  hivFile: HIVFile,
  lang = 'en',
  topK = 5
): HIVChunk[] {
  const bm25 = bm25Search(query, hivFile, lang, 20);
  const vector = queryEmbedding
    ? vectorSearch(queryEmbedding, hivFile, 20)
    : [];

  const fused = rrfFuse(bm25, vector, hivFile.manifest, hivFile.chunks);
  const topIds = fused.slice(0, topK).map((r) => r.chunk_id);

  const chunkMap = new Map(hivFile.chunks.map((c) => [c.id, c]));
  return topIds.map((id) => chunkMap.get(id)).filter(Boolean) as HIVChunk[];
}

/* ─── Helpers ─── */

function dequantize(int8Vec: Int8Array): Float32Array {
  const f32 = new Float32Array(int8Vec.length);
  for (let i = 0; i < int8Vec.length; i++) {
    f32[i] = int8Vec[i] / 127.0;
  }
  return f32;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}
