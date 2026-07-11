/**
 * Client-side pitch detection fallback.
 *
 * When the remote audio worker is unavailable, this module provides a
 * degraded-but-usable transcription path using browser-side pitch
 * detection. The WASM module is lazy-loaded on first use so it never
 * inflates the initial bundle.
 *
 * Architecture:
 *   remote RMVPE (best model)
 *     → local SwiftF0 (worker-side fallback, if deployed)
 *       → client pYIN (this module, browser-side last resort)
 *
 * The output is a raw note array in the same shape as the audio worker's
 * response. Callers (Stainer) run it through the same melody-polisher +
 * humming-engine pipeline so the rest of the app sees a normal
 * TranscriptionResult regardless of where pitch detection happened.
 */

import type { MelodyNote } from "@/modules/shared/types";
import { log } from "@/lib/observability/log";

export type ClientPitchResult = {
  provider: "client_pyin";
  rawNotes: MelodyNote[];
  diagnostics: {
    totalMs: number;
    sampleRate: number;
    frameCount: number;
    voicedFrames: number;
  };
};

type PitchFrame = {
  time: number;
  frequency: number;
  confidence: number;
  voiced: boolean;
};

let wasmReady: Promise<boolean> | null = null;
let essentiaInstance: EssentiaLike | null = null;

interface EssentiaLike {
  PitchYinProbabilistic: (
    signal: Float32Array,
    frameSize: number,
    hopSize: number,
    lowRMSThreshold: number,
    outputUnvoiced: string,
    preciseTime: boolean,
    sampleRate: number,
  ) => {
    pitch: Float32Array;
    voicedProbabilities: Float32Array;
  };
}

const HOP_SIZE = 256;
const FRAME_SIZE = 2048;
const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 800;
const VOICED_THRESHOLD = 0.3;
const MIN_NOTE_DURATION = 0.06;
const PITCH_MERGE_CENTS = 80;

/**
 * Check whether the client-side pitch engine is available. Returns true
 * if Essentia.js WASM is installed and loads successfully.
 */
export async function isClientPitchAvailable(): Promise<boolean> {
  if (wasmReady) return wasmReady;
  wasmReady = loadEssentia().then(
    (ok) => ok,
    () => false,
  );
  return wasmReady;
}

async function loadEssentia(): Promise<boolean> {
  try {
    const mod = await import("essentia.js");
    const essentia = new mod.Essentia(mod.EssentiaWASM);
    essentiaInstance = essentia as unknown as EssentiaLike;
    log("client_pitch.wasm_loaded", {});
    return true;
  } catch {
    log("client_pitch.wasm_unavailable", {}, { level: "warn" });
    return false;
  }
}

/**
 * Run client-side pYIN pitch detection on a decoded audio buffer.
 * The buffer should be mono, 44100 Hz preferred.
 */
export async function detectPitchClient(
  audioBuffer: AudioBuffer,
): Promise<ClientPitchResult> {
  const startedAt = performance.now();
  const available = await isClientPitchAvailable();
  if (!available || !essentiaInstance) {
    throw new Error("Client pitch detection is not available");
  }

  const sampleRate = audioBuffer.sampleRate;
  const mono = audioBuffer.numberOfChannels > 1
    ? mixToMono(audioBuffer)
    : audioBuffer.getChannelData(0);

  const { pitch, voicedProbabilities } = essentiaInstance.PitchYinProbabilistic(
    mono,
    FRAME_SIZE,
    HOP_SIZE,
    0.1,
    "zero",
    true,
    sampleRate,
  );

  const frames = buildFrames(pitch, voicedProbabilities, sampleRate);
  const notes = framesToNotes(frames, sampleRate);
  const totalMs = Math.round(performance.now() - startedAt);
  const voicedFrames = frames.filter((f) => f.voiced).length;

  log("client_pitch.completed", {
    noteCount: notes.length,
    frameCount: frames.length,
    voicedFrames,
    totalMs,
    sampleRate,
  });

  return {
    provider: "client_pyin",
    rawNotes: notes,
    diagnostics: {
      totalMs,
      sampleRate,
      frameCount: frames.length,
      voicedFrames,
    },
  };
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i];
    }
  }
  const scale = 1 / channels;
  for (let i = 0; i < length; i++) {
    mono[i] *= scale;
  }
  return mono;
}

function buildFrames(
  pitch: Float32Array,
  voiced: Float32Array,
  sampleRate: number,
): PitchFrame[] {
  const hopSeconds = HOP_SIZE / sampleRate;
  const frames: PitchFrame[] = [];
  for (let i = 0; i < pitch.length; i++) {
    const freq = pitch[i];
    const conf = voiced[i];
    const isVoiced = conf > VOICED_THRESHOLD && freq > MIN_PITCH_HZ && freq < MAX_PITCH_HZ;
    frames.push({
      time: i * hopSeconds,
      frequency: isVoiced ? freq : 0,
      confidence: conf,
      voiced: isVoiced,
    });
  }
  return frames;
}

function hzToMidi(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

function framesToNotes(frames: PitchFrame[], sampleRate: number): MelodyNote[] {
  const notes: MelodyNote[] = [];
  let noteStart = -1;
  let pitchSum = 0;
  let confSum = 0;
  let frameCount = 0;

  for (let i = 0; i <= frames.length; i++) {
    const frame = frames[i];
    const isVoiced = frame?.voiced ?? false;

    if (isVoiced && noteStart < 0) {
      noteStart = i;
      pitchSum = frame!.frequency;
      confSum = frame!.confidence;
      frameCount = 1;
    } else if (isVoiced && noteStart >= 0) {
      pitchSum += frame!.frequency;
      confSum += frame!.confidence;
      frameCount++;
    } else if (!isVoiced && noteStart >= 0) {
      const avgHz = pitchSum / frameCount;
      const avgConf = confSum / frameCount;
      const start = frames[noteStart]!.time;
      const end = frames[i - 1]!.time + (HOP_SIZE / sampleRate);
      const duration = end - start;

      if (duration >= MIN_NOTE_DURATION) {
        const midi = Math.round(hzToMidi(avgHz));
        const lastNote = notes[notes.length - 1];
        if (lastNote && Math.abs(midi - lastNote.pitch) * 100 < PITCH_MERGE_CENTS) {
          lastNote.duration = end - lastNote.start;
          lastNote.confidence = Math.max(lastNote.confidence, avgConf);
        } else {
          notes.push({
            pitch: midi,
            start,
            duration,
            velocity: Math.min(1, Math.max(0.3, avgConf * 0.9)),
            confidence: avgConf,
          });
        }
      }

      noteStart = -1;
      pitchSum = 0;
      confSum = 0;
      frameCount = 0;
    }
  }

  return notes;
}
