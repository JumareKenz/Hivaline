/**
 * AnalyticsSettings.tsx — Analytics consent and privacy controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Toggle } from '@/components/ui/Toggle';
import {
  getPreferences,
  updatePreferences,
  enableChatCollection,
  disableChatCollection,
  disableAnalytics,
  getSummary,
  clearAllData,
} from '@/services/analyticsService';
import { getSyncStatus, triggerManualSync } from '@/services/analyticsSyncService';
import type { UserAnalyticsPreferences, AnalyticsSummary } from '@/types/analytics';

export const AnalyticsSettings: React.FC = () => {
  const [prefs, setPrefs] = useState<UserAnalyticsPreferences | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [prefsData, summaryData] = await Promise.all([
        getPreferences(),
        getSummary(),
      ]);
      setPrefs(prefsData);
      setSummary(summaryData);
    } catch (err) {
      console.error('[AnalyticsSettings] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleAnalytics = useCallback(async (enabled: boolean) => {
    try {
      if (!enabled) {
        // Disabling analytics also disables chat collection
        await disableAnalytics();
      } else {
        await updatePreferences({ analytics_enabled: true });
      }
      await loadData();
    } catch (err) {
      console.error('[AnalyticsSettings] Failed to toggle analytics:', err);
    }
  }, [loadData]);

  const handleToggleChatCollection = useCallback(async (enabled: boolean) => {
    if (enabled) {
      // Show consent dialog before enabling
      setShowConsentDialog(true);
    } else {
      try {
        await disableChatCollection();
        await loadData();
      } catch (err) {
        console.error('[AnalyticsSettings] Failed to disable chat collection:', err);
      }
    }
  }, [loadData]);

  const handleAcceptConsent = useCallback(async () => {
    try {
      await enableChatCollection();
      setShowConsentDialog(false);
      await loadData();
    } catch (err) {
      console.error('[AnalyticsSettings] Failed to enable chat collection:', err);
    }
  }, [loadData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const success = await triggerManualSync();
      if (success) {
        await loadData(); // Refresh summary
      }
    } catch (err) {
      console.error('[AnalyticsSettings] Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const handleClearData = useCallback(async () => {
    if (!confirm('Clear all analytics data? This cannot be undone.')) {
      return;
    }

    try {
      await clearAllData();
      await loadData();
    } catch (err) {
      console.error('[AnalyticsSettings] Failed to clear data:', err);
    }
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-surface border border-border-subtle">
        <div className="animate-pulse text-sm text-n-500">Loading...</div>
      </div>
    );
  }

  const syncStatus = getSyncStatus();

  return (
    <>
      <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-4">
        {/* Anonymous Analytics Toggle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label htmlFor="analytics-toggle" className="text-sm font-body font-medium text-n-800 dark:text-n-200 cursor-pointer">
                Anonymous Analytics
              </label>
              <p className="text-xs font-body text-n-500 mt-1">
                Track usage patterns (no personal data stored)
              </p>
            </div>
            <Toggle
              id="analytics-toggle"
              checked={prefs?.analytics_enabled ?? true}
              onChange={handleToggleAnalytics}
            />
          </div>

          {prefs?.analytics_enabled && (
            <div className="pl-4 border-l-2 border-accent-200 dark:border-accent-800">
              <p className="text-xs font-body text-n-600 dark:text-n-400 leading-relaxed">
                ✓ Query categories (malaria, diarrhea, etc.)
                <br />
                ✓ Intent types (symptom check, dosage, etc.)
                <br />
                ✓ Language mode (english, pidgin, mixed)
                <br />
                ✓ Response times and result counts
                <br />
                <span className="text-error font-medium">✗ No full query text stored</span>
                <br />
                <span className="text-error font-medium">✗ No patient health information</span>
              </p>
            </div>
          )}
        </div>

        {/* Chat Collection Toggle (Consent-gated) */}
        <div className="pt-3 border-t border-border-subtle space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label htmlFor="chat-collection-toggle" className="text-sm font-body font-medium text-n-800 dark:text-n-200 cursor-pointer">
                Chat Session Collection
              </label>
              <p className="text-xs font-body text-n-500 mt-1">
                Help improve AI by sharing full conversations
              </p>
            </div>
            <Toggle
              id="chat-collection-toggle"
              checked={prefs?.chat_collection_enabled ?? false}
              onChange={handleToggleChatCollection}
              disabled={!prefs?.analytics_enabled}
            />
          </div>

          {prefs?.chat_collection_enabled && (
            <div className="pl-4 border-l-2 border-warning-200 dark:border-warning-800">
              <p className="text-xs font-body text-warning-700 dark:text-warning-400 leading-relaxed">
                ⓘ Full message history is collected for AI training.
                <br />
                ⓘ Device ID is pseudonymized (SHA-256 hash).
                <br />
                ⓘ You can opt-out anytime.
              </p>
            </div>
          )}
        </div>

        {/* Sync Status */}
        {prefs?.analytics_enabled && (
          <div className="pt-3 border-t border-border-subtle space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-body font-medium text-n-500 uppercase tracking-wider">
                Sync Status
              </span>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs font-body text-accent-600 hover:text-accent-500 transition-colors"
              >
                {showDetails ? 'Hide' : 'Show'} details
              </button>
            </div>

            {showDetails && summary && (
              <div className="space-y-2 text-xs font-body">
                <div className="flex justify-between">
                  <span className="text-n-500">Events tracked:</span>
                  <span className="font-mono text-n-800 dark:text-n-200">{summary.total_events}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-n-500">Pending sync:</span>
                  <span className={clsx(
                    'font-mono',
                    summary.pending_sync_events > 0 ? 'text-warning' : 'text-success'
                  )}>
                    {summary.pending_sync_events}
                  </span>
                </div>
                {prefs.chat_collection_enabled && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-n-500">Sessions collected:</span>
                      <span className="font-mono text-n-800 dark:text-n-200">{summary.total_sessions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-n-500">Sessions pending:</span>
                      <span className={clsx(
                        'font-mono',
                        summary.pending_sync_sessions > 0 ? 'text-warning' : 'text-success'
                      )}>
                        {summary.pending_sync_sessions}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-n-500">Last sync:</span>
                  <span className={clsx(
                    'font-mono text-xs',
                    syncStatus.last_sync_success ? 'text-success' : 'text-error'
                  )}>
                    {syncStatus.last_sync_timestamp
                      ? new Date(syncStatus.last_sync_timestamp).toLocaleTimeString()
                      : 'Never'
                    }
                  </span>
                </div>

                <button
                  onClick={handleSync}
                  disabled={syncing || syncStatus.is_syncing}
                  className={clsx(
                    'w-full mt-2 px-3 py-2 rounded-lg text-xs font-body font-medium transition-colors',
                    'bg-accent-600 hover:bg-accent-500 text-white',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {syncing || syncStatus.is_syncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Clear Data */}
        {summary && (summary.total_events > 0 || summary.total_sessions > 0) && (
          <div className="pt-3 border-t border-border-subtle">
            <button
              onClick={handleClearData}
              className="text-xs font-body text-error hover:text-error/80 transition-colors"
            >
              Clear all analytics data
            </button>
          </div>
        )}

        {/* Privacy Notice */}
        <div className="pt-3 border-t border-border-subtle">
          <p className="text-[10px] font-body text-n-400 leading-relaxed">
            All analytics data is encrypted in transit and stored securely.
            Anonymous analytics help improve the app without compromising patient privacy.
            Chat collection requires your explicit consent and can be disabled anytime.
          </p>
        </div>
      </div>

      {/* Consent Dialog */}
      {showConsentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-display font-semibold text-n-900 dark:text-n-100">
              Enable Chat Collection?
            </h3>

            <div className="space-y-3 text-sm font-body text-n-700 dark:text-n-300">
              <p>
                By enabling this feature, you consent to sharing <strong>full conversation messages</strong> to help improve our AI models.
              </p>

              <div className="p-3 rounded-lg bg-n-50 dark:bg-n-900 space-y-2 text-xs">
                <p className="font-medium text-n-900 dark:text-n-100">What we collect:</p>
                <ul className="space-y-1 pl-4 list-disc text-n-600 dark:text-n-400">
                  <li>Complete message history (your questions + AI responses)</li>
                  <li>Session metadata (category, topics, duration)</li>
                  <li>Optional: Your feedback ratings</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-accent-50 dark:bg-accent-900/20 space-y-2 text-xs">
                <p className="font-medium text-accent-900 dark:text-accent-100">Privacy protections:</p>
                <ul className="space-y-1 pl-4 list-disc text-accent-700 dark:text-accent-300">
                  <li>Device ID is pseudonymized (SHA-256 hash)</li>
                  <li>Data used only for AI training</li>
                  <li>You can opt-out anytime</li>
                  <li>Compliant with NDPR/GDPR</li>
                </ul>
              </div>

              <p className="text-xs text-n-500">
                Your participation helps us build better clinical decision support tools for health workers across Nigeria and beyond.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowConsentDialog(false)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-n-100 dark:bg-n-800 text-n-700 dark:text-n-300 font-body font-medium text-sm hover:bg-n-200 dark:hover:bg-n-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptConsent}
                className="flex-1 px-4 py-2.5 rounded-lg bg-accent-600 text-white font-body font-medium text-sm hover:bg-accent-500 transition-colors"
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
