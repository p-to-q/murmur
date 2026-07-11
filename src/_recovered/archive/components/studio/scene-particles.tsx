"use client";

import { useMemo } from "react";

interface SceneParticlesProps {
  /** Hex color used for the dots */
  color: string;
  /** Slight per-card offset so the 5 cards don't pulse in lock-step */
  seed?: number;
  /** Pause animation when card isn't visible to save CPU */
  paused?: boolean;
}

/**
 * Diffusing dots that rise from the bottom of a scene card.
 * Lightweight: ~10 absolutely positioned spans, CSS keyframes only,
 * no per-frame JS. Each card gets its own staggered seed so they don't
 * pulse in unison.
 */
export function SceneParticles({ color, seed = 0, paused = false }: SceneParticlesProps) {
  const dots = useMemo(() => {
    const rand = mulberry32(0x9e3779b1 ^ (seed + 1));
    return Array.from({ length: 11 }, (_, i) => ({
      id: i,
      left: 6 + rand() * 88, // 6%..94%
      size: 3 + rand() * 5, // 3..8 px
      delay: rand() * 4, // 0..4s stagger
      duration: 3.4 + rand() * 2.2, // 3.4..5.6s
      drift: (rand() - 0.5) * 28, // -14..14 px sideways drift
      opacity: 0.45 + rand() * 0.4,
    }));
  }, [seed]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] overflow-hidden rounded-b-[22px]"
      aria-hidden
    >
      <div
        className="absolute inset-x-0 bottom-0 h-[42%]"
        style={{
          background: `radial-gradient(ellipse at 50% 100%, ${hexA(color, 0.22)} 0%, ${hexA(color, 0.04)} 60%, transparent 75%)`,
        }}
      />
      {dots.map((d) => (
        <span
          key={d.id}
          className="scene-particle"
          style={
            {
              left: `${d.left}%`,
              width: `${d.size}px`,
              height: `${d.size}px`,
              backgroundColor: color,
              opacity: d.opacity,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.duration}s`,
              animationPlayState: paused ? "paused" : "running",
              "--drift": `${d.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* Deterministic small RNG so each card's pattern is stable across renders */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexA(hex: string, alpha: number) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(255,138,92,${alpha})`;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}
