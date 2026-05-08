/**
 * TopBar — screen header with back button and status
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from '@/router/useRouter';

interface TopBarProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightElement?: React.ReactNode;
  className?: string;
}

const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  showBack = false,
  rightElement,
  className,
}) => {
  const { goBack } = useRouter();

  const handleBack = useCallback(() => {
    goBack();
  }, [goBack]);

  return (
    <header
      className={clsx(
        'flex items-center h-14 px-4',
        'bg-surface/80 backdrop-blur-md',
        'border-b border-border-subtle',
        'z-30',
        className
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {showBack && (
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-n-100 dark:hover:bg-n-800 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-n-600 dark:text-n-300" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="font-display font-semibold text-base text-n-900 dark:text-n-100 truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs font-body text-n-500 dark:text-n-400 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {rightElement && (
        <div className="flex-shrink-0 ml-2">
          {rightElement}
        </div>
      )}
    </header>
  );
};

export { TopBar };
