"use client";
import { useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { buildMeshGradient } from "@/components/song-detail/mesh-gradient";
import type { VisualArtwork } from "@/modules/shared/types";

export function SongVisualCanvas({
  gradient,
  artwork,
  isPlaying,
}: {
  gradient: string;
  artwork?: VisualArtwork;
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const artworkPath = artwork?.backgroundImagePath ?? artwork?.imagePath;
  const bgStyle = useMemo(
    () => buildMeshGradient(gradient, artwork?.palette),
    [gradient, artwork?.palette],
  );

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
      ctx.clearRect(0, 0, w, h);

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

  return (
    <div className="relative w-full h-full">
      {/* Mesh gradient background */}
      <div className="absolute inset-0" style={bgStyle} />

      {/* Artwork overlay */}
      {artworkPath && (
        <div className="absolute inset-0 opacity-35">
          <Image
            src={artworkPath}
            alt={artwork?.title ?? ""}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
          />
        </div>
      )}

      {/* Particle canvas (transparent) */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
