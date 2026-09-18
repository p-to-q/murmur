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
 *   - Ambient random meteors, with a deliberate cue on hover/focus
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
  /** Pointer/focus intent — wakes the horizon and triggers one meteor. */
  isEngaged?: boolean;
  /** Wave baseline as a fraction of canvas height (0=top, 1=bottom). Default 0.55. */
  waveY?: number;
  /** Keep the legacy mist-wave layer for callers without MurmurTide. */
  renderWaves?: boolean;
  className?: string;
}

const MAX_STARS = 180;
const NUM_CLUSTERS = 4;
const PLAYING_METEOR_INTERVAL_MIN = 3000;
const PLAYING_METEOR_INTERVAL_MAX = 7000;
const AMBIENT_METEOR_INTERVAL_MIN = 9000;
const AMBIENT_METEOR_INTERVAL_MAX = 18_000;
const METEOR_CAMERA_PITCH = Math.PI / 3;
// The two landscape cards are the composition reference. Keeping meteor
// projection in this canonical space prevents a taller first card from
// rotating or steepening the same trajectory.
const METEOR_REFERENCE_ASPECT = 1.56;
const METEOR_SEGMENTS = 24;
const METEOR_SCALE = 1.35;
const METEOR_TAIL_SCALE = 1.28;
const MAX_PIXEL_RATIO = 1.6;
const IDLE_FRAME_INTERVAL_MS = 1000 / 30;
const ACTIVE_FRAME_INTERVAL_MS = 1000 / 45;
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

type Vector3 = readonly [number, number, number];

interface Shooting {
  startedAtSeconds: number;
  durationSeconds: number;
  startDirection: Vector3;
  tangentDirection: Vector3;
  travelAngle: number;
  tailAngle: number;
  brightness: number;
  baseHalfWidth: number;
  pulseWidth: number;
}

