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
            background: 'linear-gradient(145deg, #0D1B2A 0%, #1B2D44 50%, #0D1B2A 100%)',
          }}
        >
          {/* Subtle grid pattern overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.04]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
              backgroundSize: '32px 32px',
            }}
          />

          {/* Logo container */}
          <div className="relative mb-8" style={{ width: 200, height: 200 }}>

            {/* Glow pulse behind logo */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(0,102,255,0.15) 0%, transparent 70%)',
              }}
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.2, 0.5] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Secondary glow — teal */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(0,201,167,0.1) 0%, transparent 70%)',
              }}
              animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Rotating ring — blue */}
            <motion.svg
              viewBox="0 0 200 200"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
            >
              <circle
                cx="100"
                cy="100"
                r="85"
                stroke="url(#splash-ring-grad)"
                strokeWidth="1"
                strokeDasharray="8 12"
                fill="none"
                opacity="0.4"
              />
              <defs>
                <linearGradient id="splash-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0066FF"/>
                  <stop offset="100%" stopColor="#00C9A7"/>
                </linearGradient>
              </defs>
            </motion.svg>

            {/* Counter-rotating ring — teal */}
            <motion.svg
              viewBox="0 0 200 200"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: -360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            >
              <circle
                cx="100"
                cy="100"
                r="72"
                stroke="#00C9A7"
                strokeWidth="0.8"
                strokeDasharray="4 8"
                fill="none"
                opacity="0.3"
              />
            </motion.svg>

            {/* HIVA logo mark */}
            <motion.img
              src="/icon-192.png"
              alt="HIVA"
              className="absolute inset-0 w-full h-full object-cover"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, ease: 'easeOut', delay: 0.3 }}
            />
          </div>

          {/* Brand name */}
          <div className="text-center mb-1">
            <h1 className="text-4xl font-display font-bold tracking-tight text-white">
              {letters.map((ch, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.8 + i * 0.08,
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
              transition={{ delay: 1.2, duration: 0.6 }}
              className="text-sm font-body font-medium mt-2 tracking-[0.06em]"
              style={{ color: '#00C9A7' }}
            >
              Medichat
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              transition={{ delay: 1.5, duration: 0.6 }}
              className="text-[10px] font-body mt-2 tracking-[0.15em] uppercase text-n-400"
            >
              Trusted Intelligence. Institutional Impact.
            </motion.p>
          </div>

          {/* Loading indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6 }}
            className="mt-10 flex items-center gap-2"
          >
            {[0, 0.2, 0.4].map((delay, i) => (
              <motion.div
                key={i}
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay }}
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: i === 1 ? '#00C9A7' : '#0066FF' }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
