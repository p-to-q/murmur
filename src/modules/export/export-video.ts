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
const HEIGHT = 1080;
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

function drawMeta(
  ctx: CanvasRenderingContext2D,
  title: string,
  vibe: string,
  bpm: number,
) {
  ctx.fillStyle = "rgba(255,255,255,0.76)";
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.fillText(vibe.toUpperCase(), 86, HEIGHT - 180);

  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = "600 88px Georgia, serif";
  ctx.fillText(title, 86, HEIGHT - 86, WIDTH - 172);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "500 24px system-ui, sans-serif";
  ctx.fillText(`${bpm} BPM · MURMUR`, 86, 86);
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
  },
) {
  const { preset, colors, frame, progress, particles, spawnParticle, title, vibe, bpm } =
    input;
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

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, HEIGHT * 0.52, WIDTH, HEIGHT * 0.48);

  drawMeta(ctx, title, vibe, bpm);
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
