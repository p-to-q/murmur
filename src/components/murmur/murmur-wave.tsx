"use client";

/**
 * MurmurWave — reusable canvas particle + sine-wave layer.
 *
 * The single visual motif for "this surface is alive": a soft horizontal wave
 * with particles rising above it. Used on:
 *   - Vibe cards (the bottom half — one per card)
 *   - SongDetail cover (background, behind play disc)
 *   - Topup balance card (subtle, behind the number)
 *   - Hum processing state (overlay, faster particle rise)
 *
 * Pure canvas + requestAnimationFrame. No GSAP, no Three. ~120 lines, GPU-
 * friendly, respects `prefers-reduced-motion`.
 *
 * Props are deliberately tiny — `color`, `intensity` (0–1), `isPlaying`. The
 * component owns its motion shape; callers don't tune internals.
 */

import { useEffect, useRef } from "react";

export interface MurmurWaveProps {
  /** Hex string like "#FF8A5C" — drives wave + particle color. */
  color: string;
  /** 0–1 — baseline density + amplitude. Default 0.55. */
  intensity?: number;
  /** When true, particles + wave move ~40 % faster, +50 % density. */
  isPlaying?: boolean;
  /** Wave baseline as a fraction of canvas height (0=top, 1=bottom). Default 0.55. */
  waveY?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vy: number;
  r: number;
  drift: number;
  life: number;
  maxLife: number;
}

export function MurmurWave({
  color,
  intensity = 0.55,
  isPlaying = false,
  waveY = 0.55,
  className,
}: MurmurWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ intensity, isPlaying });

  useEffect(() => {
    stateRef.current = { intensity, isPlaying };
  }, [intensity, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const particles: Particle[] = [];
    let t = 0;
    let raf = 0;

    const spawnParticle = (baseY: number, amp: number, phase: number): Particle => {
      const x = Math.random() * w;
      const wy =
        baseY +
        Math.sin(x * 0.012 + phase) * amp +
        Math.sin(x * 0.028 + phase * 1.7) * (amp * 0.4);
      const { isPlaying: playing } = stateRef.current;
      return {
        x,
        y: wy - 2,
        vy: 0.22 + Math.random() * (playing ? 0.7 : 0.42),
        r: 1 + Math.random() * 2.0,
        drift: (Math.random() - 0.5) * 0.4,
        life: 0,
        maxLife: 75 + Math.random() * 90,
      };
    };

    const tick = () => {
      t += reduceMotion ? 0 : 0.016;

      const { intensity: int, isPlaying: playing } = stateRef.current;
      const baseY = h * waveY;
      const amp = h * (0.035 + int * 0.025) * (playing ? 1.4 : 1);
      const phase = t * (playing ? 1.5 : 0.85);

      ctx.clearRect(0, 0, w, h);

      // ── Filled wave (gradient down to bottom edge) ───────────────
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y =
          baseY +
          Math.sin(x * 0.012 + phase) * amp +
          Math.sin(x * 0.028 + phase * 1.7) * (amp * 0.4);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, baseY, 0, h);
      grad.addColorStop(0, hexAlpha(color, 0.28));
      grad.addColorStop(1, hexAlpha(color, 0.05));
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Wave stroke (top edge highlight) ─────────────────────────
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y =
          baseY +
          Math.sin(x * 0.012 + phase) * amp +
          Math.sin(x * 0.028 + phase * 1.7) * (amp * 0.4);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(color, playing ? 0.55 : 0.36);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ── Particles ────────────────────────────────────────────────
      const target = Math.floor(
        8 + int * 14 + (playing ? 14 : 0),
      );
      while (particles.length < target) {
        particles.push(spawnParticle(baseY, amp, phase));
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.y -= p.vy * (playing ? 1.3 : 1);
        p.x += p.drift + Math.sin(t * 1.4 + i) * 0.18;
        p.life++;
        if (p.life > p.maxLife || p.y < 0 || p.x < -8 || p.x > w + 8) {
          particles.splice(i, 1);
          continue;
        }
        const k = p.life / p.maxLife;
        const alpha = (1 - k) * (0.6 + (playing ? 0.18 : 0));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - k * 0.4), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(color, alpha);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color, waveY]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}

/** Append an 8-bit alpha to a `#rrggbb` color. Tolerates missing `#`. */
function hexAlpha(hex: string, alpha01: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return `#${h}${a.toString(16).padStart(2, "0")}`;
}
