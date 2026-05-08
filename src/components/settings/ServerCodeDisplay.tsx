/**
 * ServerCodeDisplay — active server connection card
 */

import React from 'react';
import { Wifi, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ServerCodeDisplayProps {
  onUpdate?: () => void;
  onSync?: () => void;
}

const ServerCodeDisplay: React.FC<ServerCodeDisplayProps> = ({ onUpdate, onSync }) => {
  const { state: authState } = useAuth();
  const user = authState.user;

  if (!user) return null;

  return (
    <div className="p-4 rounded-xl bg-surface border border-border-subtle space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-body font-medium text-n-500 uppercase tracking-wider">
          Active Server Code
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-body font-medium">
          <Wifi className="w-3 h-3" />
          Connected
        </span>
      </div>

      <div>
        <p className="font-mono text-xl text-n-900 dark:text-n-100 tracking-wider">
          {user.serverCode}
        </p>
        <p className="text-xs font-body text-n-500 mt-1">
          {user.supervisor}
        </p>
      </div>

      <div className="flex gap-2 pt-2 border-t border-border-subtle">
        {onUpdate && (
          <button
            type="button"
            onClick={onUpdate}
            className="flex-1 h-10 rounded-lg bg-n-100 dark:bg-n-800 text-n-700 dark:text-n-300 font-body font-medium text-sm hover:bg-n-200 dark:hover:bg-n-700 transition-colors"
          >
            Update Code
          </button>
        )}
        {onSync && (
          <button
            type="button"
            onClick={onSync}
            className="flex-1 h-10 rounded-lg bg-accent-600 text-white font-body font-medium text-sm hover:bg-accent-500 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync Now
          </button>
        )}
      </div>
    </div>
  );
};

export { ServerCodeDisplay };
