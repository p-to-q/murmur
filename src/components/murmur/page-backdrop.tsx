"use client";

/**
 * PageBackdrop — the unified visual anchor for every screen.
 *
 * Renders the cream surface with four warm corner blobs (coral BL, gold TR,
 * dust-blue TL/top, lavender BR) drawn from the brand palette so every page
 * reads as warm light on paper. Drifts slowly via CSS keyframes. Pure presentation,
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
      {/* Coral — bottom-left */}
      <div
        className="aurora-blob-1 absolute rounded-full"
        style={{
          width: "min(60vw, 560px)",
          height: "min(52vw, 480px)",
          left: "-6%",
          bottom: "8%",
          background:
            "radial-gradient(ellipse at center, rgba(255,138,92,0.30) 0%, rgba(255,89,36,0.09) 50%, transparent 75%)",
          filter: "blur(60px)",
        }}
      />
      {/* Warm gold — top-right */}
      <div
        className="aurora-blob-2 absolute rounded-full"
        style={{
          width: "min(52vw, 500px)",
          height: "min(48vw, 440px)",
          right: "-8%",
          top: "6%",
          background:
            "radial-gradient(ellipse at center, rgba(235,203,139,0.36) 0%, rgba(235,203,139,0.10) 50%, transparent 75%)",
          filter: "blur(55px)",
        }}
      />
      {/* Dust blue — top center / top-left */}
      <div
        className="aurora-blob-3 absolute rounded-full"
        style={{
          width: "min(46vw, 420px)",
          height: "min(40vw, 380px)",
          left: "18%",
          top: "-6%",
          background:
            "radial-gradient(ellipse at center, rgba(167,184,200,0.24) 0%, rgba(201,182,228,0.08) 50%, transparent 75%)",
          filter: "blur(50px)",
        }}
      />
      {/* Lavender — bottom-right */}
      <div
        className="aurora-blob-1 absolute rounded-full"
        style={{
          width: "min(32vw, 320px)",
          height: "min(28vw, 280px)",
          right: "10%",
          bottom: "12%",
          background:
            "radial-gradient(ellipse at center, rgba(201,182,228,0.18) 0%, transparent 60%)",
          filter: "blur(45px)",
          animationDelay: "-8s",
        }}
      />
    </div>
  );
}
