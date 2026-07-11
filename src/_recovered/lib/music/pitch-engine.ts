"use client";
/**
 * pitch-engine.ts v2 — 浏览器端 YIN 音高识别
 *
 * 核心改动（v2）：
 * - 移除 OfflineAudioContext（在 E2B iframe 里经常失败）
 * - 直接用普通 AudioContext.decodeAudioData 解码
 * - 如果解码失败，返回空结果让上层走 fixture，而不是 throw
 * - 放宽 YIN 阈值 0.15 → 0.20，更适合哼唱这种非乐器声源
 * - 最低音符门槛降到 1 个（之前 3 个太严）
 */

// ── YIN 参数 ────────────────────────────────────────────────────────────
const YIN_THRESHOLD = 0.20;   // 哼唱用 0.18–0.22，越大越宽松
const MIN_FREQ = 75;           // Hz，男声低限（比默认更低）
const MAX_FREQ = 1100;         // Hz

const FRAME_SIZE = 2048;       // ~46ms @ 44100Hz
const HOP_SIZE   = 512;        // ~11ms @ 44100Hz
const SILENCE_THRESHOLD = 0.004;
const MIN_NOTE_DURATION = 0.08; // 80ms，过滤噪声短音
const PITCH_CHANGE_TOLERANCE = 1.5; // semitone，允许的音高抖动

// ── 数据结构 ───────────────────────────────────────────────────────────
export interface RawNote {
  pitch:      number;  // MIDI note number
  start:      number;  // seconds
  duration:   number;  // seconds
  velocity:   number;  // 0–1
  confidence: number;  // 0–1
}

interface PitchFrame {
  midi:   number | null;
  time:   number;
  energy: number;
}

export interface PitchEngineResult {
  notes:      RawNote[];
  duration:   number;
  method:     "browser-yin";
  frameCount: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────

function freqToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) ** 2;
  return Math.sqrt(sum / buf.length);
}

// ── YIN 核心算法 ──────────────────────────────────────────────────────

export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const N    = buffer.length;
  const half = Math.floor(N / 2);

  // Difference function
  const diff = new Float32Array(half);
  for (let tau = 0; tau < half; tau++) {
    let s = 0;
    for (let j = 0; j < half; j++) {
      const d = (buffer[j] ?? 0) - (buffer[j + tau] ?? 0);
      s += d * d;
    }
    diff[tau] = s;
  }

  // Cumulative mean normalised difference
  const cmnd = new Float32Array(half);
  cmnd[0] = 1;
  let runSum = 0;
  for (let tau = 1; tau < half; tau++) {
    runSum += diff[tau] ?? 0;
    cmnd[tau] = runSum === 0 ? 0 : ((diff[tau] ?? 0) * tau) / runSum;
  }

  // Find first minimum below threshold
  const minPeriod = Math.floor(sampleRate / MAX_FREQ);
  const maxPeriod = Math.floor(sampleRate / MIN_FREQ);
  let tau = minPeriod;

  while (tau < maxPeriod) {
    if ((cmnd[tau] ?? 1) < YIN_THRESHOLD) {
      // Parabolic interpolation
      const prev = cmnd[tau - 1] ?? (cmnd[tau] ?? 0);
      const curr = cmnd[tau] ?? 0;
      const next = cmnd[tau + 1] ?? (cmnd[tau] ?? 0);
      const denom = 2 * (2 * curr - prev - next);
      const refined = denom === 0 ? tau : tau + (prev - next) / denom;
      return sampleRate / refined;
    }
    tau++;
  }

  return null;
}

// ── 帧序列 → 音符列表 ────────────────────────────────────────────────

