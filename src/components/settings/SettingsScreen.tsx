/**
 * SettingsScreen — settings shell with all sections
 */

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LogOut, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/router/useRouter';
import { APP_VERSION, STT_LANG_STORAGE_KEY } from '@/utils/constants';
import { TopBar } from '@/components/ui/TopBar';
import { HivaLogo } from '@/components/ui/HivaLogo';
import { LanguageSelector } from './LanguageSelector';
import { AppearanceSettings } from './AppearanceSettings';
import { ServerCodeDisplay } from './ServerCodeDisplay';
import { TTSSettings } from './TTSSettings';
import { STTLanguageSelector } from './STTLanguageSelector';
import { sttService } from '@/services/sttService';
import type { Language, InteractionMode } from '@/types/hiv';

const SettingsScreen: React.FC = () => {
  const { state: authState, logout } = useAuth();
  const { navigate } = useRouter();

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

  const user = authState.user;

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

        {/* App Info */}
        <section>
          <h3 className="text-xs font-body font-medium text-n-500 uppercase tracking-widest mb-3 px-1">
            App Info
          </h3>
          <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Version</span>
              <span className="text-sm font-mono text-n-800 dark:text-n-200">HIVALINE v{APP_VERSION}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Data file</span>
              <span className="text-sm font-mono text-n-800 dark:text-n-200">FMOH-NG-2024-v3.hiv</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-n-600 dark:text-n-400">Last sync</span>
              <span className="text-sm font-body text-n-800 dark:text-n-200">Today</span>
            </div>
            <button
              type="button"
              className="w-full flex items-center justify-between pt-3 border-t border-border-subtle text-sm font-body text-accent-600 hover:text-accent-500 transition-colors"
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
