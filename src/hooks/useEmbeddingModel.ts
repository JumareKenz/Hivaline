/**
 * useEmbeddingModel — observe the embedding-model download/readiness state
 * for a one-time "Downloading intelligence model…" indicator.
 */

import { useEffect, useState } from 'react';
import { getModelState, subscribeModelState, type ModelState } from '@/services/modelManager';

export function useEmbeddingModel(): ModelState {
  const [state, setState] = useState<ModelState>(getModelState());
  useEffect(() => subscribeModelState(setState), []);
  return state;
}
