/**
 * DrugTableScreen — full drug dosing calculator
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useHIVFile } from '@/hooks/useHIVFile';
import { getDrugById } from '@/services/hivDataExtractor';
import { useRouter } from '@/router/useRouter';
import { TopBar } from '@/components/ui/TopBar';
import { WeightSlider } from './WeightSlider';
import { DoseResultCard } from './DoseResultCard';

const DrugTableScreen: React.FC = () => {
  const { params } = useRouter();
  const { file } = useHIVFile();
  const drug = useMemo(() => getDrugById(file, params.id ?? ''), [file, params.id]);

  const [weightKg, setWeightKg] = useState(12);

  const handleWeightChange = useCallback((value: number) => {
    setWeightKg(value);
  }, []);

  if (!drug) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="font-body text-n-500">Drug information not available.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <TopBar
        title={drug.name}
        subtitle={`${drug.route} · ${drug.form}`}
        showBack
      />

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        <WeightSlider value={weightKg} onChange={handleWeightChange} />
        <DoseResultCard drugId={drug.id} weightKg={weightKg} />
      </div>
    </div>
  );
};

export default DrugTableScreen;
