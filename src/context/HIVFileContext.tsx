/**
 * HIVFileContext — React context for loaded .hiv clinical data
 */

import React, { createContext, useState, useCallback, useEffect } from 'react';
import type { HIVFile, HIVChunk } from '@/types/hiv';
import { loadStoredHIV, checkForUpdate, downloadHIV, getStoredHIVBytes, getHIVNativePath } from '@/services/updateService';
import { getToken } from '@/services/authStorage';
import { warmupEmbeddingModel } from '@/services/modelManager';
import { loadEdgeBrain } from '@/services/edgeBrainService';
import { isEmbeddingModelDownloaded, downloadEmbeddingModel, loadNativeBundle, isNativeRetrieverReady } from '@/services/nativeRetrieverService';
import { Filesystem, Directory } from '@capacitor/filesystem';

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
  }, []);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const stored = await loadStoredHIV();
      if (stored) {
        setState({ file: stored, isLoading: false, error: null });
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
      const token = await getToken();
      if (!token) return; // needs login before downloading
      const bytes = await downloadHIV(meta);
      if (!bytes) return;
      // Reload from IndexedDB after download (downloadHIV already persisted it)
      const updated = await loadStoredHIV();
      if (updated) {
        setState({ file: updated, isLoading: false, error: null });
      }
    }).catch(() => { /* offline or network error — silent */ });
  }, []);

  const findChunk = useCallback(
    (id: string) => state.file?.chunks.find((c) => c.id === id),
    [state.file]
  );

  // Auto-load on mount and listen for download events.
  // Also start embedding model warmup immediately — it runs in parallel with
  // .hiv loading so the ONNX session is ready (or nearly ready) by the time
  // the user's first query arrives. On cold start with cached model, this
  // typically takes 1-3s on modern devices; on low-end devices it may take
  // 5-15s but still finishes before most users type their first question.
  useEffect(() => {
    reload();
    warmupEmbeddingModel();
    // Load the on-device LLM in the background so it's ready before the first
    // chat query. isEdgeBrainReady() is the gate in conversationEngine — if this
    // hasn't run by query time, the engine silently falls back to retrieval-only.
    // Auto-download and load the LFM2.5 model if missing, then load into LEAP.
    // Runs entirely in the background — never blocks the UI.
    // On a fresh install after a signing-key change, this recovers the model
    // automatically without requiring the user to visit Settings.
    (async () => {
      try {
        // Model is bundled in APK assets — native loadModel() copies it to
        // filesDir on first launch. No JS-side download needed.
        await loadEdgeBrain();
      } catch {
        /* model load failed — will retry on next query */
      }
    })();

    // Auto-download E5-small-v2 ONNX model, then initialize NativeRetriever.
    (async () => {
      try {
        const info = await isEmbeddingModelDownloaded();
        if (!info.downloaded) {
          console.log('[HIVA] E5 model not found, downloading...');
          await downloadEmbeddingModel();
          console.log('[HIVA] E5 model downloaded');
        }

        // Initialize NativeRetriever with the .hiva bundle
        const ready = await isNativeRetrieverReady();
        console.log('[HIVA] NativeRetriever ready check:', ready);
        if (!ready) {
          // Check if .hiv is already on native filesystem
          let nativePath = await getHIVNativePath();
          console.log('[HIVA] Native path check:', nativePath);

          if (!nativePath) {
            // First time: write .hiv from IndexedDB to native FS
            const hivBytes = await getStoredHIVBytes();
            console.log('[HIVA] IndexedDB bytes:', hivBytes ? `${hivBytes.length} bytes` : 'null');
            if (hivBytes) {
              try { await Filesystem.mkdir({ path: 'hiva-bundle', directory: Directory.Data, recursive: true }); } catch { /* exists */ }
              try { await Filesystem.deleteFile({ path: 'hiva-bundle/current.hiva', directory: Directory.Data }); } catch { /* doesn't exist */ }
              const chunkSize = 512 * 1024;
              for (let offset = 0; offset < hivBytes.length; offset += chunkSize) {
                const slice = hivBytes.slice(offset, Math.min(offset + chunkSize, hivBytes.length));
                let binary = '';
                for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
                await Filesystem.appendFile({ path: 'hiva-bundle/current.hiva', data: btoa(binary), directory: Directory.Data });
              }
              const stat = await Filesystem.stat({ path: 'hiva-bundle/current.hiva', directory: Directory.Data });
              nativePath = stat.uri;
              console.log('[HIVA] .hiv written to native FS:', nativePath);
            }
          }

          if (nativePath) {
            // Capacitor returns file: URI, Kotlin ZipFile needs plain path
            const plainPath = nativePath.replace(/^file:\/\//, '').replace(/^file:/, '');
            await loadNativeBundle(plainPath);
            console.log('[HIVA] NativeRetriever loaded successfully');
          }
        }
      } catch (err) {
        console.warn('[HIVA] NativeRetriever init failed:', err);
      }
    })();

    const handleDownloaded = () => {
      reload();
      // Re-run NativeRetriever init — on first install the bundle didn't exist
      // when the mount-time init ran, so we must load it now that it's on disk.
      (async () => {
        try {
          const alreadyReady = await isNativeRetrieverReady();
          if (!alreadyReady) {
            const nativePath = await getHIVNativePath();
            if (nativePath) {
              const plainPath = nativePath.replace(/^file:\/\//, '').replace(/^file:/, '');
              await loadNativeBundle(plainPath);
              console.log('[HIVA] NativeRetriever loaded after bundle download');
            } else {
              console.warn('[HIVA] post-download: nativePath null — bundle not on disk yet?');
            }
          }
        } catch (err) {
          console.warn('[HIVA] NativeRetriever post-download init failed:', err);
        }
      })();
    };
    window.addEventListener('hiva:file-downloaded', handleDownloaded);
    return () => {
      window.removeEventListener('hiva:file-downloaded', handleDownloaded);
    };
  }, [reload]);

  return (
    <HIVFileContext.Provider value={{ ...state, loadFile, reload, findChunk }}>
      {children}
    </HIVFileContext.Provider>
  );
};
