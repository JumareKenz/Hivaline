/**
 * Model Download Modal
 *
 * UI for downloading Edge Brain model on first launch
 */

import React, { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonProgressBar,
  IonText,
  IonIcon,
  IonItem,
  IonLabel,
  IonToggle,
} from '@ionic/react';
import { cloudDownloadOutline, wifiOutline } from 'ionicons/icons';
import {
  downloadModel,
  cancelDownload,
  formatBytes,
  formatTime,
  type DownloadProgress,
} from '../services/modelDownloader';

interface ModelDownloadModalProps {
  isOpen: boolean;
  onDidDismiss: (success: boolean) => void;
}

export const ModelDownloadModal: React.FC<ModelDownloadModalProps> = ({
  isOpen,
  onDidDismiss,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);

    const result = await downloadModel(
      (prog) => setProgress(prog),
      wifiOnly
    );

    if (result.success) {
      onDidDismiss(true);
    } else {
      setError(result.error || 'Download failed');
      setDownloading(false);
    }
  };

  const handleCancel = () => {
    if (downloading) {
      cancelDownload();
      setDownloading(false);
      setProgress(null);
    }
    onDidDismiss(false);
  };

  return (
    <IonModal
      isOpen={isOpen}
      backdropDismiss={false}
      onDidDismiss={() => handleCancel()}
    >
      <IonHeader>
        <IonToolbar>
          <IonTitle>Edge Brain Setup</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <IonIcon
            icon={cloudDownloadOutline}
            style={{ fontSize: '64px', color: 'var(--ion-color-primary)' }}
          />
        </div>

        {!downloading ? (
          <>
            <IonText>
              <h2>Download AI Model</h2>
              <p>
                Edge Brain needs to download an AI model to work offline. This is a
                one-time download.
              </p>
              <ul style={{ textAlign: 'left', paddingLeft: '20px' }}>
                <li>Size: ~892 MB</li>
                <li>Enables offline clinical guidance</li>
                <li>Fast on-device inference (15-25 tokens/sec)</li>
                <li>Never sends data to cloud</li>
              </ul>
            </IonText>

            <IonItem>
              <IonIcon icon={wifiOutline} slot="start" />
              <IonLabel>WiFi only</IonLabel>
              <IonToggle
                checked={wifiOnly}
                onIonChange={(e: CustomEvent) => setWifiOnly(e.detail.checked)}
              />
            </IonItem>

            {error && (
              <IonText color="danger">
                <p style={{ marginTop: '16px' }}>
                  <strong>Error:</strong> {error}
                </p>
              </IonText>
            )}

            <div style={{ marginTop: '32px' }}>
              <IonButton expand="block" onClick={handleDownload}>
                Download Now
              </IonButton>
              <IonButton expand="block" fill="outline" onClick={handleCancel}>
                Skip (Template Mode Only)
              </IonButton>
            </div>
          </>
        ) : (
          <>
            <IonText>
              <h2>Downloading Model...</h2>
              {progress && (
                <>
                  <p>
                    {formatBytes(progress.bytesDownloaded)} /{' '}
                    {formatBytes(progress.totalBytes)}
                  </p>
                  <p>
                    <strong>{progress.percentComplete.toFixed(1)}%</strong> complete
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--ion-color-medium)' }}>
                    Speed: {progress.speedMBps.toFixed(1)} MB/s<br />
                    Remaining: {formatTime(progress.estimatedSecondsRemaining)}
                  </p>
                </>
              )}
            </IonText>

            <IonProgressBar
              value={progress ? progress.percentComplete / 100 : 0}
              style={{ marginTop: '20px' }}
            />

            <div style={{ marginTop: '32px' }}>
              <IonButton expand="block" fill="outline" onClick={handleCancel}>
                Cancel Download
              </IonButton>
            </div>
          </>
        )}
      </IonContent>
    </IonModal>
  );
};
