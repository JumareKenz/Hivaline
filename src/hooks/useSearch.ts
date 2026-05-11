/**
 * useSearch — .hiv-powered hybrid search with question variants support
 *
 * Uses content[lang].question_variants for improved matching.
 * Includes tone selection (direct/formal/reassuring/urgent).
 * Handles: single match, multiple matches (disambiguation), no match cases.
 */

import { useCallback, useMemo } from 'react';
import type { ChatMessage, HIVChunk, HIVChunkType } from '@/types/hiv';
import { useHIVFile } from './useHIVFile';
import { hybridSearch, variantSearch } from '@/services/searchEngine';
import { renderChunk, getChunkPreview } from '@/services/responseRenderer';

export interface SearchResult {
  response: Omit<ChatMessage, 'id' | 'timestamp'>;
  source?: { document: string; span?: string };
  related?: Array<{ id: string; type: HIVChunkType; preview: string }>;
  disambiguation?: Array<{ id: string; type: HIVChunkType; label: string }>;
}

export const useSearch = () => {
  const { file, isLoading } = useHIVFile();

  const hasHIVFile = useMemo(() => !!file && !isLoading, [file, isLoading]);

  const searchResponse = useCallback(
    async (input: string): Promise<SearchResult> => {
      console.log('[useSearch] hasHIVFile:', hasHIVFile, 'file:', !!file, 'input:', input);
      
      if (hasHIVFile && file) {
        return searchWithVariants(input, file);
      }

      console.log('[useSearch] No file, showing fallback message');
      return {
        response: {
          type: 'text',
          content: 'No clinical data loaded. Please log in to download the latest .hiv file from the server.',
          sender: 'hiva' as const,
        },
      };
    },
    [hasHIVFile, file]
  );

  return { searchResponse };
};

/* ─── Search with Question Variants ─── */

type ToneType = 'direct' | 'formal' | 'reassuring' | 'urgent';

/**
 * Detect user query tone to select appropriate answer variant
 */
function detectQueryTone(query: string): ToneType {
  const lower = query.toLowerCase();
  
  // Urgent indicators
  if (/\b(emergency|urgent|immediately|critical|danger|seizure|unconscious|bleeding|cant breathe)\b/.test(lower)) {
    return 'urgent';
  }
  
  // Reassuring/soft indicators
  if (/\b(worried|scared|afraid|concern|nervous|hope|please|maybe|perhaps)\b/.test(lower)) {
    return 'reassuring';
  }
  
  // Direct/short query indicators
  if (/\b(what is|how to|when|where|which|who|give me|tell me)\b/.test(lower) && lower.length < 50) {
    return 'direct';
  }
  
  // Default to formal
  return 'formal';
}

function searchWithVariants(query: string, file: NonNullable<ReturnType<typeof useHIVFile>['file']>): SearchResult {
  const lang = 'en';
  const queryTone = detectQueryTone(query);

  console.log('[useSearch] Starting variant search for:', query, 'tone:', queryTone);
  console.log('[useSearch] File has chunks:', file.chunks.length);

  // First try question_variants search
  const { matches: variantMatches } = variantSearch(query, file, 5);
  console.log('[useSearch] Variant matches:', variantMatches.length);

  // Handle multiple matches - show disambiguation
  if (variantMatches.length > 1) {
    console.log('[useSearch] Multiple matches, showing disambiguation');
    const chunkMap = new Map(file.chunks.map(c => [c.id, c]));
    return {
      response: {
        type: 'text' as const,
        content: 'I found multiple topics that might match your question:',
        sender: 'hiva' as const,
      },
      disambiguation: variantMatches.slice(0, 5).map(m => {
        const chunk = chunkMap.get(m.chunk_id);
        return {
          id: m.chunk_id,
          type: chunk?.type as HIVChunkType || 'protocol',
          label: m.topics?.[0] || m.chunk_id.slice(0, 8),
        };
      }),
    };
  }

  // Single match or fallback
  const match = variantMatches[0];
  let results: HIVChunk[] = [];

  if (match) {
    const chunkMap = new Map(file.chunks.map(c => [c.id, c]));
    const chunk = chunkMap.get(match.chunk_id);
    if (chunk) results = [chunk];
    
    // Use variant match answer with tone selection
    if (match.toneAnswers && match.toneAnswers[queryTone]) {
      console.log('[useSearch] Using tone-matched answer:', queryTone);
      return {
        response: {
          type: 'text' as const,
          content: match.toneAnswers[queryTone],
          sender: 'hiva' as const,
          metadata: {
            artifactId: match.chunk_id,
            topic: match.topics?.[0],
          },
        },
        related: match.topics?.slice(1).map((t, i) => ({
          id: `topic-${i}`,
          type: 'protocol' as HIVChunkType,
          preview: t,
        })) || [],
      };
    }
    
    // Use direct answer if available
    if (match.answer) {
      console.log('[useSearch] Using direct answer from variant');
      return {
        response: {
          type: 'text' as const,
          content: match.answer,
          sender: 'hiva' as const,
          metadata: {
            artifactId: match.chunk_id,
            topic: match.topics?.[0],
          },
        },
        related: match.topics?.slice(1).map((t, i) => ({
          id: `topic-${i}`,
          type: 'protocol' as HIVChunkType,
          preview: t,
        })) || [],
      };
    }
    
    // Use fallback if no answer
    if (match.fallback) {
      console.log('[useSearch] Using fallback from variant');
      return {
        response: {
          type: 'text' as const,
          content: match.fallback,
          sender: 'hiva' as const,
        },
      };
    }
  } else {
    // Fall back to BM25 search
    console.log('[useSearch] No variant match, trying BM25 fallback');
    const bm25Results = hybridSearch(query, null, file, lang, 5);
    results = bm25Results;
  }

  if (results.length === 0) {
    console.log('[useSearch] No results found');
    return {
      response: {
        type: 'text',
        content: "I don't have information on that in the current .hiv file. Try rephrasing or check the Knowledge Base for available topics.",
        sender: 'hiva',
      },
    };
  }

  const primary = results[0];
  console.log('[useSearch] Found result:', primary.id, primary.type);
  
  // Check if chunk has actual content
  const chunkContent = primary.content as Record<string, unknown>;
  const langContent = chunkContent[lang] as Record<string, unknown> | undefined;
  
  // Check for fallback in content
  const contentFallback = langContent?.fallback_response as string | undefined;
  if (contentFallback && !langContent?.answer) {
    return {
      response: {
        type: 'text' as const,
        content: contentFallback,
        sender: 'hiva' as const,
      },
    };
  }
  
  const hasContent = Object.keys(chunkContent).some(k => {
    const val = chunkContent[k];
    return val && (typeof val === 'string' ? val.length > 0 : Object.keys(val as object).length > 0);
  });
  
  if (!hasContent) {
    console.log('[useSearch] Chunk has empty content, showing placeholder');
    return {
      response: {
        type: 'text' as const,
        content: `Found "${primary.type}" entry matching your query, but the clinical content is not yet available in this release. Check for updates in Settings.`,
        sender: 'hiva' as const,
        metadata: {
          artifactId: primary.id,
          topic: primary.type,
        },
      },
    };
  }
  
  const rendered = renderChunk(primary, lang);

  const related = results.slice(1).map((c) => ({
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
