/**
 * LanguageSelector — settings language list
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import type { Language } from '@/types/hiv';

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ha', label: 'Hausa' },
  { code: 'yo', label: 'Yorùbá' },
  { code: 'ig', label: 'Igbo' },
  { code: 'pcm', label: 'Pidgin' },
];

interface LanguageSelectorProps {
  value: Language;
  onChange: (lang: Language) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ value, onChange }) => {
  const handleSelect = useCallback((lang: Language) => {
    onChange(lang);
  }, [onChange]);

  return (
    <div className="space-y-1">
      {LANGUAGES.map((lang) => {
        const isSelected = value === lang.code;
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => handleSelect(lang.code)}
            className={clsx(
              'w-full flex items-center justify-between',
              'h-[52px] px-4 rounded-xl',
              'font-body font-medium text-[15px]',
              'transition-colors duration-150',
              isSelected
                ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-500'
                : 'text-n-800 dark:text-n-100 hover:bg-n-50 dark:hover:bg-n-800'
            )}
          >
            <span>{lang.label}</span>
            {isSelected && <Check className="w-5 h-5 text-accent-500" />}
          </button>
        );
      })}
    </div>
  );
};

export { LanguageSelector };
