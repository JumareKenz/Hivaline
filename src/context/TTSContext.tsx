/**
 * TTSContext.tsx — Text-to-Speech state management
 */

import React, { createContext, useState, useCallback, useEffect } from 'react';
import { ttsService, type TTSState } from '@/services/ttsService';
import { TTS_STORAGE_KEY, DEFAULT_TTS_SETTINGS } from '@/utils/constants';

interface TTSContextValue extends TTSState {
  toggleEnabled: () => void;
  setEnabled: (enabled: boolean) => void;
  setVoice: (voiceURI: string) => void;
  speak: (text: string) => void;
  cancel: () => void;
}

export const TTSContext = createContext<TTSContextValue | null>(null);

export const TTSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<TTSState>(() => {
    let enabled = DEFAULT_TTS_SETTINGS.enabled;
    let voiceURI = DEFAULT_TTS_SETTINGS.voiceURI;

    const stored = localStorage.getItem(TTS_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { enabled?: boolean; voiceURI?: string | null };
        enabled = parsed.enabled ?? enabled;
        voiceURI = parsed.voiceURI ?? voiceURI;
      } catch {
        /* Invalid stored settings — ignore */
      }
    }

    ttsService.setEnabled(enabled);
    if (voiceURI) ttsService.setVoice(voiceURI);

    return ttsService.getState();
  });

  useEffect(() => {
    const unsubscribe = ttsService.subscribe((svcState) => {
      setState(svcState);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    localStorage.setItem(
      TTS_STORAGE_KEY,
      JSON.stringify({
        enabled: state.isEnabled,
        voiceURI: state.selectedVoiceURI,
      })
    );
  }, [state.isEnabled, state.selectedVoiceURI]);

  const toggleEnabled = useCallback(() => {
    ttsService.setEnabled(!ttsService.isEnabled());
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    ttsService.setEnabled(enabled);
  }, []);

  const setVoice = useCallback((voiceURI: string) => {
    ttsService.setVoice(voiceURI);
  }, []);

  const speak = useCallback((text: string) => {
    ttsService.speak(text);
  }, []);

  const cancel = useCallback(() => {
    ttsService.cancel();
  }, []);

  return (
    <TTSContext.Provider
      value={{ ...state, toggleEnabled, setEnabled, setVoice, speak, cancel }}
    >
      {children}
    </TTSContext.Provider>
  );
};
