"use client";

/**
 * MurmurWave — reusable canvas particle + sine-wave layer.
 *
 * The single visual motif for "this surface is alive": a terrain of softly
 * drifting stars above an organic wave. Designed to feel like a star-sea —
 * particles vary dramatically in size, drift at different speeds, cluster
 * with terrain (right-high / left-low), and pulse with rhythm when playing.
 *
 * Used on:
 *   - Vibe cards (the bottom half — one per card)
 *   - SongDetail cover (background, behind play disc)
 *   - Studio hero card
 *   - Topup balance card (subtle, behind the number)
 *   - Hum processing state (overlay, faster particle rise)
 *
 * Pure canvas + requestAnimationFrame. No GSAP, no Three. GPU-friendly,
 * respects `prefers-reduced-motion`.
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

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  drift: number;
  life: number;
  maxLife: number;
  twinklePhase: number;
  twinkleSpeed: number;
  /** 0 = tiny dust, 1 = bright star */
  brightness: number;
}

export function MurmurWaveCanvas({
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

    const stars: Star[] = [];
    let t = 0;
    let raf = 0;
    // Rhythm pulse accumulator — simulates a 4/4 beat feel
    let pulsePhase = 0;

    /** Terrain height: right side is higher (lower y) than left.
     *  Creates a gentle slope + wave undulation. */
    const terrainY = (x: number, baseY: number, amp: number, phase: number): number => {
      // Slope: right side noticeably higher than left
      const slope = (x / w) * h * 0.22;
      return (
        baseY -
        slope +
        Math.sin(x * 0.008 + phase) * amp * 1.2 +
        Math.sin(x * 0.022 + phase * 1.5) * amp * 0.5 +
        Math.sin(x * 0.04 + phase * 2.3) * amp * 0.2
      );
    };

    const spawnStar = (baseY: number, amp: number, phase: number): Star => {
      const x = Math.random() * w;
      const wy = terrainY(x, baseY, amp, phase);
      const { isPlaying: playing } = stateRef.current;

      // 70% tiny dust, 20% medium, 10% bright stars
      const roll = Math.random();
      let brightness: number;
      let radius: number;
      if (roll < 0.7) {
        brightness = 0.15 + Math.random() * 0.25;
        radius = 0.5 + Math.random() * 1.0;
      } else if (roll < 0.9) {
        brightness = 0.4 + Math.random() * 0.3;
        radius = 1.2 + Math.random() * 1.5;
      } else {
        brightness = 0.75 + Math.random() * 0.25;
        radius = 2.0 + Math.random() * 2.5;
      }

      return {
        x,
        y: wy - 2 - Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.08 + Math.random() * (playing ? 0.35 : 0.2),
        r: radius,
        drift: (Math.random() - 0.5) * 0.6,
        life: 0,
        maxLife: 100 + Math.random() * 140,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.02 + Math.random() * 0.04,
        brightness,
      };
    };

    const tick = () => {
      t += reduceMotion ? 0 : 0.016;

      const { intensity: int, isPlaying: playing } = stateRef.current;
      const baseY = h * waveY;
      const amp = h * (0.03 + int * 0.03) * (playing ? 1.5 : 1);
      const phase = t * (playing ? 1.2 : 0.6);

      // Rhythm pulse — 4/4 beat at ~120 BPM feel
      pulsePhase += playing ? 0.06 : 0.02;
      const pulse = playing
        ? 0.7 + 0.3 * Math.pow(Math.max(0, Math.sin(pulsePhase * 2)), 3)
        : 1;

      ctx.clearRect(0, 0, w, h);

      // ── Filled wave (organic terrain shape) ──────────────────────
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = terrainY(x, baseY, amp * pulse, phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, baseY - h * 0.1, 0, h);
      grad.addColorStop(0, hexAlpha(color, 0.22 * pulse));
      grad.addColorStop(0.6, hexAlpha(color, 0.1));
      grad.addColorStop(1, hexAlpha(color, 0.03));
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Wave stroke (terrain edge highlight) ────────────────────
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = terrainY(x, baseY, amp * pulse, phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(color, (playing ? 0.45 : 0.28) * pulse);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // ── Stars (the star-sea) ────────────────────────────────────
      const target = Math.floor(
        20 + int * 30 + (playing ? 25 : 0),
      );
      while (stars.length < target) {
        stars.push(spawnStar(baseY, amp, phase));
      }

      for (let i = stars.length - 1; i >= 0; i--) {
        const p = stars[i]!;
        // Slow upward drift — stars float, not bubble
        p.y -= p.vy * (playing ? 1.1 : 0.8) * pulse;
        // Horizontal drift with gentle sine wobble
        p.x += p.drift + Math.sin(t * 0.8 + p.twinklePhase) * 0.15;
        p.life++;

        if (p.life > p.maxLife || p.y < -10 || p.x < -10 || p.x > w + 10) {
          stars.splice(i, 1);
          continue;
        }

        const lifePct = p.life / p.maxLife;
        // Smooth fade in then out
        const fadeIn = Math.min(1, lifePct * 5);
        const fadeOut = 1 - Math.pow(lifePct, 2);
        // Twinkle
        const twinkle = 0.6 + 0.4 * Math.sin(p.twinklePhase + t * p.twinkleSpeed * 60);
        const alpha = fadeIn * fadeOut * p.brightness * twinkle * (playing ? 1.15 : 0.9);

        const currentR = p.r * (1 - lifePct * 0.2) * (playing ? 1 + 0.15 * pulse : 1);

        // Bright stars get a soft glow
        if (p.brightness > 0.6 && currentR > 1.5) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentR * 3, 0, Math.PI * 2);
          ctx.fillStyle = hexAlpha(color, alpha * 0.12);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR, 0, Math.PI * 2);
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
