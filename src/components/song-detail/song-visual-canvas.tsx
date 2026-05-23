"use client";
import { useEffect, useRef } from "react";

/**
 * SongVisualCanvas — the breathing gradient + particle field shown on every
 * SongDetail page. Same painter as the share-html visual so a downloaded card
 * matches what the user saw in-app.
 */
export function SongVisualCanvas({
  gradient,
  isPlaying,
}: {
  gradient: string;
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };
    resize();

    const colorMatch = gradient.match(/#[0-9A-Fa-f]{6}/g) ?? ["#F4C87A", "#E9A06D"];
    const c1 = colorMatch[0] ?? "#F4C87A";
    const c2 = colorMatch[colorMatch.length - 1] ?? "#E9A06D";
    const parse = (h: string) => ({
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    });
    const rgb1 = parse(c1);
    const rgb2 = parse(c2);

    interface P { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }
    let particles: P[] = [];
    let frame = 0;

    function spawn(): P {
      const w = canvas!.offsetWidth;
      const h = canvas!.offsetHeight;
      return {
        x: Math.random() * w,
        y: h + 5,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -(Math.random() * 1.4 + 0.4),
        r: Math.random() * 4 + 1.5,
        life: 0,
        max: Math.random() * 100 + 80,
      };
    }

    function draw() {
      if (!ctx || !canvas) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const t = (frame % 240) / 240;
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * Math.sin(t * Math.PI));
      const gr = ctx.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, `rgb(${lerp(rgb1.r, rgb2.r)},${lerp(rgb1.g, rgb2.g)},${lerp(rgb1.b, rgb2.b)})`);
      gr.addColorStop(1, `rgb(${rgb2.r},${rgb2.g},${rgb2.b})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);

      const playing = isPlayingRef.current;
      if (playing && particles.length < 50 && frame % 3 === 0) particles.push(spawn());
      else if (!playing && particles.length < 8 && frame % 14 === 0) particles.push(spawn());

      particles = particles.filter((p) => p.life < p.max);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.012;
        p.life++;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(1 - p.life / p.max) * 0.55})`;
        ctx.fill();
      }

      if (playing) {
        const cx = w / 2,
          cy = h / 2;
        const pulse = Math.sin(frame * 0.1) * 0.35 + 0.65;
        ctx.beginPath();
        ctx.arc(cx, cy, 44 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      frame++;
      frameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [gradient]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
