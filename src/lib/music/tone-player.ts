"use client";
/**
 * TonePlayer — Tone.js 编曲播放器（iframe / E2B 加固版）
 *
 * 关键设计：
 * 1. startAudioContext() 必须在 onClick 同步帧里调用
 * 2. 每条轨道独立 try/catch，单轨失败不影响其他轨道
 * 3. velocity 必须 0–1，超出范围一律 clamp
 */

import type { ArrangementState, MelodyNote } from "@/modules/shared/types";

type ToneModule = typeof import("tone");
type ToneTransport = ReturnType<ToneModule["getTransport"]>;
let toneCache: ToneModule | null = null;

// 是否已经成功解锁过 AudioContext
let _audioUnlocked = false;

async function getTone(): Promise<ToneModule> {
  if (!toneCache) toneCache = await import("tone");
  return toneCache;
}

function getToneTransport(Tone: ToneModule): ToneTransport {
  const candidate = Tone as ToneModule & {
    getTransport?: unknown;
    Transport?: ToneTransport;
    default?: {
      getTransport?: unknown;
      Transport?: ToneTransport;
    };
  };

  if (typeof candidate.getTransport === "function") {
    return candidate.getTransport();
  }
  if (candidate.Transport) {
    return candidate.Transport;
  }

  const defaultExport = candidate.default;
  if (defaultExport && typeof defaultExport.getTransport === "function") {
    return defaultExport.getTransport();
  }
  if (defaultExport?.Transport) {
    return defaultExport.Transport;
  }

  throw new Error("Tone transport is unavailable");
}

/**
 * 解锁 AudioContext。
 *
 * 浏览器策略：AudioContext.resume() 必须在用户手势的"第一层"调用栈内被触发。
 * onClick 绑定 async 函数时，第一个 await 之后就脱离了手势帧。
 *
 * 解法：
 * - 用原生 AudioContext 在同步代码里创建并立即 resume（这是允许的）
 * - 把这个已经 running 的 ctx 存起来，在 getTone() 里注入给 Tone.js
 * - Tone.start() 在异步帧里再调一次作为兜底
 *
 * 调用方式（onClick 内第一行，不要 await）：
 *   startAudioContext();
 */

// 提前创建好的 AudioContext（在用户手势帧里）
let _gestureCtx: AudioContext | null = null;

export function startAudioContext(): void {
  try {
    if (_audioUnlocked) return; // 已解锁，不重复操作

    if (toneCache) {
      // Tone 已加载，直接 resume
      const raw = toneCache.getContext().rawContext as AudioContext;
      if (raw.state === "suspended") {
        raw.resume().then(() => { _audioUnlocked = true; }).catch(() => {});
      } else if (raw.state === "running") {
        _audioUnlocked = true;
      }
    } else {
      // Tone 未加载，提前创建原生 ctx（在手势帧里这是被允许的）
      if (!_gestureCtx) {
        _gestureCtx = new AudioContext();
      }
      if (_gestureCtx.state === "suspended") {
        _gestureCtx.resume().then(() => { _audioUnlocked = true; }).catch(() => {});
      } else if (_gestureCtx.state === "running") {
        _audioUnlocked = true;
      }
    }
  } catch (audioError) {
    console.warn("[tone-player] audio unlock failed (non-fatal):", audioError);
  }
}

// ── 乐器构建（覆盖所有 instrument 字符串）────────────────────────────────────
function buildSynth(Tone: ToneModule, instrument: string): import("tone").ToneAudioNode {
  switch (instrument) {
    case "soft_lead":
    case "warm_keys":
    case "piano":
    case "soft_piano":
    case "melody_lead":
    case "soft_kit":
    case "dance_kit":
      return new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.8 },
      }).toDestination();

    case "strings":
    case "soft_pad":
    case "synth_pad":
    case "air":
      return new Tone.Synth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.4, decay: 0.6, sustain: 0.7, release: 2.5 },
      }).chain(new Tone.Reverb(2).toDestination());

    case "guitar":
    case "acoustic_guitar":
      return new Tone.PluckSynth().toDestination();

    case "synth_lead":
    case "synth_wave":
      return new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.5 },
      }).toDestination();

    case "root_bass":
    case "synth_bass":
    case "bass":
      return new Tone.Synth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.5 },
      }).chain(new Tone.Filter(400, "lowpass").toDestination());

    default:
      return new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 1 },
      }).toDestination();
  }
}

