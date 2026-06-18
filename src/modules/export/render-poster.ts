"use client";
/**
 * render-poster — capture a sticker-style poster image of the song.
 *
 * Approach: build a hidden DOM node sized exactly 1080×1080, paint the gradient
 * + title + meta + paper grain into it, then snapshot via html2canvas. The
 * result is a high-resolution PNG suitable for share screenshots or print.
 *
 * Why a custom hidden node instead of cloning the in-app card? Two reasons:
 *   1. The in-app card is layout-driven (responsive units, CSS variables) and
 *      that doesn't snapshot well at a fixed target size.
 *   2. The poster has its own visual rhythm — typography, a watermark — that
 *      we don't want to bake into the live UI.
 */

export interface PosterInput {
  title: string;
  vibe: string;
  bpm: number;
  keySig: string;
  gradient: string;
  durationSec: number;
}

const SIZE = 1080;

export async function renderPoster(input: PosterInput): Promise<Blob | null> {
  try {
    const mod = (await import("html2canvas")) as unknown as {
      default: (
        el: HTMLElement,
        opts?: {
          backgroundColor?: string | null;
          scale?: number;
          useCORS?: boolean;
          logging?: boolean;
        }
      ) => Promise<HTMLCanvasElement>;
    };
    const html2canvas = mod.default;

    const node = buildPosterNode(input);
    document.body.appendChild(node);

    const canvas = await html2canvas(node, {
      backgroundColor: null,
      scale: 1,
      useCORS: true,
      logging: false,
    });

    document.body.removeChild(node);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png", 0.95)
    );
  } catch (e) {
    console.warn("[render-poster] failed:", e);
    return null;
  }
}

function buildPosterNode(input: PosterInput): HTMLDivElement {
  const { title, vibe, bpm, keySig, gradient, durationSec } = input;

  const notchY = 720; // Position from top where the dashed line will be
  const notchRadius = 24; // Radius of the semicircle notch
  const cornerRadius = 60;

  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    fontFamily: '-apple-system, "PingFang SC", system-ui, sans-serif',
    color: "white",
    background: gradient,
    overflow: "hidden",
  } as CSSStyleDeclaration);

  // Add stamp-style notches using clip-path
  // Path: start at top-left corner, go around with rounded corners and notches on left and right sides
  root.style.clipPath = `path('M ${cornerRadius} 0 L ${SIZE - cornerRadius} 0 Q ${SIZE} 0 ${SIZE} ${cornerRadius} L ${SIZE} ${notchY - notchRadius} A ${notchRadius} ${notchRadius} 0 0 0 ${SIZE} ${notchY + notchRadius} L ${SIZE} ${SIZE - cornerRadius} Q ${SIZE} ${SIZE} ${SIZE - cornerRadius} ${SIZE} L ${cornerRadius} ${SIZE} Q 0 ${SIZE} 0 ${SIZE - cornerRadius} L 0 ${notchY + notchRadius} A ${notchRadius} ${notchRadius} 0 0 0 0 ${notchY - notchRadius} L 0 ${cornerRadius} Q 0 0 ${cornerRadius} 0 Z')`;
  root.style.boxShadow = "0 0 0 28px rgba(255,255,255,0.95)";

  // Paper grain overlay
  const grain = document.createElement("div");
  Object.assign(grain.style, {
    position: "absolute",
    inset: "0",
    opacity: "0.08",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
    backgroundSize: "320px",
  } as CSSStyleDeclaration);
  root.appendChild(grain);

  // Dark gradient overlay
  const dark = document.createElement("div");
  Object.assign(dark.style, {
    position: "absolute", inset: "0",
    background: "linear-gradient(to top, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 50%)",
  } as CSSStyleDeclaration);
  root.appendChild(dark);

  // MURMUR mark — top-left
  const mark = document.createElement("div");
  mark.textContent = "MURMUR";
  Object.assign(mark.style, {
    position: "absolute",
    top: "70px", left: "78px",
    color: "rgba(255,255,255,0.85)",
    fontFamily: '"Lora", Georgia, serif',
    fontWeight: "600",
    fontSize: "32px",
    letterSpacing: "0.18em",
  } as CSSStyleDeclaration);
  root.appendChild(mark);

  // BPM + key — top-right
  const meta = document.createElement("div");
  meta.textContent = `${bpm} BPM · ${keySig}`;
  Object.assign(meta.style, {
    position: "absolute",
    top: "76px", right: "78px",
    color: "rgba(255,255,255,0.85)",
    fontSize: "26px", fontWeight: "500",
    letterSpacing: "0.1em",
  } as CSSStyleDeclaration);
  root.appendChild(meta);

  // Dashed line at notch position
  const dashedLine = document.createElement("div");
  Object.assign(dashedLine.style, {
    position: "absolute",
    left: "0", right: "0",
    top: `${notchY}px`,
    height: "0",
    borderTop: "2px dashed rgba(255,255,255,0.35)",
  } as CSSStyleDeclaration);
  root.appendChild(dashedLine);

  // Title block — bottom-left
  const block = document.createElement("div");
  Object.assign(block.style, {
    position: "absolute",
    left: "78px", bottom: "78px", right: "78px",
    display: "flex", flexDirection: "column", gap: "18px",
  } as CSSStyleDeclaration);

  const vibeRow = document.createElement("div");
  vibeRow.textContent = vibe.toUpperCase();
  Object.assign(vibeRow.style, {
    fontSize: "26px", fontWeight: "500", letterSpacing: "0.32em",
    color: "rgba(255,255,255,0.75)",
  } as CSSStyleDeclaration);
  block.appendChild(vibeRow);

  const titleRow = document.createElement("div");
  titleRow.textContent = title;
  Object.assign(titleRow.style, {
    fontFamily: '"Lora", Georgia, serif',
    fontSize: "118px", fontWeight: "600", lineHeight: "1.05",
    color: "white",
  } as CSSStyleDeclaration);
  block.appendChild(titleRow);

  const tag = document.createElement("div");
  tag.textContent = `${Math.round(durationSec)}s · from MURMUR`;
  Object.assign(tag.style, {
    marginTop: "8px",
    fontSize: "24px", fontWeight: "500",
    color: "rgba(255,255,255,0.7)",
  } as CSSStyleDeclaration);
  block.appendChild(tag);

  root.appendChild(block);
  return root;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
