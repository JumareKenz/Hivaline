/**
 * TypingIndicator — 3 pulsing dots animation
 */

import React from 'react';
import { clsx } from 'clsx';

const TypingIndicator: React.FC = () => {
  return (
    <div className="flex items-center gap-1 px-4 py-3 bg-surface border border-border-subtle rounded-2xl rounded-bl-md shadow-sm w-fit">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={clsx(
            'w-2 h-2 rounded-full bg-accent-500',
            'animate-pulse-dot'
          )}
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
};

export { TypingIndicator };
