/**
 * App.tsx — Root component
 * Wraps the app in AuthProvider, ThemeProvider, and MobileShell
 *
 * Note: Model download is triggered manually from Settings > Intelligence
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { TTSProvider } from '@/context/TTSContext';
import { HIVFileProvider } from '@/context/HIVFileContext';
import { Router } from '@/router/Router';
import { MobileShell } from '@/components/shell/MobileShell';
import SplashScreen from '@/components/ui/SplashScreen';
import { initAnalytics } from '@/services/analyticsService';
import { initSync } from '@/services/analyticsSyncService';

const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setShowSplash(false);
    }

    // Initialize analytics system (fails silently if error)
    initAnalytics().catch((err) => {
      console.warn('[App] Analytics init failed:', err);
    });

    // Start background sync (fails silently if error)
    initSync().catch((err) => {
      console.warn('[App] Sync init failed:', err);
    });
  }, []);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} duration={2500} />;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <HIVFileProvider>
          <TTSProvider>
            <MobileShell>
              <Router />
            </MobileShell>
          </TTSProvider>
        </HIVFileProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