function midiNote(midi: number): string {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return `${names[midi % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

function isLegatoNeighbor(notes: MelodyNote[], index: number): boolean {
  const note = notes[index]!;
  const next = notes[index + 1];
  if (!next) return false;

  const gap = next.start - (note.start + note.duration);
  return gap <= 0.07 && Math.abs(next.pitch - note.pitch) <= 2;
}

function chordMidi(chord: string): number[] {
  const roots: Record<string, number> = {
    C:60,"C#":61,Db:61,D:62,"D#":63,Eb:63,E:64,F:65,"F#":66,Gb:66,G:67,"G#":68,Ab:68,A:69,"A#":70,Bb:70,B:71,
  };
  const root = roots[chord.match(/^([A-G][b#]?)/)?.[1] ?? "C"] ?? 60;
  const q = chord.replace(/^([A-G][b#]?)/, "");
  if (q.includes("m7")) return [root, root+3, root+7, root+10];
  if (q.includes("maj7")) return [root, root+4, root+7, root+11];
  if (q.startsWith("m")) return [root, root+3, root+7];
  if (q.includes("7")) return [root, root+4, root+7, root+10];
  if (q.includes("sus4")) return [root, root+5, root+7];
  return [root, root+4, root+7];
}

// ── TonePlayer ──────────────────────────────────────────────────────────────

export class TonePlayer {
  private parts: import("tone").Part[] = [];
  private synths: import("tone").ToneAudioNode[] = [];
  private _Tone: ToneModule | null = null;

  async play(
    melodyNotes: MelodyNote[],
    arrangement: ArrangementState,
    chords: string[],
    bpm: number,
  ): Promise<void> {
    await this.stop();
    const Tone = await getTone();
    this._Tone = Tone;

    // 如果提前创建了原生 ctx，把它交给 Tone
    if (_gestureCtx) {
      try {
        if ((Tone.getContext().rawContext as AudioContext).state === "suspended") {
          Tone.setContext(_gestureCtx);
        }
      } catch { /* ignore */ }
      _gestureCtx = null;
    }

    // 再次尝试 resume（async 帧里也无妨，ctx 大概率已经 running）
    try {
      await Tone.start();
      _audioUnlocked = true;
    } catch { /* continue */ }

    const transport = getToneTransport(Tone);
    transport.bpm.value = Math.max(40, Math.min(200, bpm));
    transport.cancel();

    // ── Melody ──────────────────────────────────────────────────────
    if (arrangement.melody.enabled && melodyNotes.length > 0) {
      try {
        const synth = buildSynth(Tone, arrangement.melody.instrument);
        if ("portamento" in synth) {
          (synth as import("tone").Synth).portamento = 0.035;
        }
        const gain = new Tone.Gain(Math.min(1, arrangement.melody.intensity)).toDestination();
        synth.disconnect(); synth.connect(gain);
        this.synths.push(synth, gain);

        const part = new Tone.Part(
          (t: number, note: MelodyNote & { legatoNeighbor?: boolean }) => {
            const vel = Math.max(0.01, Math.min(1, note.velocity));
            const releaseTrim = note.legatoNeighbor ? 0.01 : 0.04;
            const dur = Math.max(0.05, note.duration - releaseTrim);
            (synth as import("tone").Synth).triggerAttackRelease(midiNote(note.pitch), dur, t, vel);
          },
          melodyNotes.map((n, index) => ({
            time: n.start,
            ...n,
            legatoNeighbor: isLegatoNeighbor(melodyNotes, index),
          }))
        );
        part.start(0);
        this.parts.push(part);
      } catch (e) { console.warn("[TonePlayer] melody track error:", e); }
    }

    // ── Chords ──────────────────────────────────────────────────────
    const validChords = chords.filter(Boolean);
    if (arrangement.chords.enabled && validChords.length > 0) {
      try {
        const synth = buildSynth(Tone, arrangement.chords.instrument);
        const gain = new Tone.Gain(arrangement.chords.intensity * 0.4).toDestination();
        synth.disconnect(); synth.connect(gain);
        this.synths.push(synth, gain);

        const events = validChords.flatMap((ch, i) =>
          chordMidi(ch).map((midi) => ({ time: i * 2, midi }))
        );
        const part = new Tone.Part(
          (t: number, ev: { midi: number }) => {
            (synth as import("tone").Synth).triggerAttackRelease(midiNote(ev.midi - 12), "2n", t, 0.4);
          }, events
        );
        part.loop = true;
        part.loopEnd = validChords.length * 2;
        part.start(0);
        this.parts.push(part);
      } catch (e) { console.warn("[TonePlayer] chords track error:", e); }
    }

    // ── Bass ─────────────────────────────────────────────────────────
    if (arrangement.bass.enabled && validChords.length > 0) {
      try {
        const synth = buildSynth(Tone, arrangement.bass.instrument);
        const gain = new Tone.Gain(arrangement.bass.intensity * 0.5).toDestination();
        synth.disconnect(); synth.connect(gain);
        this.synths.push(synth, gain);

        const events = validChords.map((ch, i) => ({
          time: i * 2,
          midi: (chordMidi(ch)[0] ?? 60) - 24,
        }));
        const part = new Tone.Part(
          (t: number, ev: { midi: number }) => {
            (synth as import("tone").Synth).triggerAttackRelease(midiNote(ev.midi), "2n.", t, 0.65);
          }, events
        );
        part.loop = true;
        part.loopEnd = validChords.length * 2;
        part.start(0);
        this.parts.push(part);
      } catch (e) { console.warn("[TonePlayer] bass track error:", e); }
    }

    // ── Drums ────────────────────────────────────────────────────────
    if (arrangement.drums.enabled && arrangement.drums.intensity > 0.05) {
      try {
        const synth = new Tone.MembraneSynth({
          pitchDecay: 0.05, octaves: 4,
          envelope: { attack: 0.02, decay: 0.5, sustain: 0, release: 0.3 },
        }).toDestination();
        const gain = new Tone.Gain(arrangement.drums.intensity * 0.6).toDestination();
        synth.disconnect(); synth.connect(gain);
        this.synths.push(synth, gain);

        const pattern = [
          { time: "0:0", pitch: 60 }, { time: "0:2", pitch: 55 },
          { time: "1:0", pitch: 60 }, { time: "1:2", pitch: 55 },
        ];
        const part = new Tone.Part(
          (t: number, ev: { pitch: number }) => {
            synth.triggerAttackRelease(midiNote(ev.pitch), "8n", t, 0.8);
          }, pattern
        );
        part.loop = true;
        part.loopEnd = "2m";
        part.start(0);
        this.parts.push(part);
      } catch (e) { console.warn("[TonePlayer] drums track error:", e); }
    }

    transport.start();
  }

  async stop(): Promise<void> {
    if (this._Tone) {
      try { getToneTransport(this._Tone).stop(); } catch { }
      try { getToneTransport(this._Tone).cancel(); } catch { }
    }
    this.parts.forEach((p) => { try { p.dispose(); } catch { } });
    this.synths.forEach((s) => { try { s.dispose(); } catch { } });
    this.parts = [];
    this.synths = [];
  }

  dispose() { this.stop(); }
}

let _player: TonePlayer | null = null;
export function getPlayer(): TonePlayer {
  if (!_player) _player = new TonePlayer();
  return _player;
}
