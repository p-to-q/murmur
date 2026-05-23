"use client";
/**
 * SimpleSynth v3 — the live-preview engine.
 *
 * What changed in v3 vs v2:
 *   - Takes a VibeVersion (not raw notes + chord strings). It calls
 *     assembleSong() to get chord / bass / drum tracks so live preview is
 *     identical to the saved MP3.
 *   - Multi-oscillator detuned voices for sustained tracks (chords, strings,
 *     bass) so the sound stops feeling like a single sine wave.
 *   - Per-track filter envelope where the timbre asks for one — gives the
 *     "attack bite" that's missing from a flat ADSR.
 *   - A cheap programmatic reverb (ConvolverNode + synthesized noise IR) on
 *     a shared send bus. ~6KB code, no asset, big perceived upgrade.
 *   - Drum voices: kick/snare/hi-hat/open-hat/ghost — picked from the
 *     DrumHit type by drum-engine.
 *
 * Bundle cost: ~3KB net (still pure Web Audio API, zero npm deps added).
 */

import type { VibeVersion } from "@/modules/shared/types";
import { assembleSong } from "./assemble-song";

export type IntensityOverride = Partial<{
  melody: number;
  chords: number;
  strings: number;
  bass: number;
  drums: number;
  texture: number;
}>;

// ── Timbre definitions ────────────────────────────────────────────────

interface TimbreSpec {
  /** Primary oscillator type. */
  type: OscillatorType;
  /** Detune (cents) per voice — if >0, two voices are layered with ±detune. */
  detune?: number;
  /** Sub-oscillator one octave below (sine), volume 0..1. */
  sub?: number;
  /** Amp envelope. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Lowpass filter envelope: cutoff sweeps from filterPeak → filterFloor. */
  filterPeak?: number;
  filterFloor?: number;
  /** Overall gain scaling 0..1 */
  gain: number;
  /** Send level to the reverb bus, 0..1. */
  reverb?: number;
}