function framesToNotes(frames: PitchFrame[]): RawNote[] {
  const notes: RawNote[] = [];

  let noteStart   = 0;
  let notePitch   = 0;
  let noteEnergies: number[] = [];

  const flush = (endTime: number) => {
    const dur = endTime - noteStart;
    if (notePitch > 0 && dur >= MIN_NOTE_DURATION) {
      const avgE = noteEnergies.reduce((a, b) => a + b, 0) / Math.max(1, noteEnergies.length);
      notes.push({
        pitch:      notePitch,
        start:      noteStart,
        duration:   dur,
        velocity:   Math.min(1, avgE * 10),
        confidence: Math.min(1, 0.6 + avgE * 4),
      });
    }
    notePitch = 0;
    noteEnergies = [];
  };

  for (const frame of frames) {
    const { midi, time, energy } = frame;

    if (midi === null || energy < SILENCE_THRESHOLD) {
      if (notePitch > 0) flush(time);
      continue;
    }

    if (notePitch === 0) {
      noteStart = time;
      notePitch = midi;
      noteEnergies = [energy];
    } else if (Math.abs(midi - notePitch) <= PITCH_CHANGE_TOLERANCE) {
      // 同一音符，加权平均稳定音高
      const n = noteEnergies.length;
      notePitch = Math.round((notePitch * n + midi) / (n + 1));
      noteEnergies.push(energy);
    } else {
      // 音高跳变
      flush(time);
      noteStart   = time;
      notePitch   = midi;
      noteEnergies = [energy];
    }
  }

  if (frames.length > 0) flush(frames[frames.length - 1]!.time + HOP_SIZE / 44100);

  return notes;
}

// ── 主入口 ────────────────────────────────────────────────────────────

/**
 * 对录音 Blob 进行 YIN 音高识别。
 *
 * v2 改动：使用普通 AudioContext 而非 OfflineAudioContext，
 * 因为后者在 iframe/E2B 沙盒环境里经常崩溃。
 *
 * 如果解码失败，返回空 notes 让上层走 fixture，而不是 throw。
 */
export async function analyzeAudio(audioBlob: Blob): Promise<PitchEngineResult> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  // 用普通（在线）AudioContext 解码 — 在 iframe 里更稳定
  // 如果已有一个 running 的 context 直接复用；没有就创建一个
  let audioBuffer: AudioBuffer | null = null;
  try {
    const ctx = new AudioContext({ sampleRate: 44100 });
    // decodeAudioData 在 ctx.state === "suspended" 时也能工作
    audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(
        arrayBuffer.slice(0),  // 必须传副本，避免 detached ArrayBuffer
        resolve,
        reject
      );
    });
    // 解码完了立刻关掉，不占用音频资源
    ctx.close().catch(() => {});
  } catch (e) {
    console.warn("[pitch-engine] decodeAudioData failed:", e);
    return { notes: [], duration: 0, method: "browser-yin", frameCount: 0 };
  }

  if (!audioBuffer) {
    return { notes: [], duration: 0, method: "browser-yin", frameCount: 0 };
  }

  const duration   = audioBuffer.duration;
  const sampleRate = audioBuffer.sampleRate;

  // 取单声道 PCM（混合多声道）
  let pcm: Float32Array;
  if (audioBuffer.numberOfChannels === 1) {
    pcm = audioBuffer.getChannelData(0);
  } else {
    // 混合所有声道
    const len = audioBuffer.length;
    pcm = new Float32Array(len);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const chData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) pcm[i] = (pcm[i] ?? 0) + (chData[i] ?? 0);
    }
    const nCh = audioBuffer.numberOfChannels;
    for (let i = 0; i < len; i++) pcm[i] = (pcm[i] ?? 0) / nCh;
  }

  // 如果采样率不是 44100Hz，做简单整数重采样
  if (sampleRate !== 44100 && sampleRate > 0) {
    const ratio    = sampleRate / 44100;
    const newLen   = Math.floor(pcm.length / ratio);
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i * ratio;
      const lo     = Math.floor(srcIdx);
      const hi     = Math.min(lo + 1, pcm.length - 1);
      const frac   = srcIdx - lo;
      resampled[i] = (pcm[lo] ?? 0) * (1 - frac) + (pcm[hi] ?? 0) * frac;
    }
    pcm = resampled;
  }

  // 逐帧 YIN 分析
  const frames: PitchFrame[] = [];
  const targetRate = 44100;

  for (let i = 0; i + FRAME_SIZE < pcm.length; i += HOP_SIZE) {
    const frame  = pcm.slice(i, i + FRAME_SIZE);
    const energy = rms(frame);
    const freq   = detectPitch(frame, targetRate);
    const midi   = freq !== null ? freqToMidi(freq) : null;

    // 限制到人声 MIDI 范围 C2(36) ~ C6(84)
    const validMidi = midi !== null && midi >= 36 && midi <= 84 ? midi : null;

    frames.push({ midi: validMidi, time: i / targetRate, energy });
  }

  const notes = framesToNotes(frames);

  return { notes, duration, method: "browser-yin", frameCount: frames.length };
}
