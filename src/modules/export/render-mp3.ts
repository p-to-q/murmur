"use client";
/**
 * render-mp3 — offline render the current arrangement into an audio file.
 *
 * Pipeline (v2):
 *   1. assembleSong() — same source of truth as the live SimpleSynth, so
 *      the saved MP3 sounds identical to what the user previewed.
 *   2. Tone.Offline — schedules every event on a sealed OfflineAudioContext.
 *   3. A small reverb + a soft compressor sit on the master bus to give
 *      the result the "produced" sheen of a finished little song.
 *   4. lamejs encodes the buffer to MP3 at 128kbps mono; fallback to WAV
 *      blob; final fallback returns null and the song still saves without
 *      audio.
 *
 * Bundle cost: ~2KB net (Tone.js was already in deps).
 */

import { assembleSong } from "@/lib/music/assemble-song";
import type { VersionGeneration, VibeVersion } from "@/modules/shared/types";
import { audioBufferToWav, blobToDataUrl } from "./render-wav";

const MP3_BITRATE = 128;
const SAMPLE_RATE = 44100;

export type RenderedAudio = {
  dataUrl: string;
  mime: "audio/mpeg" | "audio/wav";
  durationSec: number;
  sizeBytes: number;
};

export async function renderAudio(version: VibeVersion): Promise<RenderedAudio | null> {
  // Magenta versions: the clip the user previewed IS the song — transcode it
  // instead of re-rendering the (unheard) Tone.js arrangement. Returns null
  // rather than falling through: saving synth audio that doesn't match what
  // the user heard would be worse than saving no audio.
  if (version.generation) {
    return transcodeGeneratedClip(version.generation);
  }

  let buffer: AudioBuffer | null = null;
  try {
    buffer = await renderToBuffer(version);
  } catch (e) {
    console.warn("[render-mp3] offline render failed:", e);
    return null;
  }
  if (!buffer || buffer.length === 0) return null;

  try {
    const mp3Blob = await encodeMp3(buffer);
    return {
      dataUrl: await blobToDataUrl(mp3Blob),
      mime: "audio/mpeg",
      durationSec: buffer.duration,
      sizeBytes: mp3Blob.size,
    };
  } catch (e) {
    console.warn("[render-mp3] lamejs encode failed, falling back to WAV:", e);
  }

  try {
    const wavBlob = audioBufferToWav(buffer);
    return {
      dataUrl: await blobToDataUrl(wavBlob),
      mime: "audio/wav",
      durationSec: buffer.duration,
      sizeBytes: wavBlob.size,
    };
  } catch (e) {
    console.warn("[render-mp3] wav fallback failed:", e);
    return null;
  }
}

// ── Magenta clip transcode ────────────────────────────────────────────

async function transcodeGeneratedClip(
  generation: VersionGeneration,
): Promise<RenderedAudio | null> {
  if (generation.status !== "ready" || !generation.audioUrl) return null;

  let wavBytes: ArrayBuffer;
  try {
    const res = await fetch(generation.audioUrl);
    wavBytes = await res.arrayBuffer();
  } catch (e) {
    console.warn("[render-mp3] could not read generated clip:", e);
    return null;
  }

  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) throw new Error("AudioContext unavailable");
    const ctx = new Ctx();
    const buffer = await ctx.decodeAudioData(wavBytes.slice(0));
    await ctx.close();
    const mp3Blob = await encodeMp3(buffer);
    return {
      dataUrl: await blobToDataUrl(mp3Blob),
      mime: "audio/mpeg",
      durationSec: buffer.duration,
      sizeBytes: mp3Blob.size,
    };
  } catch (e) {
    console.warn("[render-mp3] clip transcode failed, storing raw WAV:", e);
  }

  try {
    const wavBlob = new Blob([wavBytes], { type: "audio/wav" });
    return {
      dataUrl: await blobToDataUrl(wavBlob),
      mime: "audio/wav",
      durationSec: generation.durationSec,
      sizeBytes: wavBlob.size,
    };
  } catch (e) {
    console.warn("[render-mp3] wav fallback failed:", e);
    return null;
  }
}

// ── Tone.Offline render ───────────────────────────────────────────────

