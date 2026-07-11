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
          {/* Official HIVA logo — uses the actual brand asset */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
            className="flex flex-col items-center"
          >
            <img
              src="/icon-512.png"
              alt="HIVA"
              className="w-40 h-40 object-contain"
              draggable={false}
            />

            {/* Brand name */}
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="text-4xl font-display font-bold tracking-tight mt-4"
              style={{ color: '#1B4332' }}
            >
              HIVA
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.4 }}
              className="text-sm font-body font-medium mt-1 tracking-wide"
              style={{ color: '#C99338' }}
            >
              Medichat
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.9, duration: 0.4 }}
              className="text-[10px] font-body mt-3 tracking-[0.12em] uppercase"
              style={{ color: '#1B4332' }}
            >
              Intelligence. Connected. Trusted.
            </motion.p>
          </motion.div>

          {/* Loading indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="mt-12 flex items-center gap-2"
          >
            {[0, 0.15, 0.3].map((delay, i) => (
              <motion.div
                key={i}
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1, repeat: Infinity, delay }}
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: i === 1 ? '#C99338' : '#1B4332' }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
