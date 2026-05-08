/**
 * SafeArea — padding wrapper for safe area insets
 */

import React from 'react';
import { clsx } from 'clsx';

interface SafeAreaProps {
  children: React.ReactNode;
  className?: string;
  top?: boolean;
  bottom?: boolean;
}

const SafeArea: React.FC<SafeAreaProps> = ({ children, className, top = true, bottom = true }) => {
  return (
    <div
      className={clsx(
        top && 'pt-[env(safe-area-inset-top)]',
        bottom && 'pb-[env(safe-area-inset-bottom)]',
        className
      )}
    >
      {children}
    </div>
  );
};

export { SafeArea };
