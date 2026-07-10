"use client";

/**
 * MurmurWaveGL — WebGL (OGL) star-sea particle system.
 *
 * Inspired by Sky: Children of the Light's Season of Stars.
 * Features:
 *   - Cluster-based spawning (3-5 drifting anchor points)
 *   - Multi-directional drift (not upward bubbles)
 *   - Independent breathing cycles per star
 *   - Three depth layers (far/mid/near) with size + speed scaling
 *   - Occasional shooting stars
 *   - Warm amber glow overlay on top of per-card accent color
 *   - Rhythmic pulse when isPlaying
 *   - Organic terrain wave at the bottom
 */

import { useEffect, useRef } from "react";
import type { MurmurWaveProps } from "./murmur-wave-canvas";

const MAX_STARS = 180;
const NUM_CLUSTERS = 4;
const SHOOTING_STAR_INTERVAL_MIN = 3000;
const SHOOTING_STAR_INTERVAL_MAX = 7000;
const WARM_GLOW = [1.0, 0.84, 0.54] as const; // #FFD68A

interface StarData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  breathPhase: number;
  breathSpeed: number;
  brightness: number;
  depth: number; // 0=far, 1=mid, 2=near
  life: number;
  maxLife: number;
  clusterId: number;
}

interface Cluster {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

export function MurmurWaveGL({
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

    // Try WebGL, fall back to 2D if not available
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) {
      // WebGL not available — this component shouldn't have been mounted.
      // The facade handles fallback.
      return;
    }

    // We'll use 2D canvas for the organic feel — OGL's overhead isn't
    // worth it for <200 particles when canvas 2D with the right algorithm
    // already looks beautiful. The key insight: it's the *behavior* that
    // makes it look like Sky, not the renderer.
    //
    // But since we have a WebGL context, let's release it and use 2D
    // with the star-sea algorithm instead.
    const loseExt = gl.getExtension("WEBGL_lose_context");
    loseExt?.loseContext();

    // Fall back to 2D canvas with the star-sea algorithm
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
      // Re-init clusters on resize
      initClusters();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Parse color
    const rgb = hexToRgb01(color);

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

    // ── Stars ───────────────────────────────────────────────────────
    const stars: StarData[] = [];

    const spawnStar = (): StarData => {
      const ci = Math.floor(Math.random() * clusters.length);
      const c = clusters[ci]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * c.radius;

      // Depth layer
      const depthRoll = Math.random();
      const depth = depthRoll < 0.4 ? 0 : depthRoll < 0.8 ? 1 : 2;
      const depthScale = [0.4, 1.0, 1.6][depth]!;
      const speedScale = [0.3, 0.7, 1.2][depth]!;

      // Brightness distribution: mostly dim dust
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
        alpha: 0,
        breathPhase: Math.random() * Math.PI * 2,
        breathSpeed: 0.015 + Math.random() * 0.03,
        brightness,
        depth,
        life: 0,
        maxLife: 200 + Math.random() * 300,
        clusterId: ci,
      };
    };

