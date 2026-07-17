import type { SongCard } from "@/modules/shared/types";
import {
  COVER_ARTWORK_BRIGHTNESS_FILTER,
  applyCoverBrightnessCompensation,
} from "@/lib/music/cover-visual-treatment";
import { downloadBlob } from "@/lib/platform/download";

type Song = SongCard & {
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
  bpm?: number;
  keySignature?: string;
};

type RGB = { r: number; g: number; b: number };

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const SCALE = WIDTH / 420;
const PAD = Math.round(28 * SCALE);
export const VIDEO_EXPORT_AUDIO_LOAD_TIMEOUT_MS = 20_000;
const VIDEO_EXPORT_PLAYBACK_GRACE_MS = 15_000;

export type VideoExportSupport = {
  supported: boolean;
  reason?: "missing_media_recorder" | "missing_audio_context" | "missing_capture_stream";
};

export class VideoExportError extends Error {
  code:
    | "audio_required"
    | "browser_unsupported"
    | "canvas_unavailable"
    | "audio_context_unavailable"
    | "audio_load_failed"
    | "recorder_failed";

  constructor(
    code: VideoExportError["code"],
    message: string,
  ) {
    super(message);
    this.name = "VideoExportError";
    this.code = code;
  }
}

export function getVideoExportSupport(): VideoExportSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "missing_media_recorder" };
  }
  if (typeof MediaRecorder === "undefined") {
    return { supported: false, reason: "missing_media_recorder" };
  }
  if (typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    return { supported: false, reason: "missing_capture_stream" };
  }
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) {
    return { supported: false, reason: "missing_audio_context" };
  }
  if (!pickSupportedMimeType()) {
    return { supported: false, reason: "missing_media_recorder" };
  }
  return { supported: true };
}

export interface RenderVideoOptions {
  onProgress?: (pct: number) => void;
  silent?: boolean;
}

export async function renderSongVideo(
  song: Song,
  opts?: RenderVideoOptions,
): Promise<Blob> {
  const audioSrc = song.mp3DataUrl || song.mp3Url;
  if (!audioSrc) {
    throw new VideoExportError("audio_required", "Audio is required for video export");
  }

  const support = getVideoExportSupport();
  const supportedMimeType = support.supported ? pickSupportedMimeType() : null;
  if (!support.supported || !supportedMimeType) {
    throw new VideoExportError(
      "browser_unsupported",
      "This browser does not support video export",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new VideoExportError("canvas_unavailable", "Canvas context unavailable");
  }

  const audio = new Audio(audioSrc);
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.muted = false;

  await waitForMedia(audio);

  const artworkImg = await loadArtwork(song.visualConfig.artwork);

  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) {
    throw new VideoExportError(
      "audio_context_unavailable",
      "AudioContext unavailable",
    );
  }

  const audioContext = new AudioCtx();
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {});
  }

  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createMediaElementSource(audio);
  source.connect(destination);
  if (!opts?.silent) {
    source.connect(audioContext.destination);
  }

  const canvasStream = canvas.captureStream(FPS);
  const mixedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(mixedStream, { mimeType: supportedMimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const gradient = song.visualConfig.gradient;
  const palette = song.visualConfig.artwork?.palette;
  const year = new Date(song.createdAt).getFullYear();
  let rafId = 0;

  const draw = () => {
    const dur = audio.duration && Number.isFinite(audio.duration) ? audio.duration : 1;
    const progress = audio.currentTime / Math.max(dur, 0.001);
    paintTicketFrame(ctx, {
      gradient,
      palette,
      artworkImg,
      title: song.title,
      year,
      bpm: song.bpm ?? 80,
      keySig: song.keySignature ?? "C",
      durationSec: song.duration,
      progress,
    });
    opts?.onProgress?.(Math.min(progress, 1));
    rafId = requestAnimationFrame(draw);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () =>
      reject(new VideoExportError("recorder_failed", "MediaRecorder failed"));
    recorder.onstop = () => {
      cancelAnimationFrame(rafId);
      const blob = new Blob(chunks, { type: supportedMimeType });
      resolve(blob);
    };
  });

  let recorderStarted = false;

  try {
    recorder.start();
    recorderStarted = true;
    draw();

    await audio.play();
    await Promise.race([
      waitForPlaybackEnd(audio),
      stopped.then(() => {
        throw new VideoExportError(
          "recorder_failed",
          "MediaRecorder stopped before playback finished",
        );
      }),
    ]);

    recorder.stop();
    const blob = await stopped;

    opts?.onProgress?.(1);
    return blob;
  } catch (error) {
    if (recorderStarted && recorder.state !== "inactive") {
      recorder.stop();
    }
    throw normalizeVideoExportError(error);
  } finally {
    cancelAnimationFrame(rafId);
    source.disconnect();
    destination.disconnect();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    mixedStream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
  }
}