async function renderToBuffer(version: VibeVersion): Promise<AudioBuffer> {
  const Tone = await import("tone");
  const arr = version.arrangementState;
  const song = assembleSong(version);

  const buf = await Tone.Offline(({ transport }) => {
    transport.bpm.value = Math.max(40, Math.min(200, version.melody.bpm));

    // ── Master chain: light compression → reverb send → destination ──
    const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.25, preDelay: 0.02 }).toDestination();
    const comp = new Tone.Compressor({ ratio: 2.4, threshold: -22, attack: 0.01, release: 0.1 })
      .connect(reverb);

    // ── Melody ────────────────────────────────────────────
    if (arr.melody.enabled && arr.melody.intensity > 0.02 && version.melody.notes.length) {
      const melSynth = buildMelodySynth(Tone, arr.melody.instrument);
      const melGain = new Tone.Gain(clamp(arr.melody.intensity * 0.95)).connect(comp);
      melSynth.disconnect();
      melSynth.connect(melGain);
      for (const n of version.melody.notes) {
        if (n.start >= song.totalDuration) continue;
        const dur = Math.max(0.06, Math.min(n.duration - 0.02, song.totalDuration - n.start));
        const vel = Math.max(0.01, Math.min(1, n.velocity));
        melSynth.triggerAttackRelease(midiToFreqName(n.pitch), dur, n.start, vel);
      }
    }

    // ── Chords (voiced via chord-engine) ──────────────────
    if (arr.chords.enabled && arr.chords.intensity > 0.02) {
      const chordSynth = buildChordSynth(Tone, arr.chords.instrument);
      const chordGain = new Tone.Gain(clamp(arr.chords.intensity * 0.48)).connect(comp);
      chordSynth.disconnect();
      chordSynth.connect(chordGain);
      for (const ev of song.chords) {
        const notes = ev.midi.map((m) => midiToFreqName(m));
        chordSynth.triggerAttackRelease(notes, ev.duration * 0.92, ev.time, 0.55);
      }
    }

    // ── Strings pad — top voices ───────────────────────────
    if (arr.strings.enabled && arr.strings.intensity > 0.04 && song.chords.length) {
      const padSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 1.8 },
      });
      const padGain = new Tone.Gain(clamp(arr.strings.intensity * 0.4)).connect(comp);
      padSynth.disconnect();
      padSynth.connect(padGain);
      for (const ev of song.chords) {
        const tops = ev.midi.slice(-3).map((m) => midiToFreqName(m));
        padSynth.triggerAttackRelease(tops, ev.duration * 0.95, ev.time, 0.5);
      }
    }

    // ── Bass (pattern-driven) ─────────────────────────────
    if (arr.bass.enabled && arr.bass.intensity > 0.02) {
      const bassSynth = buildBassSynth(Tone, arr.bass.instrument);
      const bassGain = new Tone.Gain(clamp(arr.bass.intensity * 0.65)).connect(comp);
      bassSynth.disconnect();
      bassSynth.connect(bassGain);
      for (const b of song.bass) {
        bassSynth.triggerAttackRelease(midiToFreqName(b.pitch), b.duration, b.time, b.velocity);
      }
    }

    // ── Texture pad — long held drone ─────────────────────
    if (arr.texture.enabled && arr.texture.intensity > 0.04 && song.chords.length) {
      const tex = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 1.0, decay: 0.5, sustain: 0.8, release: 2.5 },
      });
      const texGain = new Tone.Gain(clamp(arr.texture.intensity * 0.3)).connect(comp);
      tex.disconnect();
      tex.connect(texGain);
      const firstRoot = song.chords[0]!.rootMidi - 12;
      tex.triggerAttackRelease(midiToFreqName(firstRoot), song.totalDuration * 0.96, 0, 0.4);
    }

    // ── Drums ─────────────────────────────────────────────
    if (arr.drums.enabled && arr.drums.intensity > 0.04) {
      scheduleDrums(Tone, comp, song.drums);
    }

    transport.start();
  }, song.totalDuration, 2, SAMPLE_RATE);

  return (buf as unknown as { get(): AudioBuffer }).get?.() ?? (buf as unknown as AudioBuffer);
}

// ── Drum scheduling ────────────────────────────────────────────────────

