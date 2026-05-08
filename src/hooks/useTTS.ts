/**
 * useTTS — Text-to-Speech hook
 */

import { useContext } from 'react';
import { TTSContext } from '@/context/TTSContext';

export const useTTS = () => {
  const ctx = useContext(TTSContext);
  if (!ctx) throw new Error('useTTS must be used within TTSProvider');
  return ctx;
};
