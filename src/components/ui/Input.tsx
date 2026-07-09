/**
 * Input — form input with validation state
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';

interface InputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string | null;
  type?: 'text' | 'password';
  autoCapitalize?: boolean;
  disabled?: boolean;
}

const Input: React.FC<InputProps> = ({
  id,
  value,
  onChange,
  placeholder,
  label,
  error,
  type = 'text',
  autoCapitalize = false,
  disabled = false,
}) => {
  const inputId = id ?? (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (autoCapitalize) {
      val = val.toUpperCase();
    }
    onChange(val);
  }, [onChange, autoCapitalize]);

  const hasError = !!error;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-body font-medium text-n-500 dark:text-n-400 mb-1.5 uppercase tracking-wider">
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={clsx(
          'w-full h-14 px-4',
          'bg-surface border rounded-xl',
          'font-body text-base text-n-900 dark:text-n-100',
          'placeholder:text-n-400 dark:placeholder:text-n-600',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500',
          hasError
            ? 'border-error focus:ring-error/30 focus:border-error'
            : 'border-border-subtle hover:border-n-300 dark:hover:border-n-600',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      />
      {hasError && (
        <p className="mt-1.5 text-xs font-body text-error">{error}</p>
      )}
    </div>
  );
};

export { Input };
