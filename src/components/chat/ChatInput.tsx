/**
 * ChatInput — bottom input bar with voice support
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { Send, Mic, Square } from 'lucide-react';
import { RecordingWaveform } from './RecordingWaveform';
import type { VoiceState } from '@/hooks/useVoiceService';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  voiceState?: VoiceState;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  disabled = false,
  voiceState = 'idle',
  onVoiceStart,
  onVoiceStop,
}) => {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const canSend = value.trim().length > 0 && !disabled && voiceState !== 'recording';
  const isRecording = voiceState === 'recording';
  const isProcessing = voiceState === 'processing';
  const isVoiceBusy = isRecording || isProcessing;

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      onVoiceStop?.();
    } else {
      onVoiceStart?.();
    }
  }, [isRecording, onVoiceStart, onVoiceStop]);

  return (
    <div className="flex flex-col bg-surface border-t border-border-subtle">
      {/* Recording waveform bar */}
      {isRecording && (
        <div className="px-4 pt-2">
          <RecordingWaveform isRecording={isRecording} />
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        {/* Mic button */}
        <button
          type="button"
          onClick={handleMicClick}
          aria-label={isRecording ? 'Stop recording' : 'Voice input'}
          disabled={isProcessing || disabled}
          className={clsx(
            'flex items-center justify-center w-10 h-10 rounded-xl',
            'transition-all duration-200',
            isRecording
              ? 'bg-error text-white animate-pulse'
              : isProcessing
                ? 'bg-n-200 dark:bg-n-700 text-n-400 cursor-not-allowed'
                : 'bg-n-100 dark:bg-n-800 text-n-600 dark:text-n-300 hover:bg-n-200 dark:hover:bg-n-700 active:scale-95'
          )}
        >
          {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Text input */}
        <div className="flex-1 flex items-center gap-2 bg-n-50 dark:bg-n-800 rounded-xl px-3 py-2 border border-border-subtle">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Listening...' : isProcessing ? 'Processing voice...' : 'Ask a clinical question...'}
            disabled={disabled || isVoiceBusy}
            className={clsx(
              'flex-1 bg-transparent font-body text-sm text-n-900 dark:text-n-100',
              'placeholder:text-n-400 dark:placeholder:text-n-600',
              'focus:outline-none',
              (disabled || isVoiceBusy) && 'opacity-50'
            )}
          />
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send message"
          className={clsx(
            'flex items-center justify-center w-10 h-10 rounded-full',
            'transition-all duration-200',
            canSend
              ? 'bg-accent-600 text-white hover:bg-accent-500 active:scale-95'
              : 'bg-n-200 dark:bg-n-700 text-n-400 cursor-not-allowed'
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export { ChatInput };
