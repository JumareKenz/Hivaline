/**
 * useConversation.ts — React hook for the ConversationEngine
 *
 * Wraps the engine in a React-friendly interface with state management.
 */

import { useRef, useCallback, useState } from 'react';
import type { HIVFile, EngineResponse, ConversationState } from '@/types/hiv';
import { ConversationEngine } from '@/services/conversationEngine';

export interface UseConversationReturn {
  respond: (message: string) => Promise<EngineResponse>;
  reset: () => void;
  state: ConversationState | null;
  isLoading: boolean;
}

export function useConversation(hivFile: HIVFile | null): UseConversationReturn {
  const engineRef = useRef<ConversationEngine | null>(null);
  const [state, setState] = useState<ConversationState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize or update engine when hivFile changes
  if (hivFile && (!engineRef.current || engineRef.current.getState().turnCount === 0)) {
    engineRef.current = new ConversationEngine(hivFile);
  }

  const respond = useCallback(async (message: string): Promise<EngineResponse> => {
    if (!engineRef.current) {
      return {
        message: 'Clinical data not loaded. Please log in first.',
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: [],
      };
    }

    setIsLoading(true);
    try {
      const response = await engineRef.current.respond(message);
      setState(engineRef.current.getState());
      return response;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.reset();
      setState(engineRef.current.getState());
    }
  }, []);

  return { respond, reset, state, isLoading };
}
