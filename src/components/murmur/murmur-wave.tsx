"use client";

/**
 * MurmurWave — star-sea particle system.
 *
 * Inspired by Sky: Children of the Light's Season of Stars.
 * Features:
 *   - Cluster-based spawning (4 drifting anchor points)
 *   - Multi-directional drift (not upward bubbles)
 *   - Independent breathing cycles per star
 *   - Three depth layers (far/mid/near) with size + speed scaling
 *   - Occasional shooting stars when playing
 *   - Warm amber glow overlay on top of per-card accent color
 *   - Rhythmic pulse when isPlaying
 *   - Organic terrain wave at the bottom
 *
 * Pure canvas 2D + requestAnimationFrame. GPU-friendly, respects
 * `prefers-reduced-motion`.
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

const MAX_STARS = 180;
const NUM_CLUSTERS = 4;
const SHOOTING_INTERVAL_MIN = 3000;
const SHOOTING_INTERVAL_MAX = 7000;
const WARM_R = 255;
const WARM_G = 214;
const WARM_B = 138;

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  breathPhase: number;
  breathSpeed: number;
  brightness: number;
  depth: number;
  life: number;
  maxLife: number;
}

interface Cluster {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Shooting {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  trail: Array<{ x: number; y: number; a: number }>;
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
    const rgb = hexToRgb(color);

    // ── Clusters ────────────────────────────────────────────────────
    const clusters: Cluster[] = [];
    const initClusters = () => {
      clusters.length = 0;
      for (let i = 0; i < NUM_CLUSTERS; i++) {
        clusters.push({
          x: w * (0.15 + Math.random() * 0.7),
          y: h * (0.1 + Math.random() * 0.6),
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.08,
          radius: w * (0.12 + Math.random() * 0.18),
        });
      }
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (clusters.length === 0) initClusters();
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── Stars ───────────────────────────────────────────────────────
    const stars: Star[] = [];

    const spawnStar = (): Star => {
      const ci = Math.floor(Math.random() * clusters.length);
      const c = clusters[ci]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * c.radius;

      const depthRoll = Math.random();
      const depth = depthRoll < 0.4 ? 0 : depthRoll < 0.8 ? 1 : 2;
      const depthScale = [0.4, 1.0, 1.6][depth]!;
      const speedScale = [0.3, 0.7, 1.2][depth]!;

      const bRoll = Math.random();
      const brightness =
        bRoll < 0.65 ? 0.1 + Math.random() * 0.2
        : bRoll < 0.88 ? 0.35 + Math.random() * 0.3
        : 0.7 + Math.random() * 0.3;

      return {
        x: c.x + Math.cos(angle) * dist,
        y: c.y + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.25 * speedScale + c.vx * 0.5,
        vy: (Math.random() - 0.5) * 0.12 * speedScale + c.vy * 0.5,
        size: (0.6 + Math.random() * 2.5) * depthScale,
        breathPhase: Math.random() * Math.PI * 2,
        breathSpeed: 0.015 + Math.random() * 0.03,
        brightness,
        depth,
        life: 0,
        maxLife: 200 + Math.random() * 300,
      };
    };

    // Pre-fill
    for (let i = 0; i < MAX_STARS * 0.5; i++) {
      const s = spawnStar();
      s.life = Math.random() * s.maxLife * 0.4;
      stars.push(s);
    }

    // ── Shooting stars ──────────────────────────────────────────────
    const shootings: Shooting[] = [];
    let nextShootAt = performance.now() + SHOOTING_INTERVAL_MIN + Math.random() * (SHOOTING_INTERVAL_MAX - SHOOTING_INTERVAL_MIN);

    let t = 0;
    let pulsePhase = 0;
    let raf = 0;

    const tick = (now: number) => {
      t += reduceMotion ? 0 : 0.016;
      const { intensity: int, isPlaying: playing } = stateRef.current;
      const baseY = h * waveY;
      const amp = h * (0.025 + int * 0.025) * (playing ? 1.4 : 1);
      const phase = t * (playing ? 0.9 : 0.5);

      pulsePhase += playing ? 0.055 : 0.015;
      const pulse = playing
        ? 0.75 + 0.25 * Math.pow(Math.max(0, Math.sin(pulsePhase * 2)), 2.5)
        : 1;

      ctx.clearRect(0, 0, w, h);

      // ── Update clusters ─────────────────────────────────────────
      for (const c of clusters) {
        c.x += c.vx;
        c.y += c.vy;
        if (c.x < w * 0.1 || c.x > w * 0.9) c.vx *= -0.8;
        if (c.y < h * 0.05 || c.y > h * 0.7) c.vy *= -0.8;
        c.vx += (Math.random() - 0.5) * 0.005;
        c.vy += (Math.random() - 0.5) * 0.003;
      }

      // ── Spawn ───────────────────────────────────────────────────
      const target = Math.floor(40 + int * 60 + (playing ? 40 : 0));
      while (stars.length < Math.min(target, MAX_STARS)) {
        stars.push(spawnStar());
      }

      // ── Draw stars (sorted far→near) ────────────────────────────
      stars.sort((a, b) => a.depth - b.depth);

      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]!;
        s.life++;

        if (s.life > s.maxLife || s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) {
          stars.splice(i, 1);
          continue;
        }

        s.x += s.vx + Math.sin(t * 0.4 + s.breathPhase) * 0.06;
        s.y += s.vy + Math.cos(t * 0.3 + s.breathPhase * 1.3) * 0.04;

        const breathCycle = Math.sin(s.breathPhase + t * s.breathSpeed * 60);
        const breathAlpha = 0.3 + 0.7 * ((breathCycle + 1) * 0.5);

        const lifePct = s.life / s.maxLife;
        const fadeIn = Math.min(1, lifePct * 8);
        const fadeOut = lifePct > 0.7 ? 1 - ((lifePct - 0.7) / 0.3) : 1;

        const a = fadeIn * fadeOut * breathAlpha * s.brightness * pulse;
        const sz = s.size * (playing ? 1 + 0.1 * pulse : 1);

        if (a < 0.01) continue;

        // Warm glow for bright stars
        if (s.brightness > 0.4 && sz > 1.2) {
          const gr = sz * 4;
          const gg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, gr);
          gg.addColorStop(0, `rgba(${WARM_R},${WARM_G},${WARM_B},${a * 0.12})`);
          gg.addColorStop(1, `rgba(${WARM_R},${WARM_G},${WARM_B},0)`);
          ctx.beginPath();
          ctx.arc(s.x, s.y, gr, 0, Math.PI * 2);
          ctx.fillStyle = gg;
          ctx.fill();
        }

        // Core
        const cg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sz * 1.5);
        cg.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
        cg.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a * 0.5})`);
        cg.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        ctx.beginPath();
        ctx.arc(s.x, s.y, sz * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = cg;
        ctx.fill();

        // White center for brightest
        if (s.brightness > 0.65) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, sz * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`;
          ctx.fill();
        }
      }

      // ── Shooting stars ──────────────────────────────────────────
      if (playing && now >= nextShootAt) {
        const sx = Math.random() * w * 0.6 + w * 0.2;
        const ang = -Math.PI * 0.15 + (Math.random() - 0.5) * 0.3;
        const spd = 3 + Math.random() * 4;
        shootings.push({
          x: sx,
          y: h * 0.05 + Math.random() * h * 0.3,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0,
          maxLife: 30 + Math.random() * 20,
          trail: [],
        });
        nextShootAt = now + SHOOTING_INTERVAL_MIN + Math.random() * (SHOOTING_INTERVAL_MAX - SHOOTING_INTERVAL_MIN);
      }

      for (let i = shootings.length - 1; i >= 0; i--) {
        const ss = shootings[i]!;
        ss.life++;
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.trail.push({ x: ss.x, y: ss.y, a: 1 });
        for (const tp of ss.trail) tp.a *= 0.88;
        ss.trail = ss.trail.filter((tp) => tp.a > 0.02);

        if (ss.life > ss.maxLife) {
          shootings.splice(i, 1);
          continue;
        }

        const sa = ss.life < 5 ? ss.life / 5 : ss.life > ss.maxLife - 8 ? (ss.maxLife - ss.life) / 8 : 1;

        for (const tp of ss.trail) {
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,248,230,${tp.a * sa * 0.5})`;
          ctx.fill();
        }

        const hg = ctx.createRadialGradient(ss.x, ss.y, 0, ss.x, ss.y, 4);
        hg.addColorStop(0, `rgba(255,255,255,${sa * 0.9})`);
        hg.addColorStop(0.5, `rgba(255,248,230,${sa * 0.3})`);
        hg.addColorStop(1, "rgba(255,248,230,0)");
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = hg;
        ctx.fill();
      }

      // ── Layered mist waves (4 layers, no hard edge) ────────────
      // Each layer has a slightly different frequency/phase/height,
      // overlapping semi-transparently to create an organic fog-sea.
      const waveLayers = [
        { yOff: 0,        freqA: 0.005, freqB: 0.013, freqC: 0.029, ampMul: 1.0,  phaseMul: 1.0, alpha: 0.14 },
        { yOff: h * 0.04, freqA: 0.007, freqB: 0.017, freqC: 0.033, ampMul: 0.7,  phaseMul: 1.3, alpha: 0.10 },
        { yOff: h * 0.08, freqA: 0.009, freqB: 0.021, freqC: 0.041, ampMul: 0.45, phaseMul: 1.7, alpha: 0.07 },
        { yOff: h * 0.13, freqA: 0.011, freqB: 0.025, freqC: 0.047, ampMul: 0.25, phaseMul: 2.1, alpha: 0.04 },
      ];

      for (const layer of waveLayers) {
        const layerBaseY = baseY + layer.yOff;
        const layerAmp = amp * layer.ampMul * pulse;
        const layerPhase = phase * layer.phaseMul;

        ctx.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const slope = (x / w) * h * 0.06;
          const y =
            layerBaseY - slope +
            Math.sin(x * layer.freqA + layerPhase) * layerAmp * 1.2 +
            Math.sin(x * layer.freqB + layerPhase * 1.4) * layerAmp * 0.5 +
            Math.sin(x * layer.freqC + layerPhase * 2.0) * layerAmp * 0.2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        // Vertical gradient: color fades to transparent toward bottom
        const lg = ctx.createLinearGradient(0, layerBaseY - h * 0.05, 0, h);
        lg.addColorStop(0, hexAlpha(color, layer.alpha * pulse));
        lg.addColorStop(0.4, hexAlpha(color, layer.alpha * 0.5 * pulse));
        lg.addColorStop(1, hexAlpha(color, 0.01));
        ctx.fillStyle = lg;
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

/* ── Helpers ──────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function hexAlpha(hex: string, alpha01: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return `#${h}${a.toString(16).padStart(2, "0")}`;
}
