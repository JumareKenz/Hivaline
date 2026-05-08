/**
 * DangerSignCard — red-bordered danger sign response
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ChatMessage } from '@/types/hiv';

interface DangerSignCardProps {
  message: ChatMessage;
}

const DangerSignCard: React.FC<DangerSignCardProps> = ({ message }) => {
  return (
    <div className="space-y-3" role="alert">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
        <span className="px-2 py-0.5 rounded-full bg-error/15 text-error text-xs font-display font-bold uppercase tracking-wider">
          Danger Sign
        </span>
      </div>

      {/* Content */}
      <div className="font-body text-[15px] text-n-900 dark:text-n-100 leading-relaxed whitespace-pre-line">
        {message.content}
      </div>

      {/* Source */}
      {message.metadata?.source && (
        <p className="text-[10px] font-mono text-n-400 dark:text-n-500 pt-2 border-t border-error/20">
          Source: {message.metadata.source}
        </p>
      )}
    </div>
  );
};

export { DangerSignCard };
