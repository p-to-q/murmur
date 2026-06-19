import type { SongCard } from "@/modules/shared/types";

type Song = SongCard & {
  mp3DataUrl?: string | null;
  bpm?: number;
  keySignature?: string;
};

type RGB = { r: number; g: number; b: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
};

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

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

export async function exportSongAsVideo(song: Song): Promise<void> {
  // Export design intent:
  // reuse the song's existing audio plus its current visual preset instead of
  // inventing a separate "video mode". That keeps preview/export coherent and
  // makes video feel like a true product output, not an afterthought.
  // Container preference: MP4 when the browser can mux it, WebM otherwise —
  // see pickSupportedMimeType.
  if (!song.mp3DataUrl) {
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

  const audio = new Audio(song.mp3DataUrl);
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.muted = false;

  await waitForMedia(audio);

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
  source.connect(audioContext.destination);

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

  const colors = extractGradientColors(song.visualConfig.gradient);
  const preset = song.visualConfig.preset;
  const particles: Particle[] = [];
  let rafId = 0;
  let frame = 0;

  const spawnParticle = () => {
    const dense = Math.max(0.2, song.visualConfig.particleDensity || 0.35);
    return {
      x: Math.random() * WIDTH,
      y: HEIGHT + 40,
      vx: (Math.random() - 0.5) * (1.1 + dense * 1.4),
      vy: -(Math.random() * (2.1 + dense) + 0.8),
      radius: Math.random() * (7 + dense * 6) + 2,
      life: 0,
      maxLife: Math.random() * 120 + 100,
    };
  };

  const draw = () => {
    paintPresetFrame(ctx, {
      preset,
      colors,
      frame,
      progress:
        audio.duration && Number.isFinite(audio.duration)
          ? audio.currentTime / Math.max(audio.duration, 0.001)
          : 0,
      particles,
      spawnParticle,
      title: song.title,
      vibe: song.vibe,
      bpm: song.bpm ?? 80,
      durationSec: song.duration,
      keySig: song.keySignature ?? "C",
    });
    frame += 1;
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

  recorder.start();
  draw();

  try {
    await audio.play();
  } catch (error) {
    recorder.stop();
    throw error instanceof Error ? error : new Error(String(error));
  }

  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
  });

  recorder.stop();
  const blob = await stopped;

  source.disconnect();
  destination.disconnect();
  audio.pause();
  audio.src = "";
  mixedStream.getTracks().forEach((track) => track.stop());
  await audioContext.close().catch(() => {});

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(song.title)}.${extensionForMimeType(supportedMimeType)}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pickSupportedMimeType(): string | null {
  // MP4 (H.264 + AAC) first — it's what chat apps, Photos, and WeChat accept
  // without re-encoding. Safari has recorded MP4 for years and Chromium ships
  // it too; WebM stays as the fallback for browsers that can't mux MP4.
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

function waitForMedia(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
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

function extractGradientColors(gradient: string): [RGB, RGB] {
  const matches = gradient.match(/#[0-9A-Fa-f]{6}/g) ?? ["#F4C87A", "#E9A06D"];
  const parse = (hex: string): RGB => ({
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  });
  return [parse(matches[0] ?? "#F4C87A"), parse(matches[matches.length - 1] ?? "#E9A06D")];
}

function slugify(value: string): string {
  return value.replace(/\s+/g, "-").toLowerCase() || "murmur";
}

function lerp(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio;
}

function rgbString(rgb: RGB): string {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

function mixColors(a: RGB, b: RGB, ratio: number): RGB {
  return {
    r: lerp(a.r, b.r, ratio),
    g: lerp(a.g, b.g, ratio),
    b: lerp(a.b, b.b, ratio),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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

function drawMeta(
  ctx: CanvasRenderingContext2D,
  title: string,
  vibe: string,
  bpm: number,
  progress: number,
  durationSec: number,
  keySig: string,
) {
  ctx.save();

  // ── "FOR YOU" pill at top center ──
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.letterSpacing = "3px";
  const pillText = "FOR YOU";
  const pillW = ctx.measureText(pillText).width + 48;
  const pillX = (WIDTH - pillW) / 2;
  ctx.fillStyle = "rgba(26,26,26,0.58)";
  roundRect(ctx, pillX, 56, pillW, 44, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.90)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, WIDTH / 2, 78);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = "0px";

  // ── Close (X) circle at top right ──
  ctx.beginPath();
  ctx.arc(WIDTH - 72, 78, 26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(WIDTH - 82, 68);
  ctx.lineTo(WIDTH - 62, 88);
  ctx.moveTo(WIDTH - 62, 68);
  ctx.lineTo(WIDTH - 82, 88);
  ctx.stroke();

  // ── Right-side action icons ──
  const iconBaseY = HEIGHT - 520;
  const iconSpacing = 78;
  const iconCx = WIDTH - 72;
  for (let i = 0; i < 5; i++) {
    const iy = iconBaseY + i * iconSpacing;
    if (i < 4) {
      ctx.beginPath();
      ctx.arc(iconCx, iy, 32, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    if (i === 4) {
      for (let d = -10; d <= 10; d += 10) {
        ctx.beginPath();
        ctx.arc(iconCx + d, iy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(iconCx, iy, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Title text (large, wrapped) ──
  ctx.font = "600 96px Georgia, serif";
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 16;
  const maxTitleW = WIDTH - 220;
  const lines = wrapText(ctx, title, maxTitleW);
  const lineH = 96;
  const titleBaseY = HEIGHT - 380 - Math.max(0, lines.length - 2) * lineH;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, 60, titleBaseY + i * lineH);
  }
  ctx.shadowBlur = 0;

  // ── User avatar + name ──
  const userY = titleBaseY + lines.length * lineH + 32;
  const avatarGrad = ctx.createLinearGradient(60, userY - 20, 100, userY + 20);
  avatarGrad.addColorStop(0, "hsl(210, 45%, 72%)");
  avatarGrad.addColorStop(1, "hsl(250, 55%, 78%)");
  ctx.beginPath();
  ctx.arc(80, userY, 20, 0, Math.PI * 2);
  ctx.fillStyle = avatarGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.90)";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("C", 80, userY + 6);
  ctx.textAlign = "start";
  ctx.fillStyle = "rgba(255,255,255,0.80)";
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.fillText("Creator", 114, userY + 8);
  ctx.shadowBlur = 0;

  // ── BPM + Key badges ──
  const badgeY = userY + 50;
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.letterSpacing = "2px";
  const bpmLabel = `${bpm} BPM`;
  const bpmW = ctx.measureText(bpmLabel).width + 28;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, 60, badgeY - 15, bpmW, 30, 15);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.fillText(bpmLabel, 74, badgeY + 6);
  const keyW = ctx.measureText(keySig).width + 28;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, 60 + bpmW + 12, badgeY - 15, keyW, 30, 15);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.fillText(keySig, 74 + bpmW + 12, badgeY + 6);
  ctx.letterSpacing = "0px";

  // ── Playback bar ──
  const barY = HEIGHT - 72;
  // Skip back
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.beginPath();
  ctx.moveTo(72, barY - 8);
  ctx.lineTo(56, barY);
  ctx.lineTo(72, barY + 8);
  ctx.fill();
  ctx.fillRect(53, barY - 8, 4, 16);
  // Pause
  ctx.fillStyle = "rgba(255,255,255,0.80)";
  ctx.fillRect(104, barY - 10, 7, 20);
  ctx.fillRect(118, barY - 10, 7, 20);
  // Track
  const trackX = 154;
  const trackW = WIDTH - 310;
  const progW = trackW * progress;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  roundRect(ctx, trackX, barY - 2, trackW, 4, 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, trackX, barY - 2, Math.max(progW, 1), 4, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(trackX + progW, barY, 7, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.shadowColor = "rgba(255,255,255,0.4)";
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Duration
  const totalSec = Math.round(durationSec);
  const durLabel = `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.font = "500 24px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(durLabel, WIDTH - 60, barY + 7);
  ctx.textAlign = "start";

  ctx.restore();
}

function paintPresetFrame(
  ctx: CanvasRenderingContext2D,
  input: {
    preset: string;
    colors: [RGB, RGB];
    frame: number;
    progress: number;
    particles: Particle[];
    spawnParticle: () => Particle;
    title: string;
    vibe: string;
    bpm: number;
    durationSec: number;
    keySig: string;
  },
) {
  const {
    preset, colors, frame, progress, particles, spawnParticle,
    title, vibe, bpm, durationSec, keySig,
  } = input;
  const [from, to] = colors;
  const drift = (Math.sin(frame * 0.02) + 1) / 2;
  const top = mixColors(from, to, drift * 0.35);
  const bottom = mixColors(to, from, drift * 0.18);

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, rgbString(top));
  background.addColorStop(1, rgbString(bottom));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let y = 0; y < HEIGHT; y += 6) {
    ctx.fillRect(0, y, WIDTH, 1);
  }

  switch (preset) {
    case "dust_room":
      drawDustRoom(ctx, particles, spawnParticle, frame);
      break;
    case "end_credits":
      drawEndCredits(ctx, particles, spawnParticle, frame, progress);
      break;
    case "confetti_pulse":
      drawConfetti(ctx, particles, spawnParticle, frame, progress);
      break;
    case "rain_glass":
      drawRainGlass(ctx, particles, spawnParticle, frame);
      break;
    case "synth_glow":
      drawSynthGlow(ctx, particles, spawnParticle, frame, progress);
      break;
    case "warm_particles":
    default:
      drawWarmParticles(ctx, particles, spawnParticle, frame);
      break;
  }

  // Top vignette
  const topGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT * 0.2);
  topGrad.addColorStop(0, "rgba(0,0,0,0.22)");
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT * 0.2);

  // Overall dim
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Bottom vignette for text readability
  const bottomGrad = ctx.createLinearGradient(0, HEIGHT * 0.38, 0, HEIGHT);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  bottomGrad.addColorStop(0.45, "rgba(0,0,0,0.16)");
  bottomGrad.addColorStop(1, "rgba(0,0,0,0.52)");
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, HEIGHT * 0.38, WIDTH, HEIGHT * 0.62);

  drawMeta(ctx, title, vibe, bpm, progress, durationSec, keySig);
}

function stepParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
  config: {
    cap: number;
    interval: number;
    color: string;
    alphaScale?: number;
    stretch?: boolean;
  },
) {
  if (particles.length < config.cap && frame % config.interval === 0) {
    particles.push(spawnParticle());
  }

  for (let index = particles.length - 1; index >= 0; index--) {
    const particle = particles[index]!;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy -= 0.01;
    particle.life += 1;
    if (particle.life >= particle.maxLife) {
      particles.splice(index, 1);
      continue;
    }

    const alpha =
      (1 - particle.life / particle.maxLife) * (config.alphaScale ?? 0.55);
    ctx.beginPath();
    if (config.stretch) {
      ctx.ellipse(
        particle.x,
        particle.y,
        particle.radius * 0.65,
        particle.radius * 2.2,
        Math.atan2(particle.vy, particle.vx),
        0,
        Math.PI * 2,
      );
    } else {
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = config.color.replace("__A__", alpha.toFixed(3));
    ctx.fill();
  }
}

function drawWarmParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 55,
    interval: 3,
    color: "rgba(255,255,255,__A__)",
  });
}

function drawDustRoom(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 70,
    interval: 5,
    color: "rgba(255,248,235,__A__)",
    alphaScale: 0.32,
  });

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let index = 0; index < 8; index++) {
    const x = ((frame * 0.3 + index * 130) % (WIDTH + 240)) - 120;
    ctx.fillRect(x, 0, 1.5, HEIGHT);
  }
}

function drawEndCredits(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
  progress: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 32,
    interval: 6,
    color: "rgba(255,255,255,__A__)",
    alphaScale: 0.22,
  });

  const glow = 120 + Math.sin(frame * 0.035) * 40;
  ctx.beginPath();
  ctx.arc(WIDTH * 0.72, HEIGHT * 0.28, glow, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fill();

  const horizonY = HEIGHT * (0.68 - progress * 0.06);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.bezierCurveTo(WIDTH * 0.25, horizonY - 40, WIDTH * 0.75, horizonY + 25, WIDTH, horizonY - 30);
  ctx.stroke();
}

function drawConfetti(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
  progress: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 95,
    interval: 2,
    color: "rgba(255,255,255,__A__)",
    alphaScale: 0.65,
  });

  const pulse = 0.7 + Math.sin(frame * 0.12) * 0.25 + progress * 0.15;
  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT / 2, 180 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawRainGlass(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 80,
    interval: 3,
    color: "rgba(255,255,255,__A__)",
    alphaScale: 0.22,
    stretch: true,
  });

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  for (let index = 0; index < 12; index++) {
    const x = ((frame * 1.6 + index * 92) % (WIDTH + 160)) - 80;
    ctx.beginPath();
    ctx.moveTo(x, -40);
    ctx.lineTo(x - 40, HEIGHT + 40);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawSynthGlow(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  spawnParticle: () => Particle,
  frame: number,
  progress: number,
) {
  stepParticles(ctx, particles, spawnParticle, frame, {
    cap: 58,
    interval: 3,
    color: "rgba(255,255,255,__A__)",
    alphaScale: 0.42,
  });

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  const ringRadius = 180 + Math.sin(frame * 0.07) * 36 + progress * 50;
  ctx.beginPath();
  ctx.arc(WIDTH * 0.5, HEIGHT * 0.42, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 3;
  ctx.stroke();
}
