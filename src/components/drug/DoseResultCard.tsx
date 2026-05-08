/**
 * DoseResultCard — live-updating dose display card
 */

import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { getDoseForWeight, getDrugById } from '@/data/drugTables';

interface DoseResultCardProps {
  drugId: string;
  weightKg: number;
}

const DoseResultCard: React.FC<DoseResultCardProps> = ({ drugId, weightKg }) => {
  const drug = useMemo(() => getDrugById(drugId), [drugId]);
  const result = useMemo(() => getDoseForWeight(drugId, weightKg), [drugId, weightKg]);

  if (!drug) {
    return (
      <div className="p-4 rounded-xl bg-error/5 border border-error/20">
        <p className="text-sm font-body text-error">Drug information not available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main dose display */}
      <div className={clsx(
        'p-5 rounded-xl border',
        result.inRange
          ? 'bg-surface border-accent-100 dark:border-accent-800'
          : 'bg-error/5 border-error/30'
      )}>
        <p className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-2">
          Dose
        </p>
        <p className={clsx(
          'font-display font-bold text-3xl mb-1',
          result.inRange ? 'text-accent-600' : 'text-error'
        )}>
          {result.dose}
        </p>

        {result.inRange && (
          <div className="space-y-1.5 mt-4 pt-4 border-t border-border-subtle">
            <div className="flex justify-between">
              <span className="text-xs font-body text-n-500">Frequency</span>
              <span className="text-xs font-body font-medium text-n-800 dark:text-n-100">{drug.frequency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs font-body text-n-500">Duration</span>
              <span className="text-xs font-body font-medium text-n-800 dark:text-n-100">{drug.duration}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs font-body text-n-500">Route</span>
              <span className="text-xs font-body font-medium text-n-800 dark:text-n-100">{drug.route}</span>
            </div>
          </div>
        )}
      </div>

      {/* Warning */}
      {drug.warning && result.inRange && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border-l-3 border-l-warning">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs font-body text-warning-800 dark:text-warning leading-relaxed break-words">
            {drug.warning}
          </p>
        </div>
      )}

      {/* Out of range warning */}
      {!result.inRange && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-error/5 border border-error/30">
          <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
          <div>
            <p className="font-display font-semibold text-sm text-error mb-1">
              Weight outside safe dosing range
            </p>
            <p className="text-xs font-body text-n-700 dark:text-n-300">
              {result.notes}
            </p>
          </div>
        </div>
      )}

      {/* Source */}
      <p className="text-[10px] font-mono text-n-400 text-center">
        Source: {drug.source}
      </p>
    </div>
  );
};

export { DoseResultCard };