const TIMBRES: Record<string, TimbreSpec> = {
  // ── Melody ───────────────────────────────────────────────
  bell:           { type: "sine",     attack: 0.003, decay: 0.55, sustain: 0.05, release: 0.9, gain: 0.85, reverb: 0.5 },
  marimba:        { type: "sine",     sub: 0.4,     attack: 0.003, decay: 0.25, sustain: 0.04, release: 0.3, gain: 0.75, reverb: 0.32 },
  piano:          { type: "triangle", detune: 6,    attack: 0.008, decay: 0.45, sustain: 0.28, release: 0.7, gain: 0.78, filterPeak: 3200, filterFloor: 1400, reverb: 0.35 },
  electric_piano: { type: "triangle", detune: 8,    attack: 0.01,  decay: 0.5,  sustain: 0.4,  release: 0.6, gain: 0.72, filterPeak: 2400, filterFloor: 900,  reverb: 0.45 },
  synth_lead:     { type: "sawtooth", detune: 7,    attack: 0.008, decay: 0.1,  sustain: 0.6,  release: 0.3, gain: 0.7, filterPeak: 4200, filterFloor: 1800, reverb: 0.28 },
  arp_synth:      { type: "square",   detune: 4,    attack: 0.005, decay: 0.15, sustain: 0.45, release: 0.22,gain: 0.65, filterPeak: 3000, filterFloor: 1400, reverb: 0.32 },
  acoustic_guitar:{ type: "triangle", detune: 5,    attack: 0.004, decay: 0.55, sustain: 0.12, release: 0.5, gain: 0.7,  reverb: 0.4 },

  // ── Chords / pads ────────────────────────────────────────
  strings:        { type: "sawtooth", detune: 9,    attack: 0.5,   decay: 0.3,  sustain: 0.85, release: 1.8, gain: 0.5,  filterPeak: 1800, filterFloor: 1100, reverb: 0.7 },
  cello_pad:      { type: "sawtooth", detune: 12,   attack: 0.55,  decay: 0.2,  sustain: 0.9,  release: 2.2, gain: 0.46, filterPeak: 1500, filterFloor: 900,  reverb: 0.65 },
  soft_pad:       { type: "sine",     detune: 10,   attack: 0.4,   decay: 0.2,  sustain: 0.85, release: 2.0, gain: 0.48, reverb: 0.7 },
  vinyl_pad:      { type: "triangle", detune: 7,    attack: 0.3,   decay: 0.2,  sustain: 0.65, release: 1.4, gain: 0.45, filterPeak: 1700, filterFloor: 1000, reverb: 0.5 },
  ambient_pad:    { type: "sine",     detune: 14,   attack: 0.7,   decay: 0.15, sustain: 0.9,  release: 2.5, gain: 0.42, reverb: 0.85 },
  filter_pad:     { type: "sawtooth", detune: 8,    attack: 0.35,  decay: 0.18, sustain: 0.7,  release: 1.5, gain: 0.45, filterPeak: 2400, filterFloor: 1100, reverb: 0.55 },
  poly_synth:     { type: "sawtooth", detune: 6,    attack: 0.02,  decay: 0.3,  sustain: 0.55, release: 0.8, gain: 0.5,  filterPeak: 2800, filterFloor: 1400, reverb: 0.4 },
  stab_synth:     { type: "square",   detune: 5,    attack: 0.004, decay: 0.25, sustain: 0.1,  release: 0.3, gain: 0.6,  filterPeak: 3200, filterFloor: 1500, reverb: 0.32 },
  synth_pad:      { type: "sawtooth", detune: 11,   attack: 0.45,  decay: 0.15, sustain: 0.8,  release: 2.0, gain: 0.42, filterPeak: 2200, filterFloor: 1100, reverb: 0.55 },

  // ── Bass ────────────────────────────────────────────────
  synth_bass:     { type: "sawtooth", sub: 0.6,     attack: 0.008, decay: 0.2,  sustain: 0.7,  release: 0.4, gain: 0.78, filterPeak: 800, filterFloor: 280, reverb: 0.08 },
  sub_bass:       { type: "sine",     sub: 0.8,     attack: 0.02,  decay: 0.2,  sustain: 0.75, release: 0.5, gain: 0.85, reverb: 0.05 },
  soft_bass:      { type: "triangle", sub: 0.5,     attack: 0.04,  decay: 0.3,  sustain: 0.55, release: 0.6, gain: 0.7,  reverb: 0.18 },
  upright_bass:   { type: "triangle", sub: 0.4,     attack: 0.03,  decay: 0.45, sustain: 0.32, release: 0.5, gain: 0.7,  reverb: 0.2 },
  cello_bass:     { type: "sawtooth", detune: 6,    attack: 0.08,  decay: 0.2,  sustain: 0.6,  release: 0.8, gain: 0.58, filterPeak: 1200, filterFloor: 500, reverb: 0.4 },
  fretless:       { type: "triangle", sub: 0.3,     attack: 0.06,  decay: 0.25, sustain: 0.55, release: 0.5, gain: 0.62, reverb: 0.25 },

  // ── Texture pads (texture track) ────────────────────────
  modular_air:    { type: "sine",     detune: 18,   attack: 1.0,   decay: 0.2,  sustain: 0.65, release: 3.0, gain: 0.28, reverb: 0.85 },
  rain_air:       { type: "sine",     detune: 14,   attack: 0.9,   decay: 0.2,  sustain: 0.75, release: 2.5, gain: 0.24, reverb: 0.8 },
  warm_air:       { type: "triangle", detune: 11,   attack: 0.7,   decay: 0.15, sustain: 0.78, release: 2.0, gain: 0.26, reverb: 0.65 },
  reverb_hall:    { type: "sine",     detune: 16,   attack: 0.6,   decay: 0.1,  sustain: 0.85, release: 3.5, gain: 0.22, reverb: 0.9 },
  tape_hiss:      { type: "sine",     detune: 8,    attack: 0.5,   decay: 0.2,  sustain: 0.55, release: 1.5, gain: 0.18, reverb: 0.4 },
  sidechain:      { type: "sawtooth", detune: 6,    attack: 0.01,  decay: 0.2,  sustain: 0.3,  release: 0.5, gain: 0.3,  filterPeak: 1100, filterFloor: 500, reverb: 0.3 },

  default:        { type: "sine",     attack: 0.05,  decay: 0.2,  sustain: 0.5,  release: 0.5, gain: 0.6 },
};

const timbreFor = (instrument: string): TimbreSpec =>
  TIMBRES[instrument] ?? TIMBRES.default!;

// ── Engine ────────────────────────────────────────────────────────────

class SimpleSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private stopFns: Array<() => void> = [];

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: 44100 });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.78;
      this.masterGain.connect(this.ctx.destination);

      // Programmatic reverb: convolver with a synthesized noise IR.
      const reverb = this.makeReverb(this.ctx, 1.8);
      this.convolver = reverb.convolver;
      this.reverbReturn = reverb.gain;
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 1.0;
      this.reverbSend.connect(this.convolver);
      this.reverbReturn.connect(this.masterGain);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Build a short stereo reverb. Free, deterministic, ~2s tail. */
  private makeReverb(ctx: AudioContext, seconds: number) {
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        // Exponential decay of white noise — classic synthetic IR.
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = buffer;
    const wet = ctx.createGain();
    wet.gain.value = 0.32; // overall wetness
    convolver.connect(wet);
    return { convolver, gain: wet };
  }

  stop(): void {
    this.stopFns.forEach((f) => { try { f(); } catch {} });
    this.stopFns = [];
  }

  // ── Note primitive ────────────────────────────────────
  private noteAt(
    ctx: AudioContext,
    dry: AudioNode,
    wetSend: GainNode,
    midi: number,
    tStart: number,
    tEnd: number,
    velocity: number,
    timbre: TimbreSpec
  ): void {
    try {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const dur = Math.max(0.06, tEnd - tStart);
      const vol = Math.max(0.001, Math.min(1, velocity)) * timbre.gain;

      const oscs: OscillatorNode[] = [];
      const make = (type: OscillatorType, detune: number, gainScale: number) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        if (detune) o.detune.value = detune;
        oscs.push(o);
        return { osc: o, gainScale };
      };

      const voices: Array<{ osc: OscillatorNode; gainScale: number }> = [];
      // Primary
      voices.push(make(timbre.type, 0, 1));
      // Detuned partner (unison)
      if (timbre.detune) {
        voices.push(make(timbre.type, +timbre.detune, 0.7));
        voices.push(make(timbre.type, -timbre.detune, 0.7));
      }
      // Sub-oscillator
      if (timbre.sub) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq / 2;
        oscs.push(o);
        voices.push({ osc: o, gainScale: timbre.sub });
      }

      // Amp envelope
      const amp = ctx.createGain();
      const sustainLevel = vol * timbre.sustain;
      const atk = Math.min(timbre.attack, dur * 0.4);
      const dec = Math.min(timbre.decay, dur * 0.5);
      amp.gain.setValueAtTime(0.0001, tStart);
      amp.gain.linearRampToValueAtTime(vol, tStart + atk);
      amp.gain.linearRampToValueAtTime(sustainLevel, tStart + atk + dec);
      amp.gain.setValueAtTime(sustainLevel, Math.max(tStart + atk + dec, tEnd - 0.02));
      amp.gain.linearRampToValueAtTime(0.0001, tEnd + timbre.release * 0.5);

      // Filter envelope (optional)
      let lastNode: AudioNode = amp;
      if (timbre.filterPeak && timbre.filterFloor) {
        const filt = ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.Q.value = 1.2;
        filt.frequency.setValueAtTime(timbre.filterPeak, tStart);
        filt.frequency.exponentialRampToValueAtTime(
          Math.max(120, timbre.filterFloor),
          tStart + Math.min(0.8, dur * 0.8)
        );
        amp.connect(filt);
        lastNode = filt;
      }

      // Sum voices into the amp input
      const sumIn = ctx.createGain();
      sumIn.gain.value = 1.0;
      sumIn.connect(amp);
      for (const v of voices) {
        const g = ctx.createGain();
        g.gain.value = v.gainScale;
        v.osc.connect(g).connect(sumIn);
      }

      // Dry + wet routing
      lastNode.connect(dry);
      if (timbre.reverb && timbre.reverb > 0.02) {
        const send = ctx.createGain();
        send.gain.value = timbre.reverb;
        lastNode.connect(send);
        send.connect(wetSend);
      }

      for (const o of oscs) {
        o.start(tStart);
        o.stop(tEnd + timbre.release * 0.6);
      }
      this.stopFns.push(() => {
        for (const o of oscs) { try { o.stop(); } catch {} }
      });
    } catch { /* skip */ }
  }

  // ── Drum voices ───────────────────────────────────────
  private kick(ctx: AudioContext, dry: AudioNode, t: number, vol: number): void {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.14);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain); gain.connect(dry);
      osc.start(t); osc.stop(t + 0.24);
      this.stopFns.push(() => { try { osc.stop(); } catch {} });
    } catch {}
  }

  private snare(ctx: AudioContext, dry: AudioNode, wetSend: GainNode, t: number, vol: number): void {
    try {
      const bufSize = Math.floor(ctx.sampleRate * 0.14);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.28));
      }
      const src = ctx.createBufferSource();
      const filt = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filt.type = "bandpass";
      filt.frequency.value = 2400;
      filt.Q.value = 0.8;
      gain.gain.setValueAtTime(vol * 0.55, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      src.buffer = buf;
      src.connect(filt); filt.connect(gain);
      gain.connect(dry);
      // Light reverb send
      const sendG = ctx.createGain();
      sendG.gain.value = 0.18;
      gain.connect(sendG); sendG.connect(wetSend);
      src.start(t);
      this.stopFns.push(() => { try { src.stop(); } catch {} });
    } catch {}
  }

  private hihat(ctx: AudioContext, dry: AudioNode, t: number, vol: number, open: boolean): void {
    try {
      const bufSize = Math.floor(ctx.sampleRate * (open ? 0.22 : 0.06));
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * (open ? 0.6 : 0.2)));
      }
      const src = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      hp.type = "highpass";
      hp.frequency.value = 7400;
      gain.gain.setValueAtTime(vol * 0.32, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.2 : 0.06));
      src.buffer = buf;
      src.connect(hp); hp.connect(gain); gain.connect(dry);
      src.start(t);
      this.stopFns.push(() => { try { src.stop(); } catch {} });
    } catch {}
  }

  private ghost(ctx: AudioContext, dry: AudioNode, t: number, vol: number): void {
    // A tiny softer "click" — a snare at very low velocity.
    try {
      const bufSize = Math.floor(ctx.sampleRate * 0.05);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.2));
      }
      const src = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      hp.type = "highpass"; hp.frequency.value = 1800;
      gain.gain.setValueAtTime(vol * 0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.buffer = buf;
      src.connect(hp); hp.connect(gain); gain.connect(dry);
      src.start(t);
      this.stopFns.push(() => { try { src.stop(); } catch {} });
    } catch {}
  }

  // ── Main entry: play(version) ─────────────────────────
  play(version: VibeVersion, intensityOverride?: IntensityOverride): void {
    const ctx = this.ensureCtx();
    const dry = this.masterGain ?? ctx.destination;
    const wetSend = this.reverbSend ?? this.masterGain ?? ctx.destination;
    this.stop();

    const song = assembleSong(version);
    const now = ctx.currentTime + 0.06;
    const arr = version.arrangementState;

    // Resolve intensities (override > arrangement)
    const iMel    = intensityOverride?.melody  ?? arr.melody.intensity;
    const iChord  = intensityOverride?.chords  ?? arr.chords.intensity;
    const iStr    = intensityOverride?.strings ?? arr.strings.intensity;
    const iBass   = intensityOverride?.bass    ?? arr.bass.intensity;
    const iDrum   = intensityOverride?.drums   ?? arr.drums.intensity;
    const iTex    = intensityOverride?.texture ?? arr.texture.intensity;

    const melTimbre   = timbreFor(arr.melody.instrument);
    const chordTimbre = timbreFor(arr.chords.instrument);
    const strTimbre   = timbreFor(arr.strings.instrument);
    const bassTimbre  = timbreFor(arr.bass.instrument);
    const texTimbre   = timbreFor(arr.texture.instrument);

    // ── Melody ────────────────────────────────────────────
    if (arr.melody.enabled && iMel > 0.02) {
      for (const n of version.melody.notes) {
        this.noteAt(ctx, dry, wetSend as GainNode, n.pitch, now + n.start, now + n.start + n.duration, n.velocity * iMel, melTimbre);
      }
    }

    // ── Chords (voiced) ───────────────────────────────────
    if (arr.chords.enabled && iChord > 0.02) {
      for (const ev of song.chords) {
        for (const m of ev.midi) {
          this.noteAt(ctx, dry, wetSend as GainNode, m, now + ev.time, now + ev.time + ev.duration * 0.92, 0.55 * iChord, chordTimbre);
        }
      }
    }

    // ── Strings pad (sustained, top voices of each chord) ─
    if (arr.strings.enabled && iStr > 0.04) {
      for (const ev of song.chords) {
        const tops = ev.midi.slice(-3); // top 2-3 notes
        for (const m of tops) {
          this.noteAt(ctx, dry, wetSend as GainNode, m, now + ev.time, now + ev.time + ev.duration * 0.95, 0.45 * iStr, strTimbre);
        }
      }
    }

    // ── Bass (pattern-driven) ────────────────────────────
    if (arr.bass.enabled && iBass > 0.02) {
      for (const b of song.bass) {
        this.noteAt(ctx, dry, wetSend as GainNode, b.pitch, now + b.time, now + b.time + b.duration, b.velocity * iBass, bassTimbre);
      }
    }

    // ── Texture pad — long held root drone for the song length ─
    if (arr.texture.enabled && iTex > 0.04 && song.chords.length > 0) {
      const firstRoot = song.chords[0]!.rootMidi;
      this.noteAt(ctx, dry, wetSend as GainNode, firstRoot - 12, now, now + song.totalDuration, 0.3 * iTex, texTimbre);
    }

    // ── Drums ────────────────────────────────────────────
    if (arr.drums.enabled && iDrum > 0.04) {
      for (const h of song.drums) {
        const v = h.velocity; // already scaled by drum-engine
        const t = now + h.time;
        switch (h.type) {
          case "kick":  this.kick(ctx, dry, t, v); break;
          case "snare": this.snare(ctx, dry, wetSend as GainNode, t, v); break;
          case "hihat": this.hihat(ctx, dry, t, v, false); break;
          case "open":  this.hihat(ctx, dry, t, v, true); break;
          case "ghost": this.ghost(ctx, dry, t, v); break;
        }
      }
    }
  }
}

export const synth = new SimpleSynth();
