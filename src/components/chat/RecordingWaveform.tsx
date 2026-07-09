/**
 * RecordingWaveform — animated audio waveform during voice recording
 */

import React from 'react';
import { clsx } from 'clsx';

interface RecordingWaveformProps {
  isRecording: boolean;
  className?: string;
}

const RecordingWaveform: React.FC<RecordingWaveformProps> = ({ isRecording, className }) => {
  const bars = [0.3, 0.5, 0.8, 1.0, 0.7, 0.4, 0.6, 0.9, 0.5, 0.3];

  return (
    <div className={clsx('flex items-center justify-center gap-0.5 h-6', className)}>
      {bars.map((height, i) => (
        <span
          key={i}
          className={clsx(
            'w-0.5 rounded-full bg-accent-500',
            'transition-all duration-150',
            isRecording && 'animate-pulse'
          )}
          style={{
            height: isRecording ? `${height * 24}px` : '4px',
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </div>
  );
};

export { RecordingWaveform };