export function getVideoMimeType(): string | null {
  return pickSupportedMimeType();
}

export function getVideoExtension(): "mp4" | "webm" {
  const mime = pickSupportedMimeType();
  return mime ? extensionForMimeType(mime) : "mp4";
}

export async function exportSongAsVideo(song: Song): Promise<void> {
  const blob = await renderSongVideo(song, { silent: true });
  const mimeType = pickSupportedMimeType() ?? "video/mp4";

  downloadBlob(blob, `${slugify(song.title)}.${extensionForMimeType(mimeType)}`);
}

// ─── Infrastructure helpers ───────────────────────────────

function pickSupportedMimeType(): string | null {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
  );
}

function extensionForMimeType(mimeType: string): "mp4" | "webm" {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

export function waitForMedia(
  audio: HTMLAudioElement,
  timeoutMs = VIDEO_EXPORT_AUDIO_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new VideoExportError("audio_load_failed", "Audio timed out while loading"));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadeddata", onLoaded);
      audio.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new VideoExportError("audio_load_failed", "Audio failed to load"));
    };
    audio.addEventListener("loadeddata", onLoaded, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

export function waitForPlaybackEnd(audio: HTMLAudioElement): Promise<void> {
  const durationMs =
    audio.duration && Number.isFinite(audio.duration)
      ? Math.ceil(audio.duration * 1000) + VIDEO_EXPORT_PLAYBACK_GRACE_MS
      : VIDEO_EXPORT_AUDIO_LOAD_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new VideoExportError("audio_load_failed", "Audio timed out during playback"));
    }, Math.max(durationMs, VIDEO_EXPORT_AUDIO_LOAD_TIMEOUT_MS));

    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new VideoExportError("audio_load_failed", "Audio failed during playback"));
    };

    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

function normalizeVideoExportError(error: unknown): Error {
  if (error instanceof VideoExportError) return error;
  if (error instanceof Error) {
    return new VideoExportError("audio_load_failed", error.message || "Audio failed");
  }
  return new VideoExportError("audio_load_failed", String(error));
}

function loadArtwork(
  artwork?: { backgroundImagePath?: string; imagePath: string },
): Promise<HTMLImageElement | null> {
  if (!artwork) return Promise.resolve(null);
  const src = artwork.backgroundImagePath ?? artwork.imagePath;
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function slugify(value: string): string {
  return value.replace(/\s+/g, "-").toLowerCase() || "murmur";
}

// ─── Drawing primitives ───────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHex(hex: string): RGB {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function darkenRgb(c: RGB, amount: number): RGB {
  const f = 1 - amount;
  return {
    r: Math.round(c.r * f),
    g: Math.round(c.g * f),
    b: Math.round(c.b * f),
  };
}

function rgbStr(c: RGB): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

function rgbaStr(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = words[0] ?? "";
  for (let i = 1; i < words.length; i++) {
    const test = current + " " + words[i];
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = words[i]!;
    } else {
      current = test;
    }
  }
  lines.push(current);
  return lines;
}

// ─── Mesh gradient (replicates buildMeshGradient on canvas) ─

