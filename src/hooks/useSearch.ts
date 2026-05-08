/**
 * useSearch — .hiv-powered hybrid search + warm conversational response builder
 *
 * If a .hiv file is loaded → uses BM25 + vector hybrid search + chunk renderers.
 * If no .hiv file → falls back to legacy keyword matcher.
 * Always prioritizes danger_signs, adds source attribution, suggests related chunks.
 */

import { useCallback, useMemo } from 'react';
import type { ChatMessage, HIVChunk, HIVChunkType } from '@/types/hiv';
import { useHIVFile } from './useHIVFile';
import { hybridSearch } from '@/services/searchEngine';
import { renderChunk, buildNoResultMessage, getChunkPreview } from '@/services/responseRenderer';
import { embedQuery } from '@/services/onnxEmbedder';
import { MOCK_RESPONSE_RULES, FALLBACK_RESPONSE } from '@/data/mockResponses';
import { normalizeInput } from '@/utils/formatters';

export interface SearchResult {
  response: Omit<ChatMessage, 'id' | 'timestamp'>;
  source?: { document: string; span?: string };
  related?: Array<{ id: string; type: HIVChunkType; preview: string }>;
}

export const useSearch = () => {
  const { file, isLoading } = useHIVFile();

  const hasHIVFile = useMemo(() => !!file && !isLoading, [file, isLoading]);

  const searchResponse = useCallback(
    async (input: string): Promise<SearchResult> => {
      if (hasHIVFile && file) {
        return searchHIV(input, file);
      }

    // Fallback: legacy keyword matcher
    const legacy = legacySearch(input);
    return {
      response: {
        ...legacy,
        sender: 'hiva' as const,
      },
    };
    },
    [hasHIVFile, file]
  );

  return { searchResponse };
};

/* ─── .hiv Hybrid Search ─── */

async function searchHIV(query: string, file: NonNullable<ReturnType<typeof useHIVFile>['file']>): Promise<SearchResult> {
  const lang = 'en';

  // Danger signs always first
  const dangerFirst = (results: HIVChunk[]): HIVChunk[] => [
    ...results.filter((c) => c.type === 'danger_sign'),
    ...results.filter((c) => c.type !== 'danger_sign'),
  ];

  // Try vector search if embedder is ready, otherwise BM25-only
  let queryEmbedding: Float32Array | null = null;
  try {
    queryEmbedding = await embedQuery(query);
  } catch {
    queryEmbedding = null;
  }

  const results = hybridSearch(query, queryEmbedding, file, lang, 3);

  if (results.length === 0) {
    return {
      response: {
        type: 'text',
        content: buildNoResultMessage(),
        sender: 'hiva',
      },
    };
  }

  const prioritized = dangerFirst(results);
  const primary = prioritized[0];
  const rendered = renderChunk(primary, lang);

  // Build related suggestions from remaining results
  const related = prioritized.slice(1).map((c) => ({
    id: c.id,
    type: c.type,
    preview: getChunkPreview(c, lang),
  }));

  return {
    response: {
      type: rendered.type as ChatMessage['type'],
      content: rendered.content,
      sender: 'hiva',
      metadata: {
        artifactId: primary.id,
        topic: rendered.type,
        source: rendered.source?.document,
      },
    },
    source: rendered.source,
    related,
  };
}

/* ─── Legacy Keyword Matcher (fallback) ─── */

function legacySearch(input: string): Omit<ChatMessage, 'id' | 'timestamp' | 'sender'> {
  const normalized = normalizeInput(input);
  const tokens = normalized.split(/\s+/).filter(Boolean);

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of MOCK_RESPONSE_RULES) {
    let score = 0;
    for (const token of tokens) {
      for (const keyword of rule.keywords) {
        if (keyword.includes(token) || token.includes(keyword)) {
          score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  if (bestMatch && bestScore >= 1) {
    return bestMatch.response;
  }

  return FALLBACK_RESPONSE;
}
