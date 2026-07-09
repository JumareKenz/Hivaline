/**
 * SettingsScreen — settings shell with all sections
 */

import React, { useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { LogOut, ChevronRight, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/router/useRouter';
import { useHIVFile } from '@/hooks/useHIVFile';
import { APP_VERSION, STT_LANG_STORAGE_KEY, HIVA_KNOWN_VERSION_KEY } from '@/utils/constants';
import { TopBar } from '@/components/ui/TopBar';
import { HivaLogo } from '@/components/ui/HivaLogo';
import { LanguageSelector } from './LanguageSelector';
import { AppearanceSettings } from './AppearanceSettings';
import { ServerCodeDisplay } from './ServerCodeDisplay';
import { TTSSettings } from './TTSSettings';
import { STTLanguageSelector } from './STTLanguageSelector';
import { AnalyticsSettings } from './AnalyticsSettings';
import { sttService } from '@/services/sttService';
import { checkForUpdate, downloadHIV, HivAuthError } from '@/services/updateService';
import { getToken } from '@/services/authStorage';
import {
  isEmbeddingModelDownloaded, downloadEmbeddingModel,
} from '@/services/nativeRetrieverService';
import type { Language, InteractionMode } from '@/types/hiv';

const SettingsScreen: React.FC = () => {
  const { state: authState, logout } = useAuth();
  const { navigate } = useRouter();
  const { file, isLoading, reload } = useHIVFile();

  const [language, setLanguage] = useState<Language>('en');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('companion');
  const [sttLang, setSttLang] = useState<string>(() => {
    const stored = localStorage.getItem(STT_LANG_STORAGE_KEY);
    if (stored) {
      sttService.setLang(stored);
      return stored;
    }
    return sttService.getLang();
  });

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>('');

  // E5-small-v2 model state (for NativeRetriever)
  const [embedModelDownloaded, setEmbedModelDownloaded] = useState<boolean>(false);
  const [checkingEmbedModel, setCheckingEmbedModel] = useState<boolean>(true);
  const [downloadingEmbedModel, setDownloadingEmbedModel] = useState<boolean>(false);
  const [embedModelError, setEmbedModelError] = useState<string | null>(null);

  const user = authState.user;

  const knownVersion = localStorage.getItem(HIVA_KNOWN_VERSION_KEY);

  const handleManualUpdate = useCallback(async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus('Checking for updates...');
    
    let meta: Awaited<ReturnType<typeof checkForUpdate>> = null;
    try {
      meta = await checkForUpdate();
      if (!meta) {
        setUpdateStatus('Already up to date');
        setTimeout(() => setUpdateStatus(''), 3000);
        setIsCheckingUpdate(false);
        return;
      }

      setUpdateStatus(`Downloading v${meta.version}...`);
      // Manual flow: do NOT revoke the session on a 401/403 — surface why instead.
      const bytes = await downloadHIV(meta, { revokeOnAuthError: false });

      if (bytes) {
        setUpdateStatus('Download complete!');
        await reload();
        setTimeout(() => setUpdateStatus(''), 3000);
      } else {
        setUpdateStatus(`Download failed — keeping current version. Try again later.`);
        setTimeout(() => setUpdateStatus(''), 5000);
      }
    } catch (err) {
      if (err instanceof HivAuthError) {
        // 401/403: the update was found but the code can't download it.
        const signedIn = (await getToken()) !== null;
        setUpdateStatus(
          signedIn
            ? `Update available (v${meta?.version ?? '?'}), but your access code isn't authorized to download it. Contact your supervisor.`
            : `Update available (v${meta?.version ?? '?'}). Sign in with an authorized access code to download it.`
        );
        setTimeout(() => setUpdateStatus(''), 8000);
      } else {
        setUpdateStatus('Update error');
        setTimeout(() => setUpdateStatus(''), 3000);
      }
    }

    setIsCheckingUpdate(false);
  }, [reload]);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/');
  }, [logout, navigate]);

  const handleUpdateCode = useCallback(() => {
    handleLogout();
  }, [handleLogout]);

  const handleSttLangChange = useCallback((code: string) => {
    setSttLang(code);
    localStorage.setItem(STT_LANG_STORAGE_KEY, code);
  }, []);


  const handleDownloadEmbedModel = useCallback(async () => {
    setDownloadingEmbedModel(true);
    setEmbedModelError(null);
    try {
      const result = await downloadEmbeddingModel();
      if (result.success) {
        setEmbedModelDownloaded(true);
      } else {
        setEmbedModelError('Download failed');
        setTimeout(() => setEmbedModelError(null), 5000);
      }
    } catch (err) {
      setEmbedModelError(err instanceof Error ? err.message : 'Download failed');
      setTimeout(() => setEmbedModelError(null), 5000);
    }
    setDownloadingEmbedModel(false);
  }, []);

  React.useEffect(() => {
    const checkEmbedModel = async () => {
      setCheckingEmbedModel(true);
      const info = await isEmbeddingModelDownloaded();
      setEmbedModelDownloaded(info.downloaded);
      setCheckingEmbedModel(false);

      if (!info.downloaded) {
        console.log('[E5-small-v2] Not found, starting auto-download...');
        handleDownloadEmbedModel();
      }
    };
    checkEmbedModel();
  }, [handleDownloadEmbedModel]);


  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <TopBar title="Settings" />

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* User info */}
        <div className="text-center pb-4 border-b border-border-subtle">
          <div className="mx-auto mb-3">
            <HivaLogo size={64} />
          </div>
          <h2 className="font-display font-semibold text-lg text-n-900 dark:text-n-100">
            {user?.name ?? 'Health Worker'}
          </h2>
          <p className="text-sm font-body text-n-500">
            {user?.facility ?? 'Unknown Facility'}
          </p>
        </div>

        {/* Language */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Language
          </h3>
          <LanguageSelector value={language} onChange={setLanguage} />
        </section>

        {/* Server Connection */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Server Connection
          </h3>
          <ServerCodeDisplay onUpdate={handleUpdateCode} />
        </section>

        {/* Appearance */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Appearance
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle">
            <AppearanceSettings
              interactionMode={interactionMode}
              onModeChange={setInteractionMode}
            />
          </div>
        </section>

        {/* Voice Output */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Voice Output
          </h3>
          <TTSSettings />
        </section>

        {/* Voice Input Language */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Voice Input Language
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle">
            <p className="text-xs font-body text-n-500 mb-3 leading-relaxed">
              Choose the language HIVA listens for when you speak. Requires a compatible speech recognition engine on your device.
            </p>
            <STTLanguageSelector value={sttLang} onChange={handleSttLangChange} />
          </div>
        </section>

        {/* AI Models */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            AI Models
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-3">
            {/* HIVA Model (bundled in APK, always active) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-body font-medium text-n-800 dark:text-n-200">
                  HIVA Model
                </span>
                <span className="text-xs font-mono px-2 py-1 rounded bg-success/10 text-success">
                  Active
                </span>
              </div>
              <p className="text-xs font-body text-n-500 leading-relaxed">
                Clinical AI model for on-device medical guidance. Bundled with the app (219 MB).
              </p>
            </div>

            {/* E5-small-v2 model (for NativeRetriever HNSW search) */}
            <div className="pt-3 border-t border-border-subtle space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-body font-medium text-n-800 dark:text-n-200">
                  Retrieval Model
                </span>
                <span className={clsx(
                  'text-xs font-mono px-2 py-1 rounded',
                  embedModelDownloaded
                    ? 'bg-success/10 text-success'
                    : 'bg-n-100 dark:bg-n-800 text-n-500'
                )}>
                  {checkingEmbedModel ? 'Checking...' : embedModelDownloaded ? 'Installed' : 'Not installed'}
                </span>
              </div>
              <p className="text-xs font-body text-n-500 leading-relaxed">
                {embedModelDownloaded
                  ? 'E5 retrieval model installed for semantic search (~67 MB).'
                  : 'Download retrieval model for enhanced search (~67 MB).'}
              </p>

              {!embedModelDownloaded && !downloadingEmbedModel && (
                <button
                  onClick={handleDownloadEmbedModel}
                  disabled={checkingEmbedModel}
                  className={clsx(
                    'w-full px-4 py-3 rounded-lg font-body font-medium text-sm transition-all',
                    'bg-primary hover:bg-primary-dark text-white',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  <ChevronRight size={16} />
                  Download Retrieval Model (~67 MB)
                </button>
              )}

              {downloadingEmbedModel && (
                <div className="space-y-2">
                  <div className="flex items-center justify-center text-xs font-body text-n-600 dark:text-n-400">
                    <span>Downloading retrieval model...</span>
                  </div>
                  <div className="w-full h-2 bg-n-100 dark:bg-n-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary animate-pulse"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              {embedModelError && (
                <div className="p-3 rounded-lg bg-error/10 text-error text-sm font-body">
                  {embedModelError}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Data File Update */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Clinical Data
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Loaded version</span>
              <span className="text-sm font-mono text-n-800 dark:text-n-200">
                {file?.manifest?.version ?? knownVersion ?? 'None'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Chunks</span>
              <span className="text-sm font-mono text-n-800 dark:text-n-200">
                {file?.chunks?.length ?? 0}
              </span>
            </div>
            {file?.manifest?.coverage_score !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-body text-n-600 dark:text-n-400">Coverage</span>
                <span className={clsx(
                  'text-sm font-mono font-medium',
                  file.manifest.coverage_score >= 0.95 ? 'text-success' :
                  file.manifest.coverage_score >= 0.80 ? 'text-warning' : 'text-error'
                )}>
                  {Math.round(file.manifest.coverage_score * 100)}%
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Status</span>
              <span className="text-sm font-body text-n-800 dark:text-n-200">
                {isLoading ? 'Loading...' : file ? 'Ready' : 'No data'}
              </span>
            </div>

            {/* Document sources */}
            {file?.manifest?.document_sources && file.manifest.document_sources.length > 0 && (
              <div className="pt-2 border-t border-border-subtle">
                <span className="text-xs font-body font-medium text-n-500 uppercase tracking-wider mb-2 block">
                  Sources
                </span>
                <ul className="space-y-2">
                  {file.manifest.document_sources.map((doc) => (
                    <li key={doc.id} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-body text-n-700 dark:text-n-300">
                          {doc.name}
                        </p>
                        <p className="text-[10px] font-body text-n-400">
                          {doc.publisher}{doc.year ? ` · ${doc.year}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {updateStatus && (
              <div className="text-xs font-body text-accent-500 animate-pulse">
                {updateStatus}
              </div>
            )}
            <button
              type="button"
              onClick={handleManualUpdate}
              disabled={isCheckingUpdate}
              className="w-full flex items-center justify-center gap-2 pt-3 border-t border-border-subtle text-sm font-body font-medium text-accent-500 hover:text-accent-500 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>
        </section>

        {/* Analytics & Privacy */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            Analytics & Privacy
          </h3>
          <AnalyticsSettings />
        </section>

        {/* App Info */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            App Info
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">App version</span>
              <span className="text-sm font-mono text-n-800 dark:text-n-200">v{APP_VERSION}</span>
            </div>
            <button
              type="button"
              className="w-full flex items-center justify-between pt-3 border-t border-border-subtle text-sm font-body text-accent-500 hover:text-accent-500 transition-colors"
            >
              View Changelog
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* Logout */}
        <motion.button
          type="button"
          onClick={handleLogout}
          whileTap={{ scale: 0.98 }}
          className="w-full h-12 rounded-xl bg-error/5 border border-error/20 text-error font-body font-semibold flex items-center justify-center gap-2 hover:bg-error/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </motion.button>
      </div>
    </div>
  );
};

export default SettingsScreen;
