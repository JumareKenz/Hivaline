/**
 * StatusPill — "Offline Ready" animated status indicator
 */

import React from 'react';
import { clsx } from 'clsx';

interface StatusPillProps {
  status?: 'offline' | 'online' | 'syncing';
  label?: string;
}

const StatusPill: React.FC<StatusPillProps> = ({ status = 'offline', label }) => {
  const displayLabel = label ?? (status === 'offline' ? 'Offline Ready' : status === 'syncing' ? 'Syncing...' : 'Online');

  return (
    <span
      role="status"
      className={clsx(
        'inline-flex items-center gap-1.5',
        'px-2.5 py-1 rounded-full',
        'text-xs font-body font-medium',
        'bg-success/10 text-success border border-success/30',
        status === 'syncing' && 'bg-warning/10 text-warning border-warning/30'
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className={clsx(
          'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
          status === 'syncing' ? 'bg-warning' : 'bg-success'
        )} />
        <span className={clsx(
          'relative inline-flex rounded-full h-2 w-2',
          status === 'syncing' ? 'bg-warning' : 'bg-success'
        )} />
      </span>
      {displayLabel}
    </span>
  );
};

export { StatusPill };
