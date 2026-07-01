/**
 * useModelDownload Hook
 *
 * React hook for managing model download state and showing modal on first launch
 */

import { useState, useEffect } from 'react';
import { isModelDownloaded } from '../services/modelDownloader';

export interface UseModelDownloadResult {
  showDownloadModal: boolean;
  setShowDownloadModal: (show: boolean) => void;
  modelReady: boolean;
  checkingModel: boolean;
}

/**
 * Hook to check if model is downloaded and show download modal if needed
 *
 * @param autoShow - Automatically show modal if model is missing (default: true)
 * @returns Model download state and controls
 */
export function useModelDownload(autoShow: boolean = true): UseModelDownloadResult {
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [checkingModel, setCheckingModel] = useState(true);

  useEffect(() => {
    const checkModel = async () => {
      setCheckingModel(true);
      const downloaded = await isModelDownloaded();
      setModelReady(downloaded);
      setCheckingModel(false);

      // Show modal if model is missing and autoShow is enabled
      if (!downloaded && autoShow) {
        setShowDownloadModal(true);
      }
    };

    checkModel();
  }, [autoShow]);

  const handleModalDismiss = (success: boolean) => {
    setShowDownloadModal(false);
    if (success) {
      setModelReady(true);
    }
  };

  return {
    showDownloadModal,
    setShowDownloadModal: (show: boolean) => {
      if (show) {
        setShowDownloadModal(true);
      } else {
        handleModalDismiss(false);
      }
    },
    modelReady,
    checkingModel,
  };
}
