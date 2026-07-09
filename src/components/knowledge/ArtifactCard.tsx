/**
 * ArtifactCard — knowledge base list item
 */

import React from 'react';
import { clsx } from 'clsx';
import type { Artifact } from '@/types/hiv';

interface ArtifactCardProps {
  artifact: Artifact;
  onClick: () => void;
}

const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left',
        'bg-surface border border-border-subtle rounded-xl p-4',
        'transition-all duration-200',
        'hover:border-n-300 dark:hover:border-n-600 hover:-translate-y-0.5',
        'active:scale-[0.98]'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Emoji icon */}
        <div className={clsx(
          'flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl',
          artifact.colorTint
        )}>
          {artifact.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display font-semibold text-sm text-n-900 dark:text-n-100 truncate">
              {artifact.title}
            </h3>
            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-accent-500 text-white text-[10px] font-mono font-medium">
              {artifact.year}
            </span>
          </div>
          <p className="text-xs font-body text-n-500 mb-2">
            {artifact.publisher}
          </p>

          {/* Topic chips */}
          <div className="flex flex-wrap gap-1.5">
            {artifact.topics.slice(0, 3).map((topic) => (
              <span
                key={topic}
                className="px-2 py-0.5 rounded-full bg-brand-teal-subtle text-accent-500 text-[11px] font-body font-medium"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
};

export { ArtifactCard };
