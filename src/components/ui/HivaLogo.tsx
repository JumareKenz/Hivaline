/**
 * HivaLogo — consistent brand logo component
 * Uses the geometric H-in-circle mark with teal ring + tan dot
 */

import React from 'react';
import { clsx } from 'clsx';

interface HivaLogoProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

const HivaLogo: React.FC<HivaLogoProps> = ({ size = 64, className, animate = false }) => {
  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-2xl bg-white shadow-lg',
        animate && 'animate-hiva-float',
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer solid ring */}
        <circle cx="60" cy="60" r="56" stroke="#155D46" strokeWidth="3"/>
        {/* Inner dotted ring */}
        <circle cx="60" cy="60" r="48" stroke="#C9A96E" strokeWidth="1.5" strokeDasharray="3 4"/>
        {/* H letter */}
        <path
          d="M42 38v44M78 38v44M42 60h36"
          stroke="#155D46"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Center dot */}
        <circle cx="60" cy="60" r="5" fill="#C9A96E"/>
      </svg>
    </div>
  );
};

export { HivaLogo };
