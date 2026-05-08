/**
 * DrugTableCard — inline drug dose mini-card in chat
 */

import React, { useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import { getDrugById } from '@/data/drugTables';
import { useRouter } from '@/router/useRouter';

interface DrugTableCardProps {
  drugId: string;
}

const DrugTableCard: React.FC<DrugTableCardProps> = ({ drugId }) => {
  const drug = getDrugById(drugId);
  const { navigate } = useRouter();

  const handleViewTable = useCallback(() => {
    navigate(`/drug-table/${drugId}`);
  }, [navigate, drugId]);

  if (!drug) {
    return (
      <p className="text-sm text-n-500">Drug information not available.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display font-semibold text-sm text-n-900 dark:text-n-100">
            {drug.name}
          </p>
          <p className="text-xs font-body text-n-500">
            {drug.route} · {drug.form}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleViewTable}
        className="inline-flex items-center gap-1.5 text-sm font-body font-semibold text-accent-600 hover:text-accent-500 transition-colors"
      >
        View dosing table
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};

export { DrugTableCard };
