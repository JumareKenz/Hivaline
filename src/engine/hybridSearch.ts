/**
 * hybridSearch.ts — Three-stage search with BM25, vector similarity, and gap graph traversal
 *
 * Fuses BM25 (existing), vector similarity (new), and gap graph boost (new),
 * then ranks results using RRF (Reciprocal Rank Fusion).
 *
 * Vector search uses a 3-tier fallback strategy:
 *   1. On-device embedding model (real semantic search) — best quality
 *   2. Variant embeddings (pre-computed dense vectors for question_variants)
 *   3. Query proxy matching via Jaccard (legacy fallback)
 */

import type SessionState from './sessionState';
import type { VariantEmbeddingRecord } from '@/types/hiv';

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
  chunks?: Array<{ id: string; type?: string; display_title?: string; aspects?: string[]; content?: Record<string, unknown> }>;
  variantEmbeddings?: Float32Array | null;
  variantEmbeddingsIndex?: VariantEmbeddingRecord[] | null;
  variantCount?: number;
  embeddingDims?: number;
  chunkTitleMap?: Map<string, string>;
  chunkContentMap?: Map<string, string>;
  coverageManifest?: Record<string, unknown> | null;
}

export interface SearchResult {
  chunkId: string;
  score: number;
}

export interface SearchDiagnostics {
  topBm25Score: number | null;
  topVectorScore: number | null;
  fusedScore: number | null;
  vectorGatePassed: boolean;
  confidenceGateFired: boolean;
  /** Relative margin between top and second vector result: (top - second) / second. Null if < 2 results. */
  vectorMargin: number | null;
}

export type VectorTier = 'embedding_model' | 'variant_embeddings' | 'proxy_jaccard' | 'none';

let lastVectorTier: VectorTier = 'none';
let lastDiagnostics: SearchDiagnostics = {
  topBm25Score: null,
  topVectorScore: null,
  fusedScore: null,
  vectorGatePassed: false,
  confidenceGateFired: false,
  vectorMargin: null,
};

/** Returns which vector search tier served the most recent query. */
export function getLastVectorTier(): VectorTier {
  return lastVectorTier;
}

/** Returns diagnostics from the most recent search call. */
export function getLastSearchDiagnostics(): SearchDiagnostics {
  return lastDiagnostics;
}

let globalAssets: HIVAssets | null = null;

/**
 * Initialize search assets from parsed .hiv. Call once on .hiv load, not on every query.
 * @param hivAssets — parsed assets from the .hiv file
 */
export function initSearch(hivAssets: HIVAssets): void {
  globalAssets = hivAssets;
}

const PROXY_STOP_WORDS = new Set([
  'what', 'whats', 'how', 'when', 'where', 'why', 'who', 'which',
  'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'the', 'an', 'of', 'to', 'for', 'in', 'on',
  'it', 'its', 'my', 'me', 'we', 'us', 'our', 'you', 'your',
  'that', 'this', 'these', 'those',
  'overview', 'definition', 'about', 'tell',
]);

/**
 * Tokenize a string into unigrams (strips punctuation to match BM25 behavior).
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter((t) => t.length >= 2);
}

/**
 * Tokenize for Jaccard computation, excluding stop words that add no
 * discriminative value (especially those injected by the query rewriter).
 */
