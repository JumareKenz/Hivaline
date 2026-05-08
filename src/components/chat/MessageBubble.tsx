/**
 * MessageBubble — HIVA (left) and User (right) message bubbles
 */

import React from 'react';
import { clsx } from 'clsx';
import type { ChatMessage } from '@/types/hiv';
import { ResponseCard } from './ResponseCard';
import { DangerSignCard } from './DangerSignCard';
import { DrugTableCard } from './DrugTableCard';

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.sender === 'user';

  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%]',
          isUser
            ? 'bg-accent-600 text-white rounded-2xl rounded-br-md'
            : 'bg-surface border border-border-subtle rounded-2xl rounded-bl-md shadow-sm',
          'px-4 py-3'
        )}
      >
        {message.type === 'text' && (
          <p className={clsx(
            'font-body text-[15px] leading-relaxed whitespace-pre-line',
            isUser ? 'text-white' : 'text-n-800 dark:text-n-100'
          )}>
            {message.content}
          </p>
        )}

        {message.type === 'response_card' && (
          <ResponseCard message={message} />
        )}

        {message.type === 'danger_sign' && (
          <DangerSignCard message={message} />
        )}

        {message.type === 'drug_table' && (
          <DrugTableCard drugId={message.metadata?.drugId ?? ''} />
        )}

        {message.type === 'decision_tree' && (
          <div className="space-y-3">
            <p className="font-body text-[15px] text-n-800 dark:text-n-100">
              {message.content}
            </p>
            {/* Decision tree navigation is handled by the parent or a separate flow */}
          </div>
        )}
      </div>
    </div>
  );
};

export { MessageBubble };
