/**
 * variantSearch.ts — Question variant matching for Knowledge Base
 *
 * Builds an in-memory index of question_variants from chunks for fast matching.
 * Used by useSearch hook for Knowledge Base tab, separate from conversation engine.
 */

import type { HIVFile, QueryExecResult } from '@/types/hiv';

/**
 * Variant Index - built at load time from content[lang].question_variants
 */
interface VariantIndex {
  variants: Map<string, Array<{ chunk_id: string; score: number }>>;
  chunkFallbacks: Map<string, string>;
  chunkTopics: Map<string, string[]>;
  chunkAnswers: Map<string, string>;
  chunkToneAnswers: Map<string, Record<string, string>>;
}

const variantIndexCache = new Map<string, VariantIndex>();

function getCacheKey(hivFile: HIVFile): string {
  // Use chunk IDs to create a unique key per file content
  const chunkIds = hivFile.chunks.map(c => c.id).join(',');
  return `${hivFile.manifest.version}-${hivFile.chunks.length}-${chunkIds}`;
}

/**
 * Build in-memory index of all question variants from content[lang] or SQLite DB
 */
function buildVariantIndex(hivFile: HIVFile): VariantIndex {
  const cacheKey = getCacheKey(hivFile);
  const cached = variantIndexCache.get(cacheKey);
  if (cached) return cached;

  const variants = new Map<string, Array<{ chunk_id: string; score: number }>>();
  const chunkFallbacks = new Map<string, string>();
  const chunkTopics = new Map<string, string[]>();
  const chunkAnswers = new Map<string, string>();
  const chunkToneAnswers = new Map<string, Record<string, string>>();

  // Try SQLite first if available
  if (hivFile.db) {
    try {
      buildVariantIndexFromDB(hivFile.db, variants, chunkFallbacks, chunkTopics, chunkAnswers, chunkToneAnswers);
    } catch {
      /* DB index failed, falling back to JSON */
    }
  }

  // Also index from JSON chunks as fallback/supplement
  for (const chunk of hivFile.chunks) {
    const langContent = chunk.content as Record<string, Record<string, unknown>>;

    for (const [, content] of Object.entries(langContent)) {
      if (!content || typeof content !== 'object') continue;

      if (content.fallback_response) {
        chunkFallbacks.set(chunk.id, String(content.fallback_response));
      }
      if (Array.isArray(content.topics)) {
        const existing = chunkTopics.get(chunk.id) ?? [];
        chunkTopics.set(chunk.id, [...existing, ...content.topics.map(String)]);
      }
      if (content.answer) {
        chunkAnswers.set(chunk.id, String(content.answer));
      }
      if (content.primary_question && typeof content.primary_question === 'string') {
        indexVariant(variants, chunk.id, content.primary_question, 5);
      }
      if (Array.isArray(content.question_variants)) {
        for (const variant of content.question_variants) {
          if (typeof variant === 'string') {
            indexVariant(variants, chunk.id, variant, 2);
          }
        }
      }
    }
  }

  const result: VariantIndex = {
    variants,
    chunkFallbacks,
    chunkTopics,
    chunkAnswers,
    chunkToneAnswers
  };
  variantIndexCache.set(cacheKey, result);
  return result;
}

/**
 * Build index from SQLite database
 */
