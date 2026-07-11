"use client";
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  hue: number;
  life: number;
  maxLife: number;
}

interface ParticleVisualProps {
  colors: string[];
  density?: number;
  pulseIntensity?: number;
  isPlaying?: boolean;
  beatTime?: number;
  width?: number;
  height?: number;
  className?: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1] ?? "0", 16),
        g: parseInt(result[2] ?? "0", 16),
        b: parseInt(result[3] ?? "0", 16),
      }
    : { r: 247, g: 201, b: 139 };
}

export function ParticleVisual({
  colors,
  density = 0.5,
  pulseIntensity = 0.4,
  isPlaying = false,
  beatTime = 0,
  className = "",
}: ParticleVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastBeatRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const color1 = hexToRgb(colors[0] ?? "#F7C98B");
    const color2 = hexToRgb(colors[1] ?? "#E9A06D");
    const maxParticles = Math.floor(60 * density);

    function spawnParticle(): Particle {
      const w = canvas!.offsetWidth;
      const h = canvas!.offsetHeight;
      return {
        x: Math.random() * w,
        y: h + 10,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -(Math.random() * 1.5 + 0.5),
        radius: Math.random() * 4 + 2,
        opacity: Math.random() * 0.6 + 0.2,
        hue: Math.random(),
        life: 0,
        maxLife: Math.random() * 120 + 80,
      };
    }

    function spawnBurst() {
      const w = canvas!.offsetWidth;
      const h = canvas!.offsetHeight;
      for (let i = 0; i < Math.floor(8 * pulseIntensity); i++) {
        particlesRef.current.push({
          x: w / 2 + (Math.random() - 0.5) * w * 0.5,
          y: h / 2 + (Math.random() - 0.5) * h * 0.4,
          vx: (Math.random() - 0.5) * 4,
          vy: -(Math.random() * 3 + 1),
          radius: Math.random() * 6 + 3,
          opacity: Math.random() * 0.8 + 0.3,
          hue: Math.random(),
          life: 0,
          maxLife: Math.random() * 60 + 40,
        });
      }
    }

    let frame = 0;
    function animate() {
      if (!ctx || !canvas) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      // Gradient background
      const grad = ctx.createLinearGradient(0, 0, w, h);
      const t = (frame % 200) / 200;
      const r = Math.round(color1.r + (color2.r - color1.r) * t);
      const g = Math.round(color1.g + (color2.g - color1.g) * t);
      const b = Math.round(color1.b + (color2.b - color1.b) * t);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(1, `rgba(${color2.r},${color2.g},${color2.b},1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Spawn particles
      if (isPlaying && particlesRef.current.length < maxParticles && frame % 3 === 0) {
        particlesRef.current.push(spawnParticle());
      }

      // Beat burst
      if (isPlaying && beatTime !== lastBeatRef.current) {
        lastBeatRef.current = beatTime;
        spawnBurst();
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.02; // drift up
        p.life++;
        const progress = p.life / p.maxLife;
        const alpha = p.opacity * (1 - progress);

        const lerpR = Math.round(color1.r + (color2.r - color1.r) * p.hue);
        const lerpG = Math.round(color1.g + (color2.g - color1.g) * p.hue);
        const lerpB = Math.round(color1.b + (color2.b - color1.b) * p.hue);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (1 - progress * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 2 * (1 - progress * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${lerpR},${lerpG},${lerpB},${alpha * 0.2})`;
        ctx.fill();
      }

      // Gentle floating orbs (ambient)
      if (!isPlaying) {
        const orbCount = 3;
        for (let i = 0; i < orbCount; i++) {
          const orbX = w * (0.2 + i * 0.3) + Math.sin(frame * 0.01 + i * 2) * 20;
          const orbY = h * 0.5 + Math.cos(frame * 0.008 + i * 1.5) * 30;
          const orbRadius = 30 + i * 10;
          const orbGrad = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbRadius);
          orbGrad.addColorStop(0, `rgba(255,255,255,0.12)`);
          orbGrad.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.beginPath();
          ctx.arc(orbX, orbY, orbRadius, 0, Math.PI * 2);
          ctx.fillStyle = orbGrad;
          ctx.fill();
        }
      }

      frame++;
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animate();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      observer.disconnect();
    };
  }, [colors, density, pulseIntensity, isPlaying, beatTime]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full rounded-inherit ${className}`}
      style={{ display: "block" }}
    />
  );
}
