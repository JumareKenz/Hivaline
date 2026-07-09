/**
 * Button — all button variants
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  type?: 'button' | 'submit';
}

const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  fullWidth = false,
  icon,
  type = 'button',
}) => {
  const handleClick = useCallback(() => {
    if (!disabled && onClick) onClick();
  }, [disabled, onClick]);

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2',
        'font-body font-semibold rounded-xl',
        'transition-all duration-150',
        'active:scale-[0.97]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-sm',
        size === 'lg' && 'h-14 px-6 text-base',
        fullWidth && 'w-full',
        variant === 'primary' && 'bg-accent-500 text-white hover:bg-accent-400',
        variant === 'secondary' && 'bg-surface border border-border-subtle text-n-800 dark:text-n-100 hover:bg-n-50 dark:hover:bg-n-700',
        variant === 'ghost' && 'bg-transparent text-accent-500 hover:bg-accent-50 dark:hover:bg-accent-800/20',
        variant === 'danger' && 'bg-error text-white hover:bg-error/90',
      )}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
};

export { Button };