function buildVariantIndexFromDB(
  db: NonNullable<HIVFile['db']>,
  variants: Map<string, Array<{ chunk_id: string; score: number }>>,
  chunkFallbacks: Map<string, string>,
  _chunkTopics: Map<string, string[]>,
  chunkAnswers: Map<string, string>,
  _chunkToneAnswers: Map<string, Record<string, string>>
): void {
  try {
    // Query question_variants table — schema may vary
    let variantResults: QueryExecResult[] = [];
    try {
      variantResults = db.exec('SELECT chunk_id, variant_text FROM question_variants');
    } catch {
      // Try alternative schema
      try {
        variantResults = db.exec('SELECT chunk_id, text FROM question_variants');
      } catch {
        /* No question_variants table */
      }
    }

    if (variantResults.length > 0 && variantResults[0].values.length > 0) {
      for (const row of variantResults[0].values) {
        const chunkId = String(row[0]);
        const variantText = String(row[1]);
        indexVariant(variants, chunkId, variantText, 2);
      }
    }

    // Query chunks for answers and fallbacks
    let chunkResults: QueryExecResult[] = [];
    try {
      chunkResults = db.exec('SELECT id, primary_question, fallback_response, answer FROM chunks');
    } catch {
      try {
        chunkResults = db.exec('SELECT id, content_json FROM chunks');
      } catch {
        /* No chunks table with expected columns */
      }
    }

    if (chunkResults.length > 0 && chunkResults[0].values.length > 0) {
      for (const row of chunkResults[0].values) {
        const chunkId = String(row[0]);

        if (row.length > 1 && typeof row[1] === 'string') {
          // Try to parse content_json if that's the column
          try {
            const parsed = JSON.parse(row[1]);
            if (parsed.primary_question) {
              indexVariant(variants, chunkId, parsed.primary_question, 5);
            }
            if (parsed.fallback_response) {
              chunkFallbacks.set(chunkId, parsed.fallback_response);
            }
            if (parsed.answer) {
              chunkAnswers.set(chunkId, parsed.answer);
            }
          } catch {
            // Not JSON, treat as direct columns
            const primaryQuestion = row[1] ? String(row[1]) : null;
            const fallback = row[2] ? String(row[2]) : null;
            const answer = row[3] ? String(row[3]) : null;

            if (primaryQuestion) {
              indexVariant(variants, chunkId, primaryQuestion, 5);
            }
            if (fallback) {
              chunkFallbacks.set(chunkId, fallback);
            }
            if (answer) {
              chunkAnswers.set(chunkId, answer);
            }
          }
        }
      }
    }
  } catch {
    /* Error querying DB — propagate to caller for fallback */
    throw new Error('SQLite DB indexing failed');
  }
}

function indexVariant(
  variants: Map<string, Array<{ chunk_id: string; score: number }>>,
  chunkId: string,
  text: string,
  baseScore: number
): void {
  const normalized = text.toLowerCase().trim();
  if (normalized.length < 2) return;

  // Tokenize and index each token
  const tokens = normalized.split(/\s+/).filter(t => t.length >= 2);
  for (const token of tokens) {
    const existing = variants.get(token) ?? [];
    existing.push({ chunk_id: chunkId, score: baseScore });
    variants.set(token, existing);
  }

  // Index full phrase (truncated for map key)
  const fullKey = normalized.slice(0, 50);
  const fullExisting = variants.get(fullKey) ?? [];
  fullExisting.push({ chunk_id: chunkId, score: baseScore * 2 });
  variants.set(fullKey, fullExisting);
}

/**
 * Clear variant index cache (for testing)
 */
export function clearVariantIndex(): void {
  variantIndexCache.clear();
}

export interface VariantMatchResult {
  chunk_id: string;
  score: number;
  fallback?: string;
  topics?: string[];
  answer?: string;
  toneAnswers?: Record<string, string>;
}

/**
 * Search using question_variants from content[lang]
 */
export function variantSearch(
  query: string,
  hivFile: HIVFile,
  topK = 5
): { matches: VariantMatchResult[] } {
  const { variants, chunkFallbacks, chunkTopics, chunkAnswers, chunkToneAnswers } = buildVariantIndex(hivFile);

  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (searchTerms.length === 0) {
    return { matches: [] };
  }

  const scores: Record<string, number> = {};

  // Match against indexed variants
  for (const term of searchTerms) {
    // Check for exact variant match first
    const exactMatches = variants.get(term) ?? [];
    for (const { chunk_id, score } of exactMatches) {
      scores[chunk_id] = (scores[chunk_id] ?? 0) + score * 2;
    }

    // Check for prefix matches
    for (const [key, postings] of variants) {
      if (key.startsWith(term) || term.startsWith(key)) {
        for (const { chunk_id, score } of postings) {
          scores[chunk_id] = (scores[chunk_id] ?? 0) + score;
        }
      }
    }
  }

  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([chunk_id, score]) => ({
      chunk_id,
      score,
      fallback: chunkFallbacks.get(chunk_id),
      topics: chunkTopics.get(chunk_id),
      answer: chunkAnswers.get(chunk_id),
      toneAnswers: chunkToneAnswers.get(chunk_id),
    }));

  return { matches: sorted };
}