function drawMeshGradient(
  ctx: CanvasRenderingContext2D,
  gradient: string,
  palette?: string[],
) {
  const hexes =
    palette && palette.length >= 2
      ? palette
      : gradient.match(/#[0-9A-Fa-f]{6}/g) ?? ["#4A9B8E", "#2D6B5F"];

  const c1 = parseHex(hexes[0] ?? "#4A9B8E");
  const c2 = parseHex(hexes[1] ?? hexes[0] ?? "#2D6B5F");
  const c3 = hexes[2] ? parseHex(hexes[2]) : darkenRgb(c1, 0.3);
  const c4 = hexes[3] ? parseHex(hexes[3]) : darkenRgb(c2, 0.2);

  const d1 = darkenRgb(c1, 0.2);
  const d2 = darkenRgb(c2, 0.35);
  const base = ctx.createLinearGradient(0, 0, WIDTH * 0.94, HEIGHT);
  base.addColorStop(0, rgbStr(d1));
  base.addColorStop(1, rgbStr(d2));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawRadialLayer(ctx, 0.15, 0.75, 1.3, 0.9, c1, 0.8, 0.55);
  drawRadialLayer(ctx, 0.85, 0.15, 1.1, 1.1, c2, 0.53, 0.5);
  drawRadialLayer(ctx, 0.45, 0.5, 0.9, 1.3, c3, 0.33, 0.55);
  drawRadialLayer(ctx, 0.75, 0.85, 1.5, 0.7, c4, 0.27, 0.45);
}

function drawRadialLayer(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGB,
  alpha: number,
  fade: number,
) {
  ctx.save();
  const centerX = cx * WIDTH;
  const centerY = cy * HEIGHT;
  const radX = (rx * WIDTH) / 2;
  const radY = (ry * HEIGHT) / 2;
  const maxR = Math.max(radX, radY);

  ctx.translate(centerX, centerY);
  ctx.scale(radX / maxR, radY / maxR);

  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, maxR);
  grad.addColorStop(0, rgbaStr(color, alpha));
  grad.addColorStop(fade, rgbaStr(color, 0));
  grad.addColorStop(1, rgbaStr(color, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(-maxR, -maxR, maxR * 2, maxR * 2);
  ctx.restore();
}

// ─── Artwork cover-fit ────────────────────────────────────

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = WIDTH / HEIGHT;
  let sx: number, sy: number, sw: number, sh: number;
  if (imgRatio > boxRatio) {
    sh = img.naturalHeight;
    sw = sh * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT);
}

// ─── Ticket-card frame ───────────────────────────────────

function paintTicketFrame(
  ctx: CanvasRenderingContext2D,
  input: {
    gradient: string;
    palette?: string[];
    artworkImg: HTMLImageElement | null;
    title: string;
    year: number;
    bpm: number;
    keySig: string;
    durationSec: number;
    progress: number;
  },
) {
  const {
    gradient, palette, artworkImg,
    title, year, bpm, keySig, durationSec, progress,
  } = input;

  drawMeshGradient(ctx, gradient, palette);

  if (artworkImg) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.filter = COVER_ARTWORK_BRIGHTNESS_FILTER;
    drawImageCover(ctx, artworkImg);
    ctx.restore();
    applyCoverBrightnessCompensation(ctx, WIDTH, HEIGHT);
  }

  const topGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT * 0.25);
  topGrad.addColorStop(0, "rgba(0,0,0,0.18)");
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT * 0.25);

  const botGrad = ctx.createLinearGradient(0, HEIGHT * 0.4, 0, HEIGHT);
  botGrad.addColorStop(0, "rgba(0,0,0,0)");
  botGrad.addColorStop(0.5, "rgba(0,0,0,0.20)");
  botGrad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, HEIGHT * 0.4, WIDTH, HEIGHT * 0.6);

  drawTicketElements(ctx, title, year, bpm, keySig, durationSec, progress);
}

