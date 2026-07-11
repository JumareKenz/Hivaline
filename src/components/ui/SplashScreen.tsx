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
          style={{ background: '#ffffff' }}
        >
          {/* Logo container */}
          <div className="relative mb-8" style={{ width: 160, height: 160 }}>

            {/* Glow pulse behind logo — forest green */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(22,58,40,0.08) 0%, transparent 70%)',
              }}
              animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.2, 0.5] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Secondary glow — gold */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(201,147,56,0.1) 0%, transparent 70%)',
              }}
              animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.5, 0.3] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Rotating ring — forest green */}
            <motion.svg
              viewBox="0 0 160 160"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
            >
              <circle
                cx="80"
                cy="80"
                r="68"
                stroke="#163A28"
                strokeWidth="1"
                strokeDasharray="8 12"
                fill="none"
                opacity="0.25"
              />
            </motion.svg>

            {/* Counter-rotating ring — gold */}
            <motion.svg
              viewBox="0 0 160 160"
              className="absolute inset-0 w-full h-full"
              animate={{ rotate: -360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            >
              <circle
                cx="80"
                cy="80"
                r="56"
                stroke="#C99338"
                strokeWidth="0.8"
                strokeDasharray="4 8"
                fill="none"
                opacity="0.4"
              />
            </motion.svg>

            {/* HIVA logo mark */}
            <motion.img
              src="/icon-192.png"
              alt="HIVA"
              className="absolute inset-0 w-full h-full object-contain"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, ease: 'easeOut', delay: 0.3 }}
            />
          </div>

          {/* Brand name */}
          <div className="text-center mb-1">
            <h1 className="text-4xl font-display font-bold tracking-tight" style={{ color: '#163A28' }}>
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
              style={{ color: '#C99338' }}
            >
              Medichat
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.65 }}
              transition={{ delay: 1.5, duration: 0.6 }}
              className="text-[10px] font-body mt-2 tracking-[0.15em] uppercase"
              style={{ color: '#163A28' }}
            >
              Intelligence. Connected. Trusted.
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
                style={{ backgroundColor: i === 1 ? '#C99338' : '#163A28' }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