function scheduleDrums(
  Tone: typeof import("tone"),
  bus: import("tone").ToneAudioNode,
  hits: ReturnType<typeof assembleSong>["drums"]
) {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 4,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
  });
  const kickGain = new Tone.Gain(0.85).connect(bus);
  kick.disconnect(); kick.connect(kickGain);

  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
  });
  const snareGain = new Tone.Gain(0.55).connect(bus);
  snare.disconnect(); snare.connect(snareGain);

  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.08, release: 0.1 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
  });
  const hatGain = new Tone.Gain(0.32).connect(bus);
  hat.disconnect(); hat.connect(hatGain);

  for (const h of hits) {
    switch (h.type) {
      case "kick":  kick.triggerAttackRelease("C2", "8n", h.time, h.velocity); break;
      case "snare": snare.triggerAttackRelease("16n", h.time, h.velocity); break;
      case "hihat": hat.triggerAttackRelease("32n", h.time, h.velocity * 0.85); break;
      case "open":  hat.triggerAttackRelease("8n", h.time, h.velocity * 0.85); break;
      case "ghost": snare.triggerAttackRelease("32n", h.time, h.velocity * 0.55); break;
    }
  }
}

// ── Synth builders (trimmed; rest of the file mirrors live-preview voices) ─

function buildMelodySynth(Tone: typeof import("tone"), instrument: string) {
  const settings = melodyTimbre(instrument);
  return new Tone.Synth({
    oscillator: { type: settings.osc },
    envelope: settings.envelope,
  });
}
function melodyTimbre(instrument: string): {
  osc: OscillatorType;
  envelope: { attack: number; decay: number; sustain: number; release: number };
} {
  switch (instrument) {
    case "bell":            return { osc: "sine", envelope: { attack: 0.005, decay: 0.6, sustain: 0.05, release: 0.8 } };
    case "marimba":         return { osc: "sine", envelope: { attack: 0.005, decay: 0.25, sustain: 0.05, release: 0.3 } };
    case "synth_lead":      return { osc: "square", envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.3 } };
    case "arp_synth":       return { osc: "square", envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.2 } };
    case "acoustic_guitar": return { osc: "triangle", envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 0.6 } };
    case "electric_piano":  return { osc: "triangle", envelope: { attack: 0.01, decay: 0.4, sustain: 0.4, release: 0.6 } };
    case "piano":
    default:                return { osc: "triangle", envelope: { attack: 0.01, decay: 0.5, sustain: 0.3, release: 0.8 } };
  }
}

function buildChordSynth(Tone: typeof import("tone"), instrument: string) {
  switch (instrument) {
    case "strings":
    case "soft_pad":
    case "synth_pad":
    case "vinyl_pad":
    case "cello_pad":
    case "filter_pad":
    case "poly_synth":
    case "stab_synth":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.3, decay: 0.4, sustain: 0.7, release: 1.4 },
      });
    case "piano":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0.3, release: 0.7 },
      });
    case "acoustic_guitar":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.6, sustain: 0.1, release: 0.6 },
      });
    default:
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.8 },
      });
  }
}

function buildBassSynth(Tone: typeof import("tone"), instrument: string) {
  switch (instrument) {
    case "sub_bass":      return new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.5 } });
    case "soft_bass":
    case "upright_bass":
    case "fretless":      return new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 0.6 } });
    case "synth_bass":
    case "cello_bass":
    default:              return new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.5 } });
  }
}

// ── MP3 encoding via lamejs ────────────────────────────────────────────

async function encodeMp3(buffer: AudioBuffer): Promise<Blob> {
  const mod = (await import("@breezystack/lamejs")) as unknown as {
    Mp3Encoder?: new (
      channels: number,
      sampleRate: number,
      kbps: number
    ) => {
      encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
      flush(): Uint8Array;
    };
    default?: {
      Mp3Encoder?: new (
        channels: number,
        sampleRate: number,
        kbps: number
      ) => {
        encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
        flush(): Uint8Array;
      };
    };
  };
  const Mp3Encoder = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error("lamejs.Mp3Encoder not found");

  const channels = 1;
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(channels, sampleRate, MP3_BITRATE);
  const mono = mixToMonoInt16(buffer);

  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < mono.length; i += blockSize) {
    const slice = mono.subarray(i, Math.min(i + blockSize, mono.length));
    const buf = encoder.encodeBuffer(slice);
    if (buf.length > 0) chunks.push(buf);
  }
  const final = encoder.flush();
  if (final.length > 0) chunks.push(final);

  const parts = chunks.map(
    (c) => new Uint8Array(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)) as unknown as BlobPart
  );
  return new Blob(parts, { type: "audio/mpeg" });
}

function mixToMonoInt16(buffer: AudioBuffer): Int16Array {
  const n = buffer.length;
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const out = new Int16Array(n);
  const div = buffer.numberOfChannels;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < div; c++) s += channels[c]![i] ?? 0;
    s /= div;
    s = Math.max(-1, Math.min(1, s));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function midiToFreqName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((midi % 12) + 12) % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}
