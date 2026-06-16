"use client";

import { useEffect, useRef } from "react";
import { VIBE_PRESETS } from "@/presets/vibes";

interface CanvasCoverArtProps {
  songId: string;
  gradient?: string;
  vibe?: string;
  className?: string;
}

function resolveGradient(gradient?: string, vibe?: string): string {
  if (gradient && /#[0-9A-Fa-f]{6}/.test(gradient)) return gradient;
  const preset = VIBE_PRESETS.find((v) => v.id === vibe) ?? VIBE_PRESETS[0];
  return preset.gradient;
}

function parseHex(h: string) {
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

export function CanvasCoverArt({ gradient, vibe, className }: CanvasCoverArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 400;
    canvas.width = size;
    canvas.height = size;

    const resolved = resolveGradient(gradient, vibe);
    const hexes = resolved.match(/#[0-9A-Fa-f]{6}/g) ?? ["#F4C87A", "#E9A06D"];
    const rgb1 = parseHex(hexes[0]!);
    const rgb2 = parseHex(hexes[hexes.length - 1]!);

    interface P { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }
    let particles: P[] = [];
    let frame = 0;

    function spawn(): P {
      return {
        x: Math.random() * size,
        y: size + 3,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(Math.random() * 1.0 + 0.3),
        r: Math.random() * 3 + 1,
        life: 0,
        max: Math.random() * 90 + 60,
      };
    }

    function draw() {
      if (!ctx || !canvas) return;

      const t = (frame % 240) / 240;
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * Math.sin(t * Math.PI));
      const gr = ctx.createLinearGradient(0, 0, size, size);
      gr.addColorStop(0, `rgb(${lerp(rgb1.r, rgb2.r)},${lerp(rgb1.g, rgb2.g)},${lerp(rgb1.b, rgb2.b)})`);
      gr.addColorStop(1, `rgb(${rgb2.r},${rgb2.g},${rgb2.b})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, size, size);

      if (particles.length < 8 && frame % 18 === 0) particles.push(spawn());
      particles = particles.filter((p) => p.life < p.max);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.008;
        p.life++;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(1 - p.life / p.max) * 0.45})`;
        ctx.fill();
      }

      frame++;
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [gradient, vibe]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