function drawTicketElements(
  ctx: CanvasRenderingContext2D,
  title: string,
  year: number,
  bpm: number,
  keySig: string,
  durationSec: number,
  progress: number,
) {
  ctx.save();

  const S = SCALE;
  const btm = HEIGHT - PAD;

  // ── Mini player ──
  const iconSize = Math.round(20 * S);
  const playerCenterY = btm - iconSize / 2;

  // Play triangle (filled, no circle — matches the ticket card)
  ctx.fillStyle = "white";
  ctx.beginPath();
  const triH = iconSize * 0.78;
  const triW = triH * 0.72;
  const triCx = PAD + iconSize / 2;
  ctx.moveTo(triCx - triW * 0.38, playerCenterY - triH / 2);
  ctx.lineTo(triCx + triW * 0.62, playerCenterY);
  ctx.lineTo(triCx - triW * 0.38, playerCenterY + triH / 2);
  ctx.closePath();
  ctx.fill();

  // Progress bar
  const barGap = Math.round(12 * S);
  const barX = PAD + iconSize + barGap;
  const durFontSize = Math.round(11 * S);
  ctx.font = `400 ${durFontSize}px Georgia, serif`;
  const totalSec = Math.round(durationSec);
  const durLabel = `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
  const durLabelW = ctx.measureText(durLabel).width;
  const durGap = Math.round(8 * S);
  const barEndX = WIDTH - PAD - durLabelW - durGap;
  const barW = barEndX - barX;
  const barH = Math.round(3 * S);
  const barR = barH / 2;

  ctx.fillStyle = "rgba(255,255,255,0.20)";
  roundRect(ctx, barX, playerCenterY - barH / 2, barW, barH, barR);
  ctx.fill();

  const progW = Math.max(barW * Math.min(progress, 1), 1);
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  roundRect(ctx, barX, playerCenterY - barH / 2, progW, barH, barR);
  ctx.fill();

  // Duration label
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(durLabel, WIDTH - PAD, playerCenterY);

  // ── Fields: TIME / BPM / KEY ──
  const fieldGapAbove = Math.round(20 * S);
  const playerRowTop = btm - iconSize;
  const fieldsBottomY = playerRowTop - fieldGapAbove;

  const labelFontSize = Math.round(11 * S);
  const valueFontSize = Math.round(38 * S);
  const labelValueGap = Math.round(6 * S);

  const fields = [
    { label: "TIME", value: String(year) },
    { label: "BPM", value: String(bpm) },
    { label: "KEY", value: keySig },
  ];

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const fieldAreaW = WIDTH - PAD * 2;
  const fieldSpacing = fieldAreaW / fields.length;

  for (let i = 0; i < fields.length; i++) {
    const fx = PAD + i * fieldSpacing;

    ctx.font = `400 ${valueFontSize}px Georgia, serif`;
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.fillText(fields[i]!.value, fx, fieldsBottomY);

    ctx.font = `400 ${labelFontSize}px Georgia, serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(fields[i]!.label, fx, fieldsBottomY - valueFontSize - labelValueGap);
  }

  // ── Dashed line ──
  const fieldGroupH = valueFontSize + labelValueGap + labelFontSize;
  const dashGap = Math.round(16 * S);
  const dashY = fieldsBottomY - fieldGroupH - dashGap;

  ctx.setLineDash([Math.round(8 * S), Math.round(6 * S)]);
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = Math.round(1 * S);
  ctx.beginPath();
  ctx.moveTo(0, dashY);
  ctx.lineTo(WIDTH, dashY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Title ──
  const titleGap = Math.round(20 * S);
  const titleBottomY = dashY - titleGap;
  const titleFontSize = Math.round(52 * S);

  ctx.font = `400 ${titleFontSize}px Georgia, serif`;
  ctx.fillStyle = "white";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 12;

  const maxTitleW = WIDTH - PAD * 2;
  const lines = wrapText(ctx, title, maxTitleW);
  const lineH = Math.round(titleFontSize * 0.95);

  for (let i = lines.length - 1; i >= 0; i--) {
    const y = titleBottomY - (lines.length - 1 - i) * lineH;
    ctx.fillText(lines[i]!, PAD, y);
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}
