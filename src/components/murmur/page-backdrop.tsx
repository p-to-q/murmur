"use client";

/**
 * PageBackdrop — the unified visual anchor for every screen.
 *
 * Renders the cream surface with four pastel corner blobs (pink BL, yellow TR,
 * lavender TL/top, mint BR). Drifts slowly via CSS keyframes. Pure presentation,
 * no audio reactivity — HumScreen keeps its own audio-reactive backdrop because
 * it has different requirements (amplitude-driven scale + opacity).
 *
 * Use as the first child inside any screen container:
 *
 *   <div className="relative min-h-svh bg-[var(--color-murmur-bg)]">
 *     <PageBackdrop />
 *     <div className="relative z-10"> … </div>
 *   </div>
 *
 * Variants:
 *   - "default": full four-blob composition
 *   - "soft": lower opacity, used on dense pages like the studio mixer where
 *     too much chroma fights the controls.
 */

interface PageBackdropProps {
  variant?: "default" | "soft";
  className?: string;
}

export function PageBackdrop({ variant = "default", className = "" }: PageBackdropProps) {
  const o = variant === "soft" ? 0.55 : 1;
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
      style={{ opacity: o }}
    >
      {/* Pink — bottom-left */}
      <div
        className="aurora-blob-1 absolute rounded-full"
        style={{
          width: "min(60vw, 560px)",
          height: "min(52vw, 480px)",
          left: "-6%",
          bottom: "8%",
          background:
            "radial-gradient(ellipse at center, rgba(255,105,210,0.32) 0%, rgba(255,80,180,0.10) 50%, transparent 75%)",
          filter: "blur(60px)",
        }}
      />
      {/* Soft peach — top-right (whisper of warmth, never a yellow cast) */}
      <div
        className="aurora-blob-2 absolute rounded-full"
        style={{
          width: "min(50vw, 480px)",
          height: "min(46vw, 420px)",
          right: "-8%",
          top: "6%",
          background:
            "radial-gradient(ellipse at center, rgba(255,196,178,0.20) 0%, rgba(255,178,158,0.06) 50%, transparent 75%)",
          filter: "blur(55px)",
        }}
      />
      {/* Lavender — top center / top-left */}
      <div
        className="aurora-blob-3 absolute rounded-full"
        style={{
          width: "min(46vw, 420px)",
          height: "min(40vw, 380px)",
          left: "18%",
          top: "-6%",
          background:
            "radial-gradient(ellipse at center, rgba(178,196,255,0.26) 0%, rgba(200,180,240,0.10) 50%, transparent 75%)",
          filter: "blur(50px)",
        }}
      />
      {/* Mint — bottom-right */}
      <div
        className="aurora-blob-1 absolute rounded-full"
        style={{
          width: "min(32vw, 320px)",
          height: "min(28vw, 280px)",
          right: "10%",
          bottom: "12%",
          background:
            "radial-gradient(ellipse at center, rgba(140,230,200,0.20) 0%, transparent 60%)",
          filter: "blur(45px)",
          animationDelay: "-8s",
        }}
      />
    </div>
  );
}