export function MurmurWave({
  color,
  intensity = 0.55,
  isPlaying = false,
  isEngaged = false,
  waveY = 0.55,
  renderWaves = true,
  className,
}: MurmurWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ intensity, isPlaying, isEngaged });
  const requestFrameRef = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = { intensity, isPlaying, isEngaged };
    requestFrameRef.current();
  }, [intensity, isPlaying, isEngaged]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motionPreference = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    let reduceMotion = motionPreference?.matches ?? false;

    const lowPowerDevice =
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency <= 4;
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      lowPowerDevice ? 1.35 : MAX_PIXEL_RATIO,
    );
    const starBudget = lowPowerDevice ? 110 : MAX_STARS;
    canvas.dataset.samplingScale = dpr.toFixed(2);
    canvas.dataset.meteorProjection = "landscape-canonical";
    canvas.dataset.meteorVersion = "0";
    canvas.dataset.motion = reduceMotion ? "static" : "animated";
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
    let meteorVersion = 0;
    let nextShootAt =
      performance.now() +
      2800 +
      Math.random() * (AMBIENT_METEOR_INTERVAL_MIN - 2800);
    let wasEngaged = false;

    const scheduleNextShooting = (now: number, playing: boolean) => {
      const min = playing
        ? PLAYING_METEOR_INTERVAL_MIN
        : AMBIENT_METEOR_INTERVAL_MIN;
      const max = playing
        ? PLAYING_METEOR_INTERVAL_MAX
        : AMBIENT_METEOR_INTERVAL_MAX;
      nextShootAt = now + min + Math.random() * (max - min);
    };

    const spawnShooting = (now: number) => {
      const startX = randomBetween(-0.7, 0.7);
      const startY = randomBetween(0.28, 0.68);
      // Preserve Murmur's original direction language: every meteor travels
      // from left to right while rising, never mirrored or falling.
      const endX = startX + randomBetween(0.45, 0.9);
      const endY = startY + randomBetween(0.34, 0.62);
      const startDirection = meteorScreenDirection(
        startX,
        startY,
        METEOR_REFERENCE_ASPECT,
      );
      const endDirection = meteorScreenDirection(
        endX,
        endY,
        METEOR_REFERENCE_ASPECT,
      );
      const directionDot = clamp(
        dotVector(startDirection, endDirection),
        -1,
        1,
      );
      const travelAngle = Math.max(Math.acos(directionDot), 0.04);
      const tangentDirection = normalizeVector([
        endDirection[0] - startDirection[0] * directionDot,
        endDirection[1] - startDirection[1] * directionDot,
        endDirection[2] - startDirection[2] * directionDot,
      ]);

      shootings.push({
        startedAtSeconds: now / 1000,
        durationSeconds: randomBetween(0.64, 3.28 / 3),
        startDirection,
        tangentDirection,
        travelAngle,
        tailAngle:
          travelAngle * randomBetween(0.18, 0.28) * METEOR_TAIL_SCALE,
        brightness: randomBetween(0.82, 1.18) * 1.12,
        // Geometry follows the reference exactly; the only size adjustment is
        // a uniform enlargement, never a reduction of its parameters.
        baseHalfWidth: 0.5 * randomBetween(0.55, 1.25) * METEOR_SCALE,
        pulseWidth: randomBetween(0.2, 0.32) * METEOR_SCALE,
      });
      meteorVersion += 1;
      canvas.dataset.meteorVersion = String(meteorVersion);
    };

    let t = 0;
    let pulsePhase = 0;
    let raf = 0;
    let lastFrameAt = 0;
    let inViewport = true;
    let documentVisible = !document.hidden;

    const stopFrames = () => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const requestNextFrame = () => {
      if (raf !== 0 || !inViewport || !documentVisible) return;
      raf = requestAnimationFrame(tick);
    };
    requestFrameRef.current = requestNextFrame;

    const ro = new ResizeObserver(() => {
      resize();
      requestNextFrame();
    });
    ro.observe(canvas);

    const tick = (now: number) => {
      raf = 0;
      const {
        intensity: int,
        isPlaying: playing,
        isEngaged: engaged,
      } = stateRef.current;
      const frameInterval =
        playing || engaged || shootings.length > 0
          ? ACTIVE_FRAME_INTERVAL_MS
          : IDLE_FRAME_INTERVAL_MS;
      if (
        !reduceMotion &&
        lastFrameAt !== 0 &&
        now - lastFrameAt < frameInterval
      ) {
        requestNextFrame();
        return;
      }
      const elapsed = lastFrameAt === 0 ? 1000 / 60 : now - lastFrameAt;
      lastFrameAt = now;
      const motionScale = reduceMotion
        ? 0
        : Math.min(2.5, elapsed / (1000 / 60));
      t += 0.016 * motionScale;
      const baseY = h * waveY;
      const amp = h * (0.025 + int * 0.025) * (playing ? 1.4 : 1);
      const phase = t * (playing ? 0.9 : 0.5);

      pulsePhase += (playing ? 0.055 : 0.015) * motionScale;
      const pulse = playing
        ? 0.75 + 0.25 * Math.pow(Math.max(0, Math.sin(pulsePhase * 2)), 2.5)
        : 1;

      ctx.clearRect(0, 0, w, h);

      if (!reduceMotion && engaged && !wasEngaged) {
        spawnShooting(now);
        scheduleNextShooting(now, playing);
      }
      wasEngaged = engaged;

      // ── Update clusters ─────────────────────────────────────────
      if (!reduceMotion) {
        for (const c of clusters) {
          c.x += c.vx;
          c.y += c.vy;
          if (c.x < w * 0.1 || c.x > w * 0.9) c.vx *= -0.8;
          if (c.y < h * 0.05 || c.y > h * 0.7) c.vy *= -0.8;
          c.vx += (Math.random() - 0.5) * 0.005;
          c.vy += (Math.random() - 0.5) * 0.003;
        }
      }

      // ── Spawn ───────────────────────────────────────────────────
      const target = Math.floor(40 + int * 60 + (playing ? 40 : 0));
      while (stars.length < Math.min(target, starBudget)) {
        stars.push(spawnStar());
      }

      // ── Draw stars (sorted far→near) ────────────────────────────
      stars.sort((a, b) => a.depth - b.depth);

      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]!;
        s.life += motionScale;

        if (s.life > s.maxLife || s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) {
          stars.splice(i, 1);
          continue;
        }

        s.x += (s.vx + Math.sin(t * 0.4 + s.breathPhase) * 0.06) * motionScale;
        s.y += (s.vy + Math.cos(t * 0.3 + s.breathPhase * 1.3) * 0.04) * motionScale;

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
      if (!reduceMotion && now >= nextShootAt) {
        spawnShooting(now);
        scheduleNextShooting(now, playing);
      }

      for (let i = shootings.length - 1; i >= 0; i--) {
        const ss = shootings[i]!;
        const age = now / 1000 - ss.startedAtSeconds;
        if (age < 0 || age >= ss.durationSeconds) {
          shootings.splice(i, 1);
          continue;
        }

        const lifeProgress = clamp(age / ss.durationSeconds, 0, 1);
        const life =
          smoothstep(0, 0.1, lifeProgress) *
          (1 - smoothstep(0.76, 1, lifeProgress));
        const pulseCenter = 1.08 - meteorPulseSweep(lifeProgress) * 1.14;
        const leadingAngle = lifeProgress * ss.travelAngle;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(255,255,255,0.72)";

        for (let segment = 1; segment <= METEOR_SEGMENTS; segment++) {
          const previousProgress = (segment - 1) / METEOR_SEGMENTS;
          const progress = segment / METEOR_SEGMENTS;
          const previous = projectMeteorDirection(
            meteorDirectionAt(
              ss,
              leadingAngle - previousProgress * ss.tailAngle,
            ),
            METEOR_REFERENCE_ASPECT,
            w,
            h,
          );
          const point = projectMeteorDirection(
            meteorDirectionAt(ss, leadingAngle - progress * ss.tailAngle),
            METEOR_REFERENCE_ASPECT,
            w,
            h,
          );
          if (!previous || !point) continue;

          const pulseDistance = progress - pulseCenter;
          const broad = Math.exp(
            -Math.pow(pulseDistance / (ss.pulseWidth * 2), 2),
          );
          const body = Math.exp(
            -Math.pow(pulseDistance / ss.pulseWidth, 2),
          );
          const core = Math.exp(
            -Math.pow(pulseDistance / (ss.pulseWidth * 0.38), 2),
          );
          const pulseWidthGain = broad * 0.24 + body * 0.5 + core * 0.26;
          const widthTaper = Math.max(
            smoothstep(0, 0.055, progress) *
              (1 - smoothstep(0.7, 1, progress)),
            0.08,
          );
          const halfWidth =
            ss.baseHalfWidth * widthTaper +
            0.5 * METEOR_SCALE * pulseWidthGain;
          const trailFade =
            smoothstep(0, 0.045, progress) *
            (1 - smoothstep(0.72, 1, progress)) *
            mix(1, 0.18, Math.pow(progress, 0.72));
          const heat = clamp(
            broad * 0.16 + body * 0.68 + core * 0.36,
            0,
            1,
          );
          const radiance = 0.72 + body * 0.82 + core * 2.45;
          const alpha = clamp(
            life *
              trailFade *
              Math.min(previous.visibility, point.visibility) *
              ss.brightness *
              (0.28 + heat * radiance),
            0,
            1,
          );

          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          ctx.lineTo(point.x, point.y);
          ctx.lineWidth = Math.max(0.25, halfWidth * 2);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.shadowBlur = 2 + core * 7 * METEOR_SCALE;
          ctx.stroke();
        }
        ctx.restore();
      }

      if (renderWaves) {
        // Legacy fallback for callers that do not compose the dedicated
        // WebGL2/Canvas2D MurmurTide layer.
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

          const lg = ctx.createLinearGradient(0, layerBaseY - h * 0.05, 0, h);
          lg.addColorStop(0, hexAlpha(color, layer.alpha * pulse));
          lg.addColorStop(0.4, hexAlpha(color, layer.alpha * 0.5 * pulse));
          lg.addColorStop(1, hexAlpha(color, 0.01));
          ctx.fillStyle = lg;
          ctx.fill();
        }
      }

      if (!reduceMotion) requestNextFrame();
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true;
        if (inViewport) requestNextFrame();
        else stopFrames();
      },
      { rootMargin: "120px" },
    );
    intersectionObserver.observe(canvas);

    const handleVisibilityChange = () => {
      documentVisible = !document.hidden;
      lastFrameAt = 0;
      if (documentVisible) requestNextFrame();
      else stopFrames();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      lastFrameAt = 0;
      canvas.dataset.motion = reduceMotion ? "static" : "animated";
      requestNextFrame();
    };
    motionPreference?.addEventListener?.("change", handleMotionPreferenceChange);

    requestNextFrame();

    return () => {
      requestFrameRef.current = () => {};
      stopFrames();
      ro.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionPreference?.removeEventListener?.(
        "change",
        handleMotionPreferenceChange,
      );
    };
  }, [color, renderWaves, waveY]);

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function randomBetween(minimum: number, maximum: number): number {
  return mix(minimum, maximum, Math.random());
}