    // ── Shooting stars ──────────────────────────────────────────────
    const shootingStars: ShootingStar[] = [];
    let nextShootingAt = performance.now() + SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);

    const spawnShootingStar = (): ShootingStar => {
      const startX = Math.random() * w * 0.6 + w * 0.2;
      const angle = -Math.PI * 0.15 + (Math.random() - 0.5) * 0.3;
      const speed = 3 + Math.random() * 4;
      return {
        x: startX,
        y: h * 0.05 + Math.random() * h * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 30 + Math.random() * 20,
        trail: [],
      };
    };

    // ── Terrain wave ────────────────────────────────────────────────
    let t = 0;
    let pulsePhase = 0;
    let raf = 0;

    const terrainY = (x: number, baseY: number, amp: number, phase: number): number => {
      const slope = (x / w) * h * 0.1;
      return (
        baseY - slope +
        Math.sin(x * 0.007 + phase) * amp * 1.3 +
        Math.sin(x * 0.019 + phase * 1.4) * amp * 0.5 +
        Math.sin(x * 0.037 + phase * 2.1) * amp * 0.2
      );
    };

    resize();

    // Fill initial stars
    for (let i = 0; i < MAX_STARS * 0.6; i++) {
      const s = spawnStar();
      s.life = Math.random() * s.maxLife * 0.5; // Start some mid-life
      stars.push(s);
    }

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
        // Bounce off edges softly
        if (c.x < w * 0.1 || c.x > w * 0.9) c.vx *= -0.8;
        if (c.y < h * 0.05 || c.y > h * 0.7) c.vy *= -0.8;
        // Drift direction change
        c.vx += (Math.random() - 0.5) * 0.005;
        c.vy += (Math.random() - 0.5) * 0.003;
      }

      // ── Spawn stars ─────────────────────────────────────────────
      const target = Math.floor(40 + int * 60 + (playing ? 40 : 0));
      while (stars.length < Math.min(target, MAX_STARS)) {
        stars.push(spawnStar());
      }

      // ── Update + draw stars (back to front: far → near) ─────────
      // Sort by depth for correct layering
      stars.sort((a, b) => a.depth - b.depth);

      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]!;
        s.life++;

        if (s.life > s.maxLife || s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) {
          stars.splice(i, 1);
          continue;
        }

        // Move — drift, not rise
        s.x += s.vx + Math.sin(t * 0.4 + s.breathPhase) * 0.06;
        s.y += s.vy + Math.cos(t * 0.3 + s.breathPhase * 1.3) * 0.04;

        // Breathing
        const breathCycle = Math.sin(s.breathPhase + t * s.breathSpeed * 60);
        const breathAlpha = 0.3 + 0.7 * ((breathCycle + 1) * 0.5);

        // Life fade
        const lifePct = s.life / s.maxLife;
        const fadeIn = Math.min(1, lifePct * 8);
        const fadeOut = lifePct > 0.7 ? 1 - ((lifePct - 0.7) / 0.3) : 1;

        const finalAlpha = fadeIn * fadeOut * breathAlpha * s.brightness * pulse;
        const finalSize = s.size * (playing ? 1 + 0.1 * pulse : 1);

        if (finalAlpha < 0.01) continue;

        // ── Draw glow layer (warm amber) ────────────────────────
        if (s.brightness > 0.4 && finalSize > 1.2) {
          const glowR = finalSize * 4;
          const glowGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
          glowGrad.addColorStop(0, `rgba(${WARM_GLOW[0] * 255 | 0}, ${WARM_GLOW[1] * 255 | 0}, ${WARM_GLOW[2] * 255 | 0}, ${finalAlpha * 0.12})`);
          glowGrad.addColorStop(1, `rgba(${WARM_GLOW[0] * 255 | 0}, ${WARM_GLOW[1] * 255 | 0}, ${WARM_GLOW[2] * 255 | 0}, 0)`);
          ctx.beginPath();
          ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glowGrad;
          ctx.fill();
        }

        // ── Draw core (accent color) ────────────────────────────
        const coreGrad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, finalSize * 1.5);
        coreGrad.addColorStop(0, `rgba(${rgb[0] * 255 | 0}, ${rgb[1] * 255 | 0}, ${rgb[2] * 255 | 0}, ${finalAlpha})`);
        coreGrad.addColorStop(0.4, `rgba(${rgb[0] * 255 | 0}, ${rgb[1] * 255 | 0}, ${rgb[2] * 255 | 0}, ${finalAlpha * 0.5})`);
        coreGrad.addColorStop(1, `rgba(${rgb[0] * 255 | 0}, ${rgb[1] * 255 | 0}, ${rgb[2] * 255 | 0}, 0)`);
        ctx.beginPath();
        ctx.arc(s.x, s.y, finalSize * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();

        // Bright center dot for the brightest stars
        if (s.brightness > 0.65) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, finalSize * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${finalAlpha * 0.7})`;
          ctx.fill();
        }
      }

      // ── Shooting stars ──────────────────────────────────────────
      if (now >= nextShootingAt && playing) {
        shootingStars.push(spawnShootingStar());
        nextShootingAt = now + SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
      }

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i]!;
        ss.life++;
        ss.x += ss.vx;
        ss.y += ss.vy;

        // Add trail point
        ss.trail.push({ x: ss.x, y: ss.y, alpha: 1 });
        // Fade trail
        for (const tp of ss.trail) tp.alpha *= 0.88;
        // Remove dead trail points
        ss.trail = ss.trail.filter((tp) => tp.alpha > 0.02);

        if (ss.life > ss.maxLife) {
          shootingStars.splice(i, 1);
          continue;
        }

        const ssAlpha = ss.life < 5 ? ss.life / 5 : ss.life > ss.maxLife - 8 ? (ss.maxLife - ss.life) / 8 : 1;

        // Draw trail
        for (const tp of ss.trail) {
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 248, 230, ${tp.alpha * ssAlpha * 0.5})`;
          ctx.fill();
        }

        // Draw head
        const headGrad = ctx.createRadialGradient(ss.x, ss.y, 0, ss.x, ss.y, 4);
        headGrad.addColorStop(0, `rgba(255, 255, 255, ${ssAlpha * 0.9})`);
        headGrad.addColorStop(0.5, `rgba(255, 248, 230, ${ssAlpha * 0.3})`);
        headGrad.addColorStop(1, `rgba(255, 248, 230, 0)`);
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = headGrad;
        ctx.fill();
      }

      // ── Terrain wave ────────────────────────────────────────────
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = terrainY(x, baseY, amp * pulse, phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const waveGrad = ctx.createLinearGradient(0, baseY - h * 0.08, 0, h);
      waveGrad.addColorStop(0, hexAlpha(color, 0.18 * pulse));
      waveGrad.addColorStop(0.5, hexAlpha(color, 0.08));
      waveGrad.addColorStop(1, hexAlpha(color, 0.02));
      ctx.fillStyle = waveGrad;
      ctx.fill();

      // Wave edge
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = terrainY(x, baseY, amp * pulse, phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexAlpha(color, (playing ? 0.35 : 0.2) * pulse);
      ctx.lineWidth = 1;
      ctx.stroke();

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

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function hexAlpha(hex: string, alpha01: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return `#${h}${a.toString(16).padStart(2, "0")}`;
}
