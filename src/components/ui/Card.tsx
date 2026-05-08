/**
 * Card — generic card primitive
 */

import React from 'react';
import { clsx } from 'clsx';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'danger' | 'success' | 'warning';
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  className,
  padding = 'md',
}) => {
  return (
    <div
      className={clsx(
        'rounded-xl transition-shadow duration-200',
        variant === 'default' && 'bg-surface border border-border-subtle',
        variant === 'danger' && 'bg-error/5 border-l-4 border-l-error',
        variant === 'success' && 'bg-success/5 border-l-4 border-l-success',
        variant === 'warning' && 'bg-warning/5 border-l-4 border-l-warning',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4',
        padding === 'lg' && 'p-5',
        className
      )}
    >
      {children}
    </div>
  );
};

export { Card };