function normalizeVector([x, y, z]: Vector3): Vector3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function dotVector(first: Vector3, second: Vector3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function meteorScreenDirection(
  x: number,
  y: number,
  aspect: number,
): Vector3 {
  const direction = normalizeVector([x * aspect, y, 1]);
  const pitchCosine = Math.cos(METEOR_CAMERA_PITCH);
  const pitchSine = Math.sin(METEOR_CAMERA_PITCH);
  return normalizeVector([
    direction[0],
    direction[1] * pitchCosine + direction[2] * pitchSine,
    -direction[1] * pitchSine + direction[2] * pitchCosine,
  ]);
}

function meteorDirectionAt(meteor: Shooting, angle: number): Vector3 {
  return normalizeVector([
    meteor.startDirection[0] * Math.cos(angle) +
      meteor.tangentDirection[0] * Math.sin(angle),
    meteor.startDirection[1] * Math.cos(angle) +
      meteor.tangentDirection[1] * Math.sin(angle),
    meteor.startDirection[2] * Math.cos(angle) +
      meteor.tangentDirection[2] * Math.sin(angle),
  ]);
}

function projectMeteorDirection(
  localDirection: Vector3,
  aspect: number,
  width: number,
  height: number,
): { x: number; y: number; visibility: number } | null {
  const pitchCosine = Math.cos(METEOR_CAMERA_PITCH);
  const pitchSine = Math.sin(METEOR_CAMERA_PITCH);
  const cameraX = localDirection[0];
  const cameraY =
    localDirection[1] * pitchCosine - localDirection[2] * pitchSine;
  const cameraZ =
    localDirection[1] * pitchSine + localDirection[2] * pitchCosine;
  if (cameraZ <= 0.0001) return null;

  const ndcX = cameraX / (cameraZ * aspect);
  const ndcY = cameraY / cameraZ;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    visibility: smoothstep(0, 0.08, localDirection[1]),
  };
}

function meteorPulseSweep(progress: number): number {
  const target = clamp(progress, 0, 1);
  let parameter = target;
  for (let iteration = 0; iteration < 5; iteration++) {
    const error =
      cubicBezierCoordinate(parameter, 0.1, 0.5) - target;
    const derivative = Math.max(
      cubicBezierDerivative(parameter, 0.1, 0.5),
      0.0001,
    );
    parameter = clamp(parameter - error / derivative, 0, 1);
  }
  return cubicBezierCoordinate(parameter, 0, 1);
}

function cubicBezierCoordinate(
  value: number,
  control1: number,
  control2: number,
): number {
  const inverse = 1 - value;
  return (
    3 * inverse * inverse * value * control1 +
    3 * inverse * value * value * control2 +
    value * value * value
  );
}

function cubicBezierDerivative(
  value: number,
  control1: number,
  control2: number,
): number {
  const inverse = 1 - value;
  return (
    3 * inverse * inverse * control1 +
    6 * inverse * value * (control2 - control1) +
    3 * value * value * (1 - control2)
  );
}
