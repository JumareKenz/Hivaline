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
        'flex items-center justify-center rounded-2xl shadow-lg',
        animate && 'animate-hiva-float',
        className
      )}
      style={{ width: size, height: size, background: 'linear-gradient(135deg, #0D1B2A 0%, #1B2D44 100%)' }}
    >
      <svg
        width={size * 0.65}
        height={size * 0.65}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`hiva-logo-grad-${size}`} x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#0066FF"/>
            <stop offset="100%" stopColor="#00C9A7"/>
          </linearGradient>
        </defs>
        <path
          d="M25 60c0-15 10-27 22-27s17 10 15 20c-2.5 10 2.5 20 15 20s22-12 22-27c0 15-10 27-22 27s-17-10-15-20c2.5-10-2.5-20-15-20S25 45 25 60z"
          stroke={`url(#hiva-logo-grad-${size})`}
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

export { HivaLogo };
