/**
 * STTLanguageSelector — voice input language for speech recognition
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { Check, Mic } from 'lucide-react';
import { STT_LANGUAGES } from '@/utils/constants';
import { sttService } from '@/services/sttService';

interface STTLanguageSelectorProps {
  value: string;
  onChange: (code: string) => void;
}

const STTLanguageSelector: React.FC<STTLanguageSelectorProps> = ({ value, onChange }) => {
  const handleSelect = useCallback((code: string) => {
    sttService.setLang(code);
    onChange(code);
  }, [onChange]);

  return (
    <div className="space-y-1">
      {STT_LANGUAGES.map((lang) => {
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
            <div className="flex items-center gap-3">
              <span className="text-base">{lang.flag}</span>
              <span>{lang.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {isSelected && (
                <>
                  <Mic className="w-4 h-4 text-accent-500" />
                  <Check className="w-5 h-5 text-accent-500" />
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export { STTLanguageSelector };
