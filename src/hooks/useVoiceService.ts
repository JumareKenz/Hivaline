/**
 * useVoiceService — voice interaction hook
 *
 * Uses Web Speech API (STT) as the transcription backend.
 * Sherpa-ONNX voiceEngine remains as a future upgrade path.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { sttService } from '@/services/sttService';

export type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'error';

interface VoiceServiceReturn {
  state: VoiceState;
  error: string | null;
  isSupported: boolean;
  audioBlob: Blob | null;
  transcript: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  playAudio: (blob: Blob) => void;
  stopAudio: () => void;
  reset: () => void;
}

export const useVoiceService = (): VoiceServiceReturn => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const audioBlob = null; // Kept for API compatibility; STT handles its own audio capture

  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setIsSupported(sttService.isSupported());
  }, []);

  useEffect(() => {
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      sttService.abort();
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript(null);
    setState('recording');

    if (unsubRef.current) {
      unsubRef.current();
    }

    unsubRef.current = sttService.subscribe((svcState, text, svcError) => {
      switch (svcState) {
        case 'listening':
          setState('recording');
          break;
        case 'result':
          setTranscript(text);
          setState('idle');
          break;
        case 'error':
          setError(svcError);
          setState('error');
          break;
        case 'idle':
          setState('idle');
          break;
      }
    });

    sttService.start();
  }, []);

  const stopRecording = useCallback(() => {
    setState('processing');
    sttService.stop();
  }, []);

  const reset = useCallback(() => {
    sttService.abort();
    setState('idle');
    setError(null);
    setTranscript(null);
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
  }, []);

  /** Kept for API compatibility; audio playback not handled here */
  const playAudio = useCallback((_blob: Blob) => {
    // No-op: TTS service handles spoken responses
  }, []);

  /** Kept for API compatibility */
  const stopAudio = useCallback(() => {
    // No-op
  }, []);

  return {
    state,
    error,
    isSupported,
    audioBlob,
    transcript,
    startRecording,
    stopRecording,
    playAudio,
    stopAudio,
    reset,
  };
};
