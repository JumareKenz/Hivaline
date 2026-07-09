/**
 * TTSSettings — Voice output configuration panel
 */

import React from 'react';
import { clsx } from 'clsx';
import { Volume2, VolumeX, Check, AlertCircle } from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';
import { Toggle } from '@/components/ui/Toggle';

const TTSSettings: React.FC = () => {
  const { isAvailable, isEnabled, voices, selectedVoiceURI, setEnabled, setVoice } = useTTS();

  if (!isAvailable) {
    return (
      <div className="p-4 rounded-xl bg-surface border border-border-subtle">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-n-100 dark:bg-n-800 flex items-center justify-center flex-shrink-0 mt-0.5">
            <VolumeX className="w-5 h-5 text-n-400" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-body font-semibold text-n-700 dark:text-n-300">
              Voice Output Unavailable
            </h4>
            <p className="text-xs font-body text-n-500 leading-relaxed">
              Text-to-speech is not available on this device. For voice output,
              install Google Text-to-Speech or another TTS engine from your
              device settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'w-10 h-10 rounded-full flex items-center justify-center',
              isEnabled
                ? 'bg-accent-500/10 text-accent-500'
                : 'bg-n-100 dark:bg-n-800 text-n-400'
            )}
          >
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-body font-semibold text-n-800 dark:text-n-200">
              HIVA speaks responses
            </h4>
            <p className="text-xs font-body text-n-500">
              {isEnabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>
        <Toggle checked={isEnabled} onChange={setEnabled} />
      </div>

      {/* Warning if no voices */}
      {isEnabled && voices.length === 0 && (
        <div className="flex items-start gap-2 text-xs font-body text-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            No voices found. Install Google Text-to-Speech in your device
            settings.
          </span>
        </div>
      )}

      {/* Voice selector */}
      {isEnabled && voices.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-body font-medium text-n-500 uppercase tracking-widest">
            Voice
          </label>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {voices.map((voice) => (
              <button
                key={voice.uri}
                type="button"
                onClick={() => setVoice(voice.uri)}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left',
                  'text-sm font-body transition-colors duration-150',
                  selectedVoiceURI === voice.uri
                    ? 'bg-accent-500/10 text-accent-700 dark:text-accent-400'
                    : 'hover:bg-n-50 dark:hover:bg-n-800 text-n-700 dark:text-n-300'
                )}
              >
                <span className="truncate">{voice.name}</span>
                {selectedVoiceURI === voice.uri && (
                  <Check className="w-4 h-4 text-accent-500 flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { TTSSettings };
