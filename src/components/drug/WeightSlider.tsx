/**
 * WeightSlider — custom styled range slider
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { Minus, Plus } from 'lucide-react';
import { MIN_WEIGHT_KG, MAX_WEIGHT_KG } from '@/utils/constants';

interface WeightSliderProps {
  value: number;
  onChange: (value: number) => void;
}

const WeightSlider: React.FC<WeightSliderProps> = ({ value, onChange }) => {
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  }, [onChange]);

  const decrement = useCallback(() => {
    onChange(Math.max(MIN_WEIGHT_KG, value - 1));
  }, [value, onChange]);

  const increment = useCallback(() => {
    onChange(Math.min(MAX_WEIGHT_KG, value + 1));
  }, [value, onChange]);

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Weight display */}
      <div className="text-center">
        <span className="font-display font-bold text-5xl text-accent-600 tabular-nums">
          {value}
        </span>
        <span className="font-display font-medium text-xl text-n-500 ml-1">kg</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 w-full">
        <button
          type="button"
          onClick={decrement}
          aria-label="Decrease weight"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-n-100 dark:bg-n-800 text-n-600 dark:text-n-300 hover:bg-n-200 dark:hover:bg-n-700 active:scale-95 transition-all"
        >
          <Minus className="w-4 h-4" />
        </button>

        <div className="flex-1 relative">
          <input
            type="range"
            min={MIN_WEIGHT_KG}
            max={MAX_WEIGHT_KG}
            value={value}
            onChange={handleSliderChange}
            className={clsx(
              'w-full h-2 rounded-full appearance-none cursor-pointer',
              'bg-n-200 dark:bg-n-700',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:w-6',
              '[&::-webkit-slider-thumb]:h-6',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:bg-white',
              '[&::-webkit-slider-thumb]:shadow-md',
              '[&::-webkit-slider-thumb]:border-2',
              '[&::-webkit-slider-thumb]:border-accent-600',
              '[&::-webkit-slider-thumb]:cursor-pointer',
              '[&::-moz-range-thumb]:w-6',
              '[&::-moz-range-thumb]:h-6',
              '[&::-moz-range-thumb]:rounded-full',
              '[&::-moz-range-thumb]:bg-white',
              '[&::-moz-range-thumb]:shadow-md',
              '[&::-moz-range-thumb]:border-2',
              '[&::-moz-range-thumb]:border-accent-600',
              '[&::-moz-range-thumb]:cursor-pointer',
              '[&::-moz-range-thumb]:border-none'
            )}
            style={{
              background: `linear-gradient(to right, #155D46 0%, #155D46 ${((value - MIN_WEIGHT_KG) / (MAX_WEIGHT_KG - MIN_WEIGHT_KG)) * 100}%, #e7e5e4 ${((value - MIN_WEIGHT_KG) / (MAX_WEIGHT_KG - MIN_WEIGHT_KG)) * 100}%, #e7e5e4 100%)`
            }}
          />
        </div>

        <button
          type="button"
          onClick={increment}
          aria-label="Increase weight"
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-n-100 dark:bg-n-800 text-n-600 dark:text-n-300 hover:bg-n-200 dark:hover:bg-n-700 active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export { WeightSlider };
