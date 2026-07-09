/**
 * VoiceToast — ephemeral voice status notification
 */

import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import { Mic, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { VoiceState } from '@/hooks/useVoiceService';

interface VoiceToastProps {
  state: VoiceState;
  error: string | null;
  onDismiss: () => void;
}

const VoiceToast: React.FC<VoiceToastProps> = ({ state, error, onDismiss }) => {
  // Auto-dismiss on idle or after error shown
  useEffect(() => {
    if (state === 'idle' || state === 'error') {
      const timer = setTimeout(onDismiss, 4000);
      return () => clearTimeout(timer);
    }
  }, [state, onDismiss]);

  if (state === 'idle' && !error) return null;

  // User-friendly error message (hide tech details)
  const displayError = error && (
    error.includes('FS export') ||
    error.includes('browser build') ||
    error.includes('Voice engine')
  )
    ? 'Voice not available on this device'
    : error;

  const config: Record<VoiceState, { icon: React.ReactNode; text: string; color: string }> = {
    idle: { icon: <Mic className="w-4 h-4" />, text: 'Ready', color: 'bg-n-100 text-n-600' },
    recording: { icon: <Mic className="w-4 h-4" />, text: 'Recording...', color: 'bg-error/10 text-error' },
    processing: { icon: <Loader2 className="w-4 h-4 animate-spin" />, text: 'Processing...', color: 'bg-accent-50 text-accent-500' },
    playing: { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Playing response', color: 'bg-success/10 text-success' },
    error: { icon: <AlertCircle className="w-4 h-4" />, text: displayError ?? 'Voice error', color: 'bg-error/10 text-error' },
  };

  const { icon, text, color } = config[state] ?? config.idle;

  return (
    <div
      className={clsx(
        'absolute top-2 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 px-3 py-1.5 rounded-full',
        'text-xs font-body font-medium shadow-md',
        'transition-all duration-300',
        color
      )}
    >
      {icon}
      {text}
    </div>
  );
};

export { VoiceToast };
