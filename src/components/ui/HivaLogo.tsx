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
        'flex items-center justify-center rounded-2xl shadow-lg overflow-hidden flex-shrink-0',
        animate && 'animate-hiva-float',
        className
      )}
      style={{ width: size, height: size, background: '#ffffff', border: '1.5px solid #e2e8f0' }}
    >
      <img
        src="/icon-192.png"
        alt="HIVA"
        width={size}
        height={size}
        style={{ objectFit: 'contain', width: size, height: size }}
        draggable={false}
      />
    </div>
  );
};

export { HivaLogo };
