/**
 * Mock drug dosing data
 */

import type { DrugTable } from '@/types/hiv';

export const MOCK_DRUGS: readonly DrugTable[] = [
  {
    id: 'act-artemether',
    name: 'Artemether/Lumefantrine (ACT)',
    route: 'Oral',
    form: 'Tablet 20/120mg',
    unitDose: '1 tablet',
    frequency: 'Twice daily',
    duration: '3 days',
    weightRanges: [
      { minKg: 5, maxKg: 14, dose: '1 tablet (20/120mg)', notes: 'Crush if needed' },
      { minKg: 15, maxKg: 24, dose: '2 tablets (20/120mg)', notes: '' },
      { minKg: 25, maxKg: 34, dose: '3 tablets (20/120mg)', notes: '' },
      { minKg: 35, maxKg: 100, dose: '4 tablets (20/120mg)', notes: 'Adult dose' },
    ],
    warning: '⚠ If child vomits within 30 minutes → Repeat dose once',
    source: 'FMOH Malaria Guidelines 2024',
  },
  {
    id: 'amoxicillin-250',
    name: 'Amoxicillin',
    route: 'Oral',
    form: 'Suspension 250mg/5ml',
    unitDose: '5ml',
    frequency: 'Twice daily',
    duration: '5 days',
    weightRanges: [
      { minKg: 4, maxKg: 9, dose: '2.5ml (125mg)', notes: '' },
      { minKg: 10, maxKg: 19, dose: '5ml (250mg)', notes: '' },
      { minKg: 20, maxKg: 29, dose: '7.5ml (375mg)', notes: '' },
      { minKg: 30, maxKg: 100, dose: '10ml (500mg)', notes: '' },
    ],
    warning: 'Watch for allergic reaction (rash, swelling, difficulty breathing)',
    source: 'FMOH Essential Medicines 2024',
  },
] as const;

export const getDrugById = (id: string): DrugTable | undefined =>
  MOCK_DRUGS.find((d) => d.id === id);

export const getDoseForWeight = (
  drugId: string,
  weightKg: number
): { dose: string; notes: string; inRange: boolean } => {
  const drug = getDrugById(drugId);
  if (!drug) return { dose: 'Unknown drug', notes: '', inRange: false };

  const range = drug.weightRanges.find((r) => weightKg >= r.minKg && weightKg <= r.maxKg);
  if (range) {
    return { dose: range.dose, notes: range.notes || '', inRange: true };
  }

  const min = drug.weightRanges[0]?.minKg ?? 0;
  const max = drug.weightRanges[drug.weightRanges.length - 1]?.maxKg ?? 100;
  return {
    dose: 'Outside safe range',
    notes: `Safe range: ${min}-${max}kg. Refer patient.`,
    inRange: false,
  };
};
