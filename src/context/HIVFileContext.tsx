/**
 * HIVFileContext — React context for loaded .hiv clinical data
 */

import React, { createContext, useState, useCallback, useEffect } from 'react';
import type { HIVFile, HIVChunk } from '@/types/hiv';
import { loadStoredHIV, checkForUpdate, downloadHIV } from '@/services/updateService';
import { initEmbedder } from '@/services/onnxEmbedder';
import { HIVA_TOKEN_KEY } from '@/utils/constants';

interface HIVFileState {
  file: HIVFile | null;
  isLoading: boolean;
  error: string | null;
}

interface HIVFileContextValue extends HIVFileState {
  loadFile: (hivFile: HIVFile) => void;
  reload: () => Promise<void>;
  findChunk: (id: string) => HIVChunk | undefined;
}

export const HIVFileContext = createContext<HIVFileContextValue | null>(null);

export const HIVFileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<HIVFileState>({
    file: null,
    isLoading: true,
    error: null,
  });

  const loadFile = useCallback((hivFile: HIVFile) => {
    setState({ file: hivFile, isLoading: false, error: null });
    // Pre-warm embedder in background
    initEmbedder().catch(() => { /* embedder is optional */ });
  }, []);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const stored = await loadStoredHIV();
      if (stored) {
        setState({ file: stored, isLoading: false, error: null });
        initEmbedder().catch(() => { /* optional */ });
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch (err) {
      setState({
        file: null,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load .hiv file',
      });
      return;
    }

    // Background version check — runs silently, never blocks the UI
    checkForUpdate().then(async (meta) => {
      if (!meta) return; // already up to date
      const token = localStorage.getItem(HIVA_TOKEN_KEY);
      if (!token) return; // needs login before downloading
      const bytes = await downloadHIV(meta);
      if (!bytes) return;
      // Reload from IndexedDB after download (downloadHIV already persisted it)
      const updated = await loadStoredHIV();
      if (updated) {
        setState({ file: updated, isLoading: false, error: null });
        initEmbedder().catch(() => { /* optional */ });
      }
    }).catch(() => { /* offline or network error — silent */ });
  }, []);

  const findChunk = useCallback(
    (id: string) => state.file?.chunks.find((c) => c.id === id),
    [state.file]
  );

  // Auto-load on mount and listen for download events
  useEffect(() => {
    reload();

    const handleDownloaded = () => {
      reload();
    };
    window.addEventListener('hiva:file-downloaded', handleDownloaded);
    return () => window.removeEventListener('hiva:file-downloaded', handleDownloaded);
  }, [reload]);

  return (
    <HIVFileContext.Provider value={{ ...state, loadFile, reload, findChunk }}>
      {children}
    </HIVFileContext.Provider>
  );
};
