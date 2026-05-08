/**
 * VerificationBadge — FMOH approved green checkmark badge
 */

import React from 'react';
import { CheckCircle2 } from 'lucide-react';

const VerificationBadge: React.FC = () => {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-success/5 border border-success/20">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-success/15 flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4 text-success" />
      </div>
      <div>
        <p className="font-display font-semibold text-sm text-success">
          FMOH Approved Content
        </p>
        <p className="text-xs font-body text-n-500 dark:text-n-400 mt-0.5">
          Signed · Synced today
        </p>
      </div>
    </div>
  );
};

export { VerificationBadge };
