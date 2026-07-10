"use client";

/**
 * SteppedSlider — A slider with discrete snap points.
 *
 * Design: Elegant minimal slider with paper-textured thumb, soft colors,
 * and smooth transitions.
 */

import { useState, useRef } from "react";

interface SteppedSliderProps {
  /** Current value (1-based index) */
  value: number;
  /** Total number of steps */
  steps: number;
  /** Labels shown above the slider (e.g., ["Low", "Medium", "High"]) */
  labels?: string[];
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Accessible label */
  ariaLabel: string;
}

// Paper texture for thumb
const paperTextureStyle = {
  background: `
    linear-gradient(135deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.0) 100%
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0px,
      transparent 0.5px,
      transparent 1px,
      rgba(255, 255, 255, 0.04) 1.5px
    ),
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.03) 0px,
      transparent 0.5px,
      transparent 1px,
      rgba(255, 255, 255, 0.03) 1.5px
    ),
    #1A1A1A
  `,
};

export function SteppedSlider({
  value,
  steps,
  labels = [],
  onChange,
  ariaLabel,
}: SteppedSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Ensure value is within bounds
  const clampedValue = Math.max(1, Math.min(steps, value));

  // Convert 1-based value to 0-1 progress
  const progress = (clampedValue - 1) / (steps - 1);

  const handleInteraction = (clientX: number) => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));

    // Snap to nearest step
    const stepIndex = Math.round(ratio * (steps - 1));
    const newValue = stepIndex + 1;

    if (newValue !== clampedValue) {
      onChange(newValue);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    handleInteraction(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      handleInteraction(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="w-full">
      {/* Labels */}
      {labels.length > 0 && (
        <div className="mb-8 flex items-center justify-between relative">
          {labels.map((label, i) => {
            const tickProgress = i / (steps - 1);
            return (
              <span
                key={i}
                className="text-[14px] leading-none text-[#1A1A1A] font-medium"
                style={{
                  position: "absolute",
                  left: `${tickProgress * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

      {/* Slider track */}
      <div
        ref={trackRef}
        className="relative h-16 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={1}
        aria-valuemax={steps}
        aria-valuenow={clampedValue}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(Math.max(1, clampedValue - 1));
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(Math.min(steps, clampedValue + 1));
          }
        }}
      >
        {/* Track line */}
        <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#E5DDD0] rounded-full" />

        {/* Progress line */}
        <div
          className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#8C8780] rounded-full transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />

        {/* Tick marks */}
        {Array.from({ length: steps }).map((_, i) => {
          const tickProgress = i / (steps - 1);
          const isActive = i < clampedValue;
          return (
            <div
              key={i}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
              style={{ left: `${tickProgress * 100}%` }}
            >
              <div
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  isActive ? "bg-[#8C8780]" : "bg-[#E5DDD0]"
                }`}
              />
            </div>
          );
        })}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-200 ease-out"
          style={{
            left: `${progress * 100}%`,
            transform: `translate(-50%, -50%) scale(${isDragging ? 1.05 : 1})`,
          }}
        >
          <div
            className="h-11 w-11 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.25)] border-[3px] border-white"
            style={paperTextureStyle}
          />
        </div>
      </div>
    </div>
  );
}