function tokenizeForJaccard(text: string): string[] {
  return tokenize(text).filter(t => !PROXY_STOP_WORDS.has(t));
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
 * Inject a query embedding function for testing or when the model is available.
 * In production, this is set by the conversationEngine when the model is ready.
 */
let embedQueryFn: ((text: string) => Promise<Float32Array>) | null = null;

export function setEmbedQueryFn(fn: ((text: string) => Promise<Float32Array>) | null): void {
  embedQueryFn = fn;
}

/**
 * Tier 1: Real semantic vector search using on-device embedding model.
 * Embeds the query and computes cosine similarity against all chunk embeddings.
 */
async function denseVectorSearch(queryEmbedding: Float32Array, topK = 10): Promise<SearchResult[]> {
  const assets = globalAssets;
  if (!assets?.embeddingsBuffer || !assets.embeddingsIndex) return [];

  const dims = assets.embeddingsIndex.dimensions ?? 384;
  const totalChunks = assets.embeddingsIndex.total_chunks ?? 0;
  const float32View = new Float32Array(assets.embeddingsBuffer);

  const results: SearchResult[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * dims;
    const chunkVec = float32View.subarray(offset, offset + dims);
    const score = cosineSimilarity(queryEmbedding, chunkVec);
    const chunkId = assets.embeddingsIndex.chunk_ids?.[i] ?? String(i);
    results.push({ chunkId, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Tier 2: Variant embedding search — cosine similarity against pre-computed
 * variant embeddings (question_variants, trigger_phrases, display_titles).
 * Returns the best-matching chunk via its variant vectors.
 */
async function variantEmbeddingSearch(queryEmbedding: Float32Array, topK = 10): Promise<SearchResult[]> {
  const assets = globalAssets;
  if (!assets?.variantEmbeddings || !assets.variantEmbeddingsIndex) return [];

  const dims = assets.embeddingDims ?? 384;
  const variantCount = assets.variantCount ?? 0;
  if (variantCount === 0 || dims === 0) return [];

  const chunkScores = new Map<string, number>();

  for (let i = 0; i < variantCount; i++) {
    const offset = i * dims;
    const variantVec = assets.variantEmbeddings.subarray(offset, offset + dims);
    const score = cosineSimilarity(queryEmbedding, variantVec);

    const record = assets.variantEmbeddingsIndex[i];
    if (!record) continue;

    const existing = chunkScores.get(record.chunk_id) ?? 0;
    if (score > existing) {
      chunkScores.set(record.chunk_id, score);
    }
  }

  return Array.from(chunkScores.entries())
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Tier 3 (legacy): Vector search using query proxies.
 * Finds best-matching proxy by Jaccard similarity, then cosine-similarity against all chunk vectors.
 *
 * Safety gate: if the best Jaccard score is below the floor, the match is
 * essentially random — return empty rather than serving potentially wrong
 * clinical content during model warmup. Set at 0.18 to catch purely noise
 * matches (shared stop words like "what", "is") while allowing short queries
 * where a single specific clinical term (e.g. "dose") is the only overlap.
 */
const PROXY_JACCARD_FLOOR = 0.18;

function proxyVectorSearch(rewrittenQuery: string, topK = 10): SearchResult[] {
  const assets = globalAssets;
  if (!assets?.queryProxies || !assets.embeddingsBuffer || !assets.embeddingsIndex) {
    return [];
  }

  const queryTokens = new Set(tokenizeForJaccard(rewrittenQuery));

  let bestProxy: number[] | null = null;
  let bestJaccard = -1;

  for (const [proxyText, proxyVector] of Object.entries(assets.queryProxies)) {
    const proxyTokens = new Set(tokenizeForJaccard(proxyText));
    const inter = setIntersection(queryTokens, proxyTokens).length;
    const union = new Set([...queryTokens, ...proxyTokens]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard > bestJaccard) {
      bestJaccard = jaccard;
      bestProxy = proxyVector;
    }
  }

  if (!bestProxy) return [];

  if (bestJaccard < PROXY_JACCARD_FLOOR) return [];

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
 * Unified vector search with 3-tier fallback:
 *   1. On-device embedding model (if embedQueryFn is set and model ready)
 *   2. Variant embeddings (if .hiv contains variant_embeddings.bin)
 *   3. Query proxy Jaccard matching (legacy)
 */
async function vectorSearch(rewrittenQuery: string, _language: string, topK = 10): Promise<SearchResult[]> {
  // Tier 1: real embedding model
  if (embedQueryFn) {
    try {
      const queryEmbedding = await embedQueryFn(rewrittenQuery);
      if (queryEmbedding && queryEmbedding.length > 0) {
        // Try dense chunk search first
        const denseResults = await denseVectorSearch(queryEmbedding, topK);
        if (denseResults.length > 0) {
          lastVectorTier = 'embedding_model';
          return denseResults;
        }

        // Try variant embeddings as secondary dense path
        const variantResults = await variantEmbeddingSearch(queryEmbedding, topK);
        if (variantResults.length > 0) {
          lastVectorTier = 'variant_embeddings';
          return variantResults;
        }
      }
    } catch {
      // Embedding failed — fall through to lower tiers
    }
  }

  // Tier 3: legacy proxy search
  const proxyResults = proxyVectorSearch(rewrittenQuery, topK);
  lastVectorTier = proxyResults.length > 0 ? 'proxy_jaccard' : 'none';
  return proxyResults;
}

/**
 * Boost BM25 results that match a query's drug-class term.
 * When a query contains "ARV", "ACT", "TPT", etc.:
 *   1. Boost chunks (drug_table, protocol, definition, faq) that contain that drug class → 1.4x
 *   2. Demote generic "dosage" or "medication" chunks that DON'T contain the drug class → 0.6x
 *
 * Applied before fusion (Stage 1b), so boosting/demoting is baked into BM25 before RRF.
 */
function boostDrugClassInBm25(
  bm25Results: SearchResult[],
  query: string,
  chunks: Array<{ id: string; type?: string; display_title?: string; content?: Record<string, unknown> }> | undefined
): SearchResult[] {
  if (!chunks) return bm25Results;

  const DRUG_CLASSES = {
    arv: [
      'arv', 'antiretroviral', 'art', 'hiv.*treatment', 'hiv.*drug',
      'dolutegravir', 'dtg', 'efavirenz', 'efv', 'nevirapine', 'nvp',
      'lopinavir', 'ltv', 'ritonavir', 'rtv', 'tenofovir', 'tdf',
      'lamivudine', '3tc', 'abacavir', 'abc', 'raltegravir', 'ral',
      'emtricitabine', 'ftc', 'bictegravir', 'btk'
    ],
    act: ['act', 'artemisinin', 'coartem', 'lumefantrine'],
    tpt: ['tpt', 'preventive therapy', 'preventive treatment'],
    cpt: ['cpt', 'cotrimoxazole', 'ctx', 'bactrim'],
    prep: ['prep', 'pre-exposure'],
  };

  // Types that should receive drug-class boost if they match the drug class
  const boostableTypes = new Set(['drug_table', 'protocol', 'definition', 'faq']);

  const queryLower = query.toLowerCase();
  const matchedClasses = new Set<string>();
  for (const [className, terms] of Object.entries(DRUG_CLASSES)) {
    for (const term of terms) {
      if (queryLower.includes(term)) {
        matchedClasses.add(className);
        break;
      }
    }
  }

  if (matchedClasses.size === 0) return bm25Results;

  const boosted = bm25Results.map((r) => {
    const chunk = chunks.find((ch) => ch.id === r.chunkId);
    if (!chunk || !boostableTypes.has(chunk.type ?? '')) return r;

    const chunkText = (
      (chunk.display_title ?? '') + ' ' +
      JSON.stringify(chunk.content ?? '')
    ).toLowerCase();

    // Check if chunk mentions any matched drug class term
    let hasDrugClass = false;
    for (const className of matchedClasses) {
      const terms = DRUG_CLASSES[className as keyof typeof DRUG_CLASSES];
      for (const term of terms) {
        // Handle regex patterns (e.g., 'hiv.*treatment') vs literal strings
        if (term.includes('*')) {
          if (new RegExp(term, 'i').test(chunkText)) {
            hasDrugClass = true;
            break;
          }
        } else {
          if (chunkText.includes(term)) {
            hasDrugClass = true;
            break;
          }
        }
      }
      if (hasDrugClass) break;
    }

    if (hasDrugClass) {
      // Chunk specifically mentions the drug class — boost it
      return { ...r, score: r.score * 1.4 };
    } else if (
      // Generic dosage chunk without the specific drug class mentioned
      /dosage|medication|dose|medicine|drug.*name/i.test(chunk.display_title ?? '')
    ) {
      // Demote generic chunks when querying for specific drug classes
      return { ...r, score: r.score * 0.6 };
    }

    return r;
  });

  // Re-sort by score after applying boosts/demotions
  return boosted.sort((a, b) => b.score - a.score);
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
 *
 * Applies a rare-term anchor boost: when a query contains a highly-specific term
 * (≤ 5 postings, alphabetic, 4+ chars — typically a drug name or condition),
 * chunks matching that anchor term get a bonus. This prevents generic weight-band
 * or dosage chunks from outranking drug-specific chunks when both share common
 * terms like "dose", "child", "15kg", but only one matches the actual drug name.
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

  // Rare-term anchor: identify highly-specific terms in the query
  // (alphabetic, 4+ chars, ≤5 postings — typically drug names, conditions, procedures).
  // Chunks matching an anchor get boosted; chunks NOT matching any anchor get demoted.
  // This prevents generic weight-band or parameter-matching chunks from outranking
  // drug-specific chunks when both score similarly on common terms.
  const anchorTerms: string[] = [];
  const anchorChunks = new Set<string>();
  for (const term of terms) {
    if (term.length < 4 || !/^[a-z]+$/i.test(term)) continue;
    const postings = idx[term] || [];
    if (postings.length > 0 && postings.length <= 5) {
      anchorTerms.push(term);
      for (const { chunk_id } of postings) {
        anchorChunks.add(chunk_id);
      }
    }
  }

  if (anchorTerms.length > 0 && anchorChunks.size > 0) {
    for (const [chunkId, score] of Object.entries(scores)) {
      if (anchorChunks.has(chunkId)) {
        scores[chunkId] = score * 1.3;
      } else {
        scores[chunkId] = score * 0.7;
      }
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
/**
 * Check whether the vector search results have a confident top match.
 * Returns true if the top result's score is meaningfully separated from the rest,
 * indicating the vector tier has a strong opinion. When false, vector results
 * should be excluded from fusion to avoid degrading a strong BM25 match.
 *
 * Thresholds:
 * - Minimum absolute score: 0.3 cosine (below this, the match is essentially random)
 * - Minimum margin: top score must exceed second-best by at least 10%
 */
function isVectorSignalConfident(vectorResults: SearchResult[]): boolean {
  if (vectorResults.length === 0) return false;

  const topScore = vectorResults[0].score;

  // Absolute floor: cosine < 0.3 means the embedding sees no meaningful similarity
  if (topScore < 0.3) return false;

  // Margin check: top result should separate from the pack
  if (vectorResults.length >= 2) {
    const secondScore = vectorResults[1].score;
    // If top and second are within 10% of each other, the vector has no clear winner.
    // At 5% margin, embedding clusters of similar-topic chunks (e.g., all pediatric
    // dosing chunks) pass the gate and pollute correct BM25 drug-name matches.
    if (secondScore > 0 && (topScore - secondScore) / secondScore < 0.10) return false;
  }

  return true;
}

/**
 * Minimum absolute BM25 score floor. If the top BM25 result scores below this,
 * the match is likely coincidental (shared generic terms like "dose", "child").
 * Without this floor, a BM25 match on a single generic term can produce a
 * confident-looking answer on a completely unrelated topic.
 */
const BM25_ABSOLUTE_FLOOR = 1.5;

export async function search(rewrittenQuery: string, sessionState: SessionState, language = 'en', hivAssets?: HIVAssets, bm25Query?: string): Promise<SearchResult | null> {
  const assets = hivAssets || globalAssets || {};

  // Stage 1: BM25 — use the narrative-normalized query if provided, otherwise the full rewritten query.
  // Vector search always gets the full rewritten query (embeddings handle narrative well).
  let bm25 = bm25Search(bm25Query || rewrittenQuery, language, assets.bm25Index);

  // Stage 1b: Drug-class boost on BM25 results (pre-fusion)
  // Applied before vector fusion so the boost is baked into ranking early
  bm25 = boostDrugClassInBm25(bm25, rewrittenQuery, assets.chunks);

  // Stage 2: Vector search (3-tier: embedding model → variant embeddings → proxy)
  const vector = await vectorSearch(rewrittenQuery, language, 10);

  // Stage 3: Confidence gate — manages two distinct failure modes:
  //   (a) BM25 present + noisy vector: gate vector out to protect BM25 accuracy
  //   (b) BM25 absent + embedding model not warm: proxy results may be random
  // In case (b), only trust proxy if its cosine scores show clear separation.
  const hasBm25Fallback = bm25.length > 0;
  let useVector: boolean;
  if (hasBm25Fallback) {
    // BM25 exists — only include vector if it has a confident discriminative signal
    useVector = isVectorSignalConfident(vector);
  } else {
    // No BM25 — vector is all we have. Always use it; the embedding model or
    // proxy is the only retrieval path available.
    useVector = vector.length > 0;
  }
  const vectorForFusion = useVector ? vector : [];

  // Record diagnostics for logging
  const topBm25Score = bm25.length > 0 ? bm25[0].score : null;
  const topVectorScore = vector.length > 0 ? vector[0].score : null;
  const vectorMargin: number | null = (vector.length >= 2 && vector[1].score > 0)
    ? (vector[0].score - vector[1].score) / vector[1].score
    : null;


  // Stage 4: Confidence floor — "I don't know" path.
  // If all available signals are weak, return null rather than serving a
  // low-confidence match that looks authoritative to the user.
  const bm25Confident = topBm25Score !== null && topBm25Score >= BM25_ABSOLUTE_FLOOR;
  const vectorConfident = useVector && topVectorScore !== null && topVectorScore >= 0.3;
  if (!bm25Confident && !vectorConfident) {
    lastDiagnostics = {
      topBm25Score,
      topVectorScore,
      fusedScore: null,
      vectorGatePassed: useVector,
      confidenceGateFired: true,
      vectorMargin,
    };
    return null;
  }

  // Stage 5: Gap graph boost — applied after RRF fusion
  const lastChunkId = sessionState.turnBuffer.length > 0
    ? sessionState.turnBuffer[sessionState.turnBuffer.length - 1].chunkId
    : null;

  // Stage 6: RRF fusion on the separate ranked lists
  const fused = rrfFuse(bm25, vectorForFusion);

  // Stage 7: Gap graph boost — applied after fusion
  const boosted = gapGraphBoost(fused, lastChunkId, assets.gapGraph);

  // Stage 8: Dead-end escape
  const result = deadEndEscape(boosted, sessionState, assets.gapGraph);

  lastDiagnostics = {
    topBm25Score,
    topVectorScore,
    fusedScore: result?.score ?? null,
    vectorGatePassed: useVector,
    confidenceGateFired: false,
    vectorMargin,
  };

  return result;
}
