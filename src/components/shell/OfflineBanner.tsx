/**
 * OfflineBanner — slim, non-intrusive "working offline" indicator.
 *
 * Shown whenever the auth session is in offline-grace mode (running on a
 * persisted/expired token, or on a device with clinical data but no live
 * server confirmation). Disappears automatically when connectivity returns
 * and the token is silently re-validated.
 */

import React, { useContext } from 'react';
import { WifiOff } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';

const OfflineBanner: React.FC = () => {
  const ctx = useContext(AuthContext);
  if (!ctx || !ctx.state.offlineGrace) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-3 py-1.5 bg-warning/10 text-warning border-b border-warning/20"
    >
      <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-body text-[11px] leading-none">
        Working offline — sync when connected
      </span>
    </div>
  );
};

export { OfflineBanner };
