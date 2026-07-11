/**
 * SuggestionChips — horizontal scrollable pill buttons
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (text: string) => void;
}

const SuggestionChips: React.FC<SuggestionChipsProps> = ({ suggestions, onSelect }) => {
  const handleSelect = useCallback((text: string) => {
    onSelect(text);
  }, [onSelect]);

  return (
    <div className="w-full overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
      <div className="flex gap-2 w-max">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => handleSelect(suggestion)}
            className={clsx(
              'px-4 h-8 rounded-full',
              'bg-brand-forest-subtle border border-brand-forest-muted',
              'text-accent-500 font-body font-medium text-[13px]',
              'whitespace-nowrap',
              'transition-all duration-150',
              'hover:bg-brand-forest-muted active:scale-95'
            )}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};

export { SuggestionChips };
