/**
 * ResponseCard — compiled knowledge answer card
 */

import React from 'react';
import type { ChatMessage } from '@/types/hiv';

interface ResponseCardProps {
  message: ChatMessage;
}

const ResponseCard: React.FC<ResponseCardProps> = ({ message }) => {
  const lines = message.content.split('\n');
  const topic = message.metadata?.topic ?? 'Clinical Information';
  const source = message.metadata?.source ?? 'FMOH Guidelines';

  return (
    <div className="space-y-3">
      {/* Header chip */}
      <span className="inline-block px-2 py-1 rounded-md bg-accent-50 dark:bg-accent-800/30 text-accent-600 dark:text-accent-100 text-xs font-display font-semibold">
        {topic}
      </span>

      {/* Content */}
      <div className="space-y-2">
        {lines.map((line, i) => {
          if (line.startsWith('→') || line.startsWith('•')) {
            return (
              <p key={i} className="font-body text-sm text-n-700 dark:text-n-300 pl-2 border-l-2 border-accent-200 dark:border-accent-700">
                {line}
              </p>
            );
          }
          if (line.trim() === '') return null;
          return (
            <p key={i} className="font-body text-sm text-n-800 dark:text-n-100 leading-relaxed">
              {line}
            </p>
          );
        })}
      </div>

      {/* Warning line */}
      {message.content.includes('Danger') && (
        <div className="p-3 rounded-lg bg-warning/5 border-l-3 border-warning">
          <p className="text-xs font-body text-warning-800 dark:text-warning">
            ⚠ Refer urgently if danger signs are present
          </p>
        </div>
      )}

      {/* Source */}
      <p className="text-[10px] font-mono text-n-400 dark:text-n-500 pt-2 border-t border-border-subtle">
        Source: {source}
      </p>
    </div>
  );
};

export { ResponseCard };
