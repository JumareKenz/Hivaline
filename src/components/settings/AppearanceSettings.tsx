/**
 * AppearanceSettings — dark mode toggle + interaction mode
 */

import React from 'react';
import { clsx } from 'clsx';
import { Toggle } from '@/components/ui/Toggle';
import { useTheme } from '@/hooks/useTheme';
import type { InteractionMode } from '@/types/hiv';

const MODES: { value: InteractionMode; label: string }[] = [
  { value: 'quiet', label: 'Quiet' },
  { value: 'companion', label: 'Companion' },
  { value: 'co-pilot', label: 'Co-pilot' },
];

interface AppearanceSettingsProps {
  interactionMode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({ interactionMode, onModeChange }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-5">
      {/* Dark mode toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-body font-medium text-sm text-n-900 dark:text-n-100">Dark Mode</p>
          <p className="text-xs font-body text-n-500">Easier on the eyes at night</p>
        </div>
        <Toggle checked={isDark} onChange={toggleTheme} />
      </div>

      {/* Interaction mode */}
      <div className="space-y-2">
        <p className="font-body font-medium text-sm text-n-900 dark:text-n-100">Interaction Mode</p>
        <div className="flex gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => onModeChange(mode.value)}
              className={clsx(
                'flex-1 h-10 rounded-lg text-xs font-body font-medium',
                'transition-all duration-150',
                interactionMode === mode.value
                  ? 'bg-accent-500 text-white'
                  : 'bg-n-100 dark:bg-n-800 text-n-600 dark:text-n-400 hover:bg-n-200 dark:hover:bg-n-700'
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export { AppearanceSettings };
