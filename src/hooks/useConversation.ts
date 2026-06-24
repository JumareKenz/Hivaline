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
  if (hivFile && !engineRef.current) {
    engineRef.current = new ConversationEngine(hivFile);

    // Expose debug utilities in development mode
    if (import.meta.env.DEV) {
      (window as any).__hiva_report = () => {
        if (!engineRef.current) return 'Engine not initialized';
        const report = engineRef.current.debugHivReport();
        console.log(report);
        return report;
      };

      (window as any).__hiva_state = () => {
        if (!engineRef.current) return 'Engine not initialized';
        const state = engineRef.current.getState();
        const sessionState = (engineRef.current as any).sessionState;
        const debug = {
          currentTopic: sessionState?.currentTopic,
          turnCount: state.turnCount,
          coveredAspects: sessionState?.coveredAspects ? [...sessionState.coveredAspects] : [],
          pendingGaps: sessionState?.pendingGaps || [],
          slotMemory: sessionState?.slotMemory,
          lastClosingLine: sessionState?.lastClosingLine,
          sentimentHistory: sessionState?.sentimentHistory || [],
        };
        console.log(JSON.stringify(debug, null, 2));
        return debug;
      };

      // Use getter to always return current engine reference
      Object.defineProperty(window, '__hiva_engine', {
        get: () => engineRef.current,
        configurable: true,
      });
    }
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
