/**
 * MobileShell — phone frame wrapper with safe-area handling
 */

import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { OfflineBanner } from './OfflineBanner';

interface MobileShellProps {
  children: React.ReactNode;
}

const MobileShell: React.FC<MobileShellProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-n-100 dark:bg-n-950 p-4 md:p-8">
      {/* Phone frame (desktop only) */}
      <div className="relative w-full max-w-[390px] h-[100dvh] md:h-[844px] md:rounded-[40px] md:border-[8px] md:border-n-800 md:shadow-2xl overflow-hidden bg-bg-primary dark:bg-n-900">
        {/* Status bar notch simulation */}
        <div className="hidden md:block absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-n-800 rounded-b-2xl z-50" />
        
        {/* Content */}
        <div className="h-full w-full flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
          <OfflineBanner />
          <div className="flex-1 overflow-hidden">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

export { MobileShell };
