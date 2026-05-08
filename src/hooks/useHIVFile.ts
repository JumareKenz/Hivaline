/**
 * useHIVFile — hook to access loaded .hiv clinical data
 */

import { useContext } from 'react';
import { HIVFileContext } from '@/context/HIVFileContext';

export const useHIVFile = () => {
  const ctx = useContext(HIVFileContext);
  if (!ctx) throw new Error('useHIVFile must be used within HIVFileProvider');
  return ctx;
};
