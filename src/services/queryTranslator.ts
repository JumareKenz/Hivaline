/**
 * queryTranslator.ts — Translate non-English queries to English before embedding
 *
 * Addresses the Hausa performance problem (50% Recall@1) by translating Nigerian
 * languages to English BEFORE embedding with MiniLM. This keeps the proven 118MB
 * MiniLM model instead of deploying the 450MB LaBSE model (which showed no
 * improvement and 2.4× latency penalty).
 *
 * Architecture:
 * 1. Detect query language (Hausa, Yoruba, Igbo, Pidgin)
 * 2. If non-English: translate to English via on-device Qwen2.5-1.5B
 * 3. Embed the ENGLISH translation with MiniLM
 * 4. Search proceeds normally
 *
 * Translation latency (~500ms) only affects non-English queries, not English.
 * Falls back to original query if translation fails (better than blocking).
 */

import { translateQuery, isEdgeBrainReady, loadEdgeBrain } from './edgeBrainService';
import { reportError } from './telemetry';

export type QueryLanguage = 'en' | 'ha' | 'yo' | 'ig' | 'pid' | 'unknown';

export interface TranslationResult {
  originalQuery: string;
  language: QueryLanguage;
  translatedQuery: string | null;
  latencyMs: number;
  error: string | null;
}

/**
 * Detect the language of a query.
 * Simple heuristic-based detection (sufficient for Nigerian language context).
 */
export function detectLanguage(query: string): QueryLanguage {
  const q = query.toLowerCase().trim();

  // Hausa indicators (exclude very short/ambiguous words)
  const hausaMarkers = [
    'yaya', 'yadda', 'wane', 'wanda', 'alamun', 'alamomin', 'adadin', 'maganin',
    'yara', 'jariri', 'ciwon', 'zazzabin', 'cizon', 'sauro', 'hatsari', 'cututtukan',
    'jiki', 'fara', 'ake',
  ];

  // Yoruba indicators
  const yorubaMarkers = [
    'bawo', 'ṣe', 'le', 'bẹrẹ', 'itọju', 'ami', 'aisan', 'iba', 'iwọn',
    'oogun', 'ọmọde', 'ewu', 'tuntun', 'àti', 'àwọn', 'ni', 'ní', 'sí',
  ];

  // Igbo indicators
  const igboMarkers = [
    'kedu', 'ka', 'esi', 'amalite', 'ọgwụgwọ', 'ihe', 'ngosi', 'nke', 'ọrịa',
    'usoro', 'maka', 'ụmụaka', 'ize', 'ndụ', 'ọhụrụ', 'amụrụ', 'na', 'bụ',
  ];

  // Pidgin indicators (avoid common English words)
  const pidginMarkers = [
    'wetin', 'pikin', 'dey', 'palava', 'wahala', 'abi', 'shey', 'una', 'no be',
  ];

  // Count matches for each language
  const hausaCount = hausaMarkers.filter(m => q.includes(m)).length;
  const yorubaCount = yorubaMarkers.filter(m => q.includes(m)).length;
  const igboCount = igboMarkers.filter(m => q.includes(m)).length;
  const pidginCount = pidginMarkers.filter(m => q.includes(m)).length;

  // Decision: highest match count wins (minimum 2 matches required)
  const maxCount = Math.max(hausaCount, yorubaCount, igboCount, pidginCount);
  if (maxCount >= 2) {
    if (hausaCount === maxCount) return 'ha';
    if (yorubaCount === maxCount) return 'yo';
    if (igboCount === maxCount) return 'ig';
    if (pidginCount === maxCount) return 'pid';
  }

  // Default to English (most queries are English, don't over-detect)
  return 'en';
}

/**
 * Translate a non-English query to English using on-device Qwen model.
 * Returns original query if translation fails (degraded but not blocked).
 */
export async function translateToEnglish(
  query: string,
  detectedLanguage: QueryLanguage
): Promise<TranslationResult> {
  const startTime = performance.now();

  // No translation needed for English
  if (detectedLanguage === 'en') {
    return {
      originalQuery: query,
      language: 'en',
      translatedQuery: null, // null means "no translation needed"
      latencyMs: 0,
      error: null,
    };
  }

  try {
    // Ensure model is loaded
    if (!(await isEdgeBrainReady())) {
      await loadEdgeBrain();
    }

    const translation = await translateQuery(query, detectedLanguage, 128, 0.1);

    // Validation: translation should be non-empty and different from original
    if (!translation || translation === query) {
      throw new Error('Translation output is empty or unchanged');
    }

    const latencyMs = performance.now() - startTime;

    return {
      originalQuery: query,
      language: detectedLanguage,
      translatedQuery: translation,
      latencyMs,
      error: null,
    };
  } catch (err) {
    const latencyMs = performance.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Log error but don't throw - fallback to original query
    reportError('query_translation_failed', errorMsg);

    // eslint-disable-next-line no-console
    console.warn(`[QueryTranslator] Translation failed for ${detectedLanguage} query, using original:`, errorMsg);

    return {
      originalQuery: query,
      language: detectedLanguage,
      translatedQuery: query, // Fallback: use original query
      latencyMs,
      error: errorMsg,
    };
  }
}

/**
 * Main entry point: detect language and translate if needed.
 * Returns the query to use for embedding (either original or translated).
 */
export async function prepareQueryForEmbedding(query: string): Promise<TranslationResult> {
  const language = detectLanguage(query);
  return translateToEnglish(query, language);
}
