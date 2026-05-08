import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete, duration = 2500 }) => {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const hideTimer = setTimeout(() => setShow(false), duration);
    const doneTimer = setTimeout(onComplete, duration + 500);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, [duration, onComplete]);

  const letters = 'HIVA'.split('');

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(145deg, #fafaf9 0%, #f5f5f4 50%, #e7e5e4 100%)',
          }}
        >
          {/* Noise texture overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            }}
          />

          {/* Logo container — 200px */}
          <div className="relative mb-8" style={{ width: 200, height: 200 }}>

            {/* Ping ripple — green */}
            <svg
              viewBox="0 0 120 120"
              className="absolute inset-0 w-full h-full"
              style={{ overflow: 'visible' }}
            >
              <motion.circle
                cx="60"
                cy="60"
                r="56"
                stroke="#155D46"
                strokeWidth="1.5"
                fill="none"
                animate={{ r: [56, 78], opacity: [0.4, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut', repeatDelay: 0.5 }}
              />
            </svg>

            {/* Ping ripple — tan, offset start */}
            <svg
              viewBox="0 0 120 120"
              className="absolute inset-0 w-full h-full"
              style={{ overflow: 'visible' }}
            >
              <motion.circle
                cx="60"
                cy="60"
                r="56"
                stroke="#C9A96E"
                strokeWidth="1"
                fill="none"
                animate={{ r: [56, 78], opacity: [0.3, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut', delay: 1.25, repeatDelay: 0.5 }}
              />
            </svg>

            {/* Radar sweep — rotating clockwise 45° sector */}
            <motion.svg
              viewBox="0 0 120 120"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: 'center' }}
            >
              <path
                d="M 60 60 L 60 4 A 56 56 0 0 1 99.6 20.4 Z"
                fill="#155D46"
                fillOpacity="0.07"
              />
            </motion.svg>

            {/* Outer solid ring + 4 cardinal tick marks — rotating CW */}
            <motion.svg
              viewBox="0 0 120 120"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: 'center' }}
            >
              <circle cx="60" cy="60" r="56" stroke="#155D46" strokeWidth="3" fill="none" />
              <circle cx="60" cy="4" r="2.5" fill="#155D46" />
              <circle cx="116" cy="60" r="2.5" fill="#155D46" />
              <circle cx="60" cy="116" r="2.5" fill="#155D46" />
              <circle cx="4" cy="60" r="2.5" fill="#155D46" />
            </motion.svg>

            {/* Inner dotted ring + 4 orbital particles — rotating CCW */}
            <motion.svg
              viewBox="0 0 120 120"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: -360 }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: 'center' }}
            >
              <circle cx="60" cy="60" r="48" stroke="#C9A96E" strokeWidth="1.5" strokeDasharray="3 4" fill="none" />
              {/* particles fade by size to imply depth/speed */}
              <circle cx="60" cy="12" r="3" fill="#C9A96E" opacity="0.9" />
              <circle cx="108" cy="60" r="2.5" fill="#C9A96E" opacity="0.7" />
              <circle cx="60" cy="108" r="2" fill="#C9A96E" opacity="0.5" />
              <circle cx="12" cy="60" r="1.5" fill="#C9A96E" opacity="0.3" />
            </motion.svg>

            {/* H letter — bouncing with eased spring */}
            <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full">
              <motion.path
                d="M42 38v44M78 38v44M42 60h36"
                stroke="#155D46"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                animate={{ y: [0, -11, 0, -5, 0] }}
                transition={{
                  duration: 2.2,
                  repeat: Infinity,
                  ease: [0.36, 0.07, 0.19, 0.97],
                  repeatDelay: 0.5,
                }}
              />
            </svg>

            {/* Center dot — bouncing with scale pulse */}
            <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full">
              <motion.circle
                cx="60"
                cy="60"
                r="5"
                fill="#C9A96E"
                animate={{
                  cy: [60, 50, 60, 55, 60],
                  r: [5, 6.5, 5, 5.8, 5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 0.3,
                  repeatDelay: 0.5,
                }}
              />
            </svg>
          </div>

          {/* Brand name — letter-by-letter spring entrance */}
          <div className="text-center mb-1">
            <h1
              className="text-4xl font-display font-bold tracking-tight"
              style={{ color: '#155D46' }}
            >
              {letters.map((ch, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.4 + i * 0.065,
                    type: 'spring',
                    stiffness: 500,
                    damping: 28,
                  }}
                  style={{ display: 'inline-block' }}
                >
                  {ch}
                </motion.span>
              ))}
            </h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.85, duration: 0.6 }}
              className="text-sm font-body font-medium mt-1 tracking-[0.12em] uppercase"
              style={{ color: '#C9A96E' }}
            >
              Clinical AI · Offline Ready
            </motion.p>
          </div>

          {/* Loading dots */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.3 }}
            className="mt-10 flex items-center gap-2"
          >
            {[0, 0.2, 0.4].map((delay, i) => (
              <motion.div
                key={i}
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay }}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#155D46' }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
