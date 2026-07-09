/**
 * MessageFeedback — 👍/👎 rating shown under a HIVA clinical answer.
 * On rate, the parent posts anonymous feedback (chunk_id + rating + latency).
 */

import React from 'react';
import { clsx } from 'clsx';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface MessageFeedbackProps {
  rated: boolean;
  onRate: (rating: 1 | -1) => void;
}

const MessageFeedback: React.FC<MessageFeedbackProps> = ({ rated, onRate }) => {
  if (rated) {
    return (
      <span className="text-[10px] font-body text-n-400 dark:text-n-500">
        Thanks for the feedback
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-body text-n-400 dark:text-n-500 mr-0.5">Helpful?</span>
      {([['up', 1], ['down', -1]] as const).map(([dir, rating]) => (
        <button
          key={dir}
          type="button"
          onClick={() => onRate(rating)}
          aria-label={dir === 'up' ? 'Mark answer helpful' : 'Mark answer not helpful'}
          className={clsx(
            'flex items-center justify-center w-6 h-6 rounded-md',
            'text-n-400 hover:text-accent-500 hover:bg-accent-500/10',
            'dark:text-n-500 dark:hover:text-accent-100',
            'transition-colors duration-150'
          )}
        >
          {dir === 'up' ? <ThumbsUp className="w-3.5 h-3.5" /> : <ThumbsDown className="w-3.5 h-3.5" />}
        </button>
      ))}
    </div>
  );
};

export { MessageFeedback };
