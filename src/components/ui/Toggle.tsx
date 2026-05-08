/**
 * Toggle — custom animated toggle switch
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => {
  const handleToggle = useCallback(() => {
    onChange(!checked);
  }, [checked, onChange]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleToggle}
      className="inline-flex items-center gap-3"
    >
      <span
        className={clsx(
          'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
          checked ? 'bg-accent-600' : 'bg-n-300 dark:bg-n-600'
        )}
      >
        <span
          className={clsx(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200',
            'absolute top-1',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </span>
      {label && (
        <span className="text-sm font-body font-medium text-n-700 dark:text-n-200">
          {label}
        </span>
      )}
    </button>
  );
};

export { Toggle };
