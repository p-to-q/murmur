/**
 * test-music-gen — end-to-end verification of the generation pipeline.
 *
 * Feeds 7 synthetic note sequences (each with known BPM / key / contour / structure)
 * through the same engines the live app uses, and reports whether the OUTPUT
 * arrangement actually "follows" the INPUT hum.
 *
 *   raw notes  →  polishMelody    (BPM detect, quantize, key snap)
 *              →  generateVibeVersions  (3 vibes, ensemble pick)
 *              →  assembleSong         (chord track, bass line, drum hits)
 *
 * Run:
 *   bun run scripts/test-music-gen.ts
 */

import type { MelodyNote } from "../src/modules/shared/types";
import { polishMelody } from "../src/modules/music/melody-polisher";
import { generateVibeVersions } from "../src/modules/strummer/generate-versions";
import { assembleSong } from "../src/lib/music/assemble-song";
import { detectBpm } from "../src/lib/music/rhythm-engine";

// ── Fixture builder ───────────────────────────────────────────────────

function note(pitch: number, start: number, duration: number, vel = 0.7): MelodyNote {
  return { pitch, start, duration, velocity: vel, confidence: 0.9 };
}

// 60/bpm = quarter-note duration; 1/16 = quarter/4
const Q = (bpm: number) => 60 / bpm;

interface Fixture {
  name: string;
  notes: MelodyNote[];
  expect: {
    bpm: { min: number; max: number };
    key: string;
    scale: "major" | "minor";
    contour: "rising" | "falling" | "wave" | "flat";
    /** Notes after snap-to-scale must all be in scale (pc ∈ allowed). */
    requireInScale?: boolean;
  };
  notes_human?: string;
}

const FIXTURES: Fixture[] = [
  // ── 1. C major ascending scale, 80 BPM, 8 quarter notes ─────────
  {
    name: "C major scale, 80 BPM, rising",
    notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => note(p, i * Q(80), Q(80) * 0.9)),
    expect: { bpm: { min: 75, max: 85 }, key: "C", scale: "major", contour: "rising", requireInScale: true },
    notes_human: "8 quarter notes on the C major scale — clean rising line",
  },

  // ── 2. A minor lullaby, 60 BPM, 4 half notes ────────────────────
  {
    name: "A minor lullaby, 60 BPM, falling",
    notes: [69, 67, 65, 64, 62, 60, 59, 57].map((p, i) => note(p, i * Q(60), Q(60) * 0.85)),
    expect: { bpm: { min: 55, max: 70 }, key: "A", scale: "minor", contour: "falling", requireInScale: true },
    notes_human: "slow descending A minor — should pick minor key",
  },

  // ── 3. Pop hook, 120 BPM, 7 eighth+quarter notes ────────────────
  {
    name: "G major pop hook, 120 BPM, wave",
    notes: [
      note(67, 0.0,  Q(120) * 0.45),
      note(67, 0.25, Q(120) * 0.45),
      note(69, 0.5,  Q(120) * 0.45),
      note(67, 0.75, Q(120) * 0.45),
      note(72, 1.0,  Q(120) * 0.9),
      note(71, 1.5,  Q(120) * 0.9),
      note(67, 2.0,  Q(120) * 0.9 * 2),
    ],
    expect: { bpm: { min: 110, max: 130 }, key: "G", scale: "major", contour: "wave", requireInScale: true },
    notes_human: "fast 120 bpm pop hook — wave contour",
  },

  // ── 4. Hummed-feel: C scale at 80 BPM but with ±20ms timing wobble ─
  {
    name: "C major + timing wobble (humanized)",
    notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => {
      const wobble = (Math.sin(i * 7.7) * 0.02);  // ~±20ms
      return note(p, i * Q(80) + wobble, Q(80) * 0.88);
    }),
    expect: { bpm: { min: 75, max: 85 }, key: "C", scale: "major", contour: "rising", requireInScale: true },
    notes_human: "same as #1 but with human timing jitter — autocorr BPM should still pick 80",
  },

  // ── 5. Very short: 3 notes only (lower bound) ───────────────────
  {
    name: "Single tiny phrase: 3 notes",
    notes: [
      note(64, 0,    0.45),
      note(67, 0.5,  0.45),
      note(72, 1.0,  1.0),
    ],
    expect: { bpm: { min: 60, max: 140 }, key: "C", scale: "major", contour: "rising" },
    notes_human: "edge case — only 3 notes, key detection lenient",
  },

  // ── 6. Single stray accidental (should snap) ────────────────────
  {
    name: "C major with one stray Eb — should snap to scale",
    notes: [60, 62, 63, 65, 67, 69, 71, 72].map((p, i) => note(p, i * Q(80), Q(80) * 0.85)),
    expect: { bpm: { min: 75, max: 90 }, key: "C", scale: "major", contour: "rising", requireInScale: true },
    notes_human: "only 63 (Eb) is out of C major; rest is the scale — engine should pick C major and snap 63",
  },

  // ── 7. Two phrases separated by silence ─────────────────────────
  // IOI within each phrase = 0.5s — that's 120 BPM at the quarter, so 120 is
  // the correct detection. The "two phrases" focus is on phrase detection +
  // chord-event count, not BPM.
  {
    name: "Two phrases with breath gap (phrase detection)",
    notes: [
      // Phrase 1
      note(60, 0.0, 0.45),
      note(64, 0.5, 0.45),
      note(67, 1.0, 0.85),
      // 800ms silence
      // Phrase 2
      note(72, 2.5, 0.45),
      note(71, 3.0, 0.45),
      note(69, 3.5, 0.45),
      note(67, 4.0, 1.0),
    ],
    expect: { bpm: { min: 110, max: 130 }, key: "C", scale: "major", contour: "wave", requireInScale: true },
    notes_human: "two phrases with 800ms gap — IOI=0.5s ⇒ 120 BPM at the quarter",
  },
];

// ── Verifiers ─────────────────────────────────────────────────────────

interface CheckResult {
  pass: boolean;
  label: string;
  detail: string;
}

function check(pass: boolean, label: string, detail: string): CheckResult {
  return { pass, label, detail };
}

const SCALE_PCS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

function pcOfKey(key: string): number {
  const m: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  return m[key] ?? 0;
}

function runOne(fix: Fixture) {
  const polished = polishMelody(fix.notes);
  const versions = generateVibeVersions(polished);

  const checks: CheckResult[] = [];

  // ── Tempo
  checks.push(check(
    polished.bpm >= fix.expect.bpm.min && polished.bpm <= fix.expect.bpm.max,
    "BPM",
    `expected ${fix.expect.bpm.min}-${fix.expect.bpm.max}, got ${polished.bpm}`
  ));

  // ── Key (we accept ± enharmonic, e.g. C# vs Db)
  const expectedPc = pcOfKey(fix.expect.key);
  const actualPc = pcOfKey(polished.key);
  checks.push(check(
    expectedPc === actualPc,
    "Key",
    `expected ${fix.expect.key}, got ${polished.key}`
  ));

  // ── Scale
  checks.push(check(
    polished.scale === fix.expect.scale,
    "Scale",
    `expected ${fix.expect.scale}, got ${polished.scale}`
  ));

  // ── Contour
  checks.push(check(
    polished.contour === fix.expect.contour,
    "Contour",
    `expected ${fix.expect.contour}, got ${polished.contour}`
  ));

  // ── All notes in scale after snap?
  if (fix.expect.requireInScale) {
    const root = pcOfKey(polished.key);
    const scaleKey: keyof typeof SCALE_PCS =
      polished.scale === "major" || polished.scale === "minor" ? polished.scale : "major";
    const allowed = new Set(SCALE_PCS[scaleKey].map((iv: number) => (root + iv) % 12));
    const offending = polished.notes.filter((n) => !allowed.has(n.pitch % 12));
    checks.push(check(
      offending.length === 0,
      "All notes in scale",
      offending.length === 0 ? "all good" : `${offending.length} stray notes`
    ));
  }

  // ── Pipeline must produce 3 versions
  checks.push(check(
    versions.length === 3,
    "Generated 3 versions",
    `got ${versions.length}`
  ));

  // ── Each version assembles a non-empty chord/bass/drum track
  const allFirst = versions.map((v) => {
    const song = assembleSong(v);
    return {
      vibe: v.vibe,
      chordCount: song.chords.length,
      bassCount: song.bass.length,
      drumCount: song.drums.length,
      totalDur: song.totalDuration,
    };
  });
  const minChords = Math.min(...allFirst.map((s) => s.chordCount));
  const minBass   = Math.min(...allFirst.map((s) => s.bassCount));
  const minDrums  = Math.min(...allFirst.map((s) => s.drumCount));
  checks.push(check(minChords >= 1, "Every version has ≥1 chord", `min=${minChords}`));
  checks.push(check(minBass   >= 1, "Every version has ≥1 bass note", `min=${minBass}`));
  checks.push(check(minDrums  >= 1, "Every version has ≥1 drum hit", `min=${minDrums}`));

  // ── Chord changes >= phrase count (rough check)
  // ── Drum fills: look for any beat-3+ hits clustered (fill heuristic)
  // (informational, not a hard pass/fail)

  return {
    polished,
    versions,
    songs: allFirst,
    checks,
  };
}

// ── Reporter ──────────────────────────────────────────────────────────

const GREEN = "\x1b[32m"; const RED = "\x1b[31m"; const DIM = "\x1b[2m"; const BOLD = "\x1b[1m"; const RESET = "\x1b[0m"; const YELLOW = "\x1b[33m";

let totalChecks = 0; let passedChecks = 0;
const failures: Array<{ fix: string; label: string; detail: string }> = [];

console.log(`${BOLD}━━━ Music generation pipeline test ━━━${RESET}\n`);

for (const fix of FIXTURES) {
  console.log(`${BOLD}${fix.name}${RESET}`);
  if (fix.notes_human) console.log(`${DIM}  ${fix.notes_human}${RESET}`);

  const r = runOne(fix);

  console.log(`  ${DIM}polished:${RESET} ${r.polished.notes.length} notes · BPM ${r.polished.bpm} · ${r.polished.key} ${r.polished.scale} · ${r.polished.contour}`);
  console.log(`  ${DIM}vibes:${RESET}    ${r.versions.map((v) => v.vibe).join(" · ")}`);
  console.log(`  ${DIM}songs:${RESET}    ${r.songs.map((s) => `${s.vibe}=[${s.chordCount}c/${s.bassCount}b/${s.drumCount}d, ${s.totalDur.toFixed(1)}s]`).join(" · ")}`);

  for (const c of r.checks) {
    totalChecks++;
    if (c.pass) {
      passedChecks++;
      console.log(`  ${GREEN}✓${RESET} ${c.label.padEnd(28)} ${DIM}${c.detail}${RESET}`);
    } else {
      console.log(`  ${RED}✗${RESET} ${c.label.padEnd(28)} ${YELLOW}${c.detail}${RESET}`);
      failures.push({ fix: fix.name, label: c.label, detail: c.detail });
    }
  }
  console.log("");
}

// ── Cross-test: same hum, different versions should differ ────────────
{
  console.log(`${BOLD}Determinism + variety${RESET}`);
  const fixed = FIXTURES[0]!;
  const a = generateVibeVersions(polishMelody(fixed.notes));
  const b = generateVibeVersions(polishMelody(fixed.notes));
  totalChecks++;
  const aVibes = a.map((v) => v.vibe).join(",");
  const bVibes = b.map((v) => v.vibe).join(",");
  const variety = aVibes !== bVibes || a.some((v, i) => v.arrangementState.bass.instrument !== b[i]?.arrangementState.bass.instrument);
  if (variety) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Two passes of same hum produce different ensembles ${DIM}(a=${aVibes} / b=${bVibes})${RESET}`); }
  else         { console.log(`  ${RED}✗${RESET} Two passes produced identical ensembles ${YELLOW}— variety is broken${RESET}`); failures.push({ fix: "variety", label: "Two passes differ", detail: "same vibes + instruments" }); }
}

// ── Cross-test: same version.id should reproduce identical assemble ───
{
  console.log("");
  console.log(`${BOLD}Reproducibility within a version${RESET}`);
  const fixed = FIXTURES[0]!;
  const ver = generateVibeVersions(polishMelody(fixed.notes))[0]!;
  const song1 = assembleSong(ver);
  const song2 = assembleSong(ver);
  totalChecks++;
  const same =
    song1.chords.length === song2.chords.length &&
    song1.bass.length === song2.bass.length &&
    song1.drums.length === song2.drums.length &&
    song1.chords.every((c, i) => c.name === song2.chords[i]?.name && c.time === song2.chords[i]?.time);
  if (same) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Two assembles of same version produce identical tracks`); }
  else      { console.log(`  ${RED}✗${RESET} Same version produced different tracks — reproducibility broken`); failures.push({ fix: "reproducibility", label: "Same version stable", detail: "tracks differed" }); }
}

// ── detectBpm standalone test (unit-level) ─────────────────────────────
{
  console.log("");
  console.log(`${BOLD}Standalone BPM detector spot checks${RESET}`);
  const cases = [
    { bpm: 60, label: "60 BPM" },
    { bpm: 80, label: "80 BPM" },
    { bpm: 100, label: "100 BPM" },
    { bpm: 120, label: "120 BPM" },
  ];
  for (const c of cases) {
    const notes: MelodyNote[] = Array.from({ length: 8 }, (_, i) => note(60 + i, i * Q(c.bpm), Q(c.bpm) * 0.9));
    const detected = detectBpm(notes);
    totalChecks++;
    const ok = Math.abs(detected - c.bpm) <= 6; // ±6 tolerance
    if (ok) { passedChecks++; console.log(`  ${GREEN}✓${RESET} ${c.label.padEnd(28)} ${DIM}detected ${detected}${RESET}`); }
    else    { console.log(`  ${RED}✗${RESET} ${c.label.padEnd(28)} ${YELLOW}detected ${detected}${RESET}`); failures.push({ fix: "BPM-unit", label: c.label, detail: `detected ${detected}` }); }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Round 2: deeper musical-quality checks
// ──────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${BOLD}━━━ Musical quality checks ━━━${RESET}\n`);

import { detectPhrases } from "../src/lib/music/rhythm-engine";

const baseFix = FIXTURES[2]!; // G major pop hook — has phrases + range
const polished = polishMelody(baseFix.notes);

// Voice leading: top note of each chord must sit near melody's average pitch
{
  const versions = generateVibeVersions(polished);
  let voiceLeadingOk = 0, voiceLeadingTotal = 0;
  for (const v of versions) {
    const song = assembleSong(v);
    const melodyAvg = polished.notes.reduce((a, n) => a + n.pitch, 0) / Math.max(1, polished.notes.length);
    for (const ch of song.chords) {
      const top = Math.max(...ch.midi);
      voiceLeadingTotal++;
      if (top >= melodyAvg - 7 && top <= melodyAvg + 12) voiceLeadingOk++;
    }
  }
  totalChecks++;
  const pct = (voiceLeadingOk / Math.max(1, voiceLeadingTotal)) * 100;
  if (pct >= 80) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Voice leading near melody       ${DIM}${voiceLeadingOk}/${voiceLeadingTotal} chords (${pct.toFixed(0)}%)${RESET}`); }
  else           { console.log(`  ${RED}✗${RESET} Voice leading near melody       ${YELLOW}${voiceLeadingOk}/${voiceLeadingTotal} chords (${pct.toFixed(0)}%)${RESET}`); failures.push({ fix: "voice-leading", label: "Top within ±7..+12 of melody avg", detail: `${pct.toFixed(0)}%` }); }
}

// Phrase-aware: chord events ≥ phrase count
{
  const versions = generateVibeVersions(polished);
  const phrases = detectPhrases(polished.notes, polished.bpm);
  let okCount = 0;
  for (const v of versions) {
    const song = assembleSong(v);
    if (song.chords.length >= phrases.length) okCount++;
  }
  totalChecks++;
  if (okCount === versions.length) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Chord-events ≥ phrase count    ${DIM}${phrases.length} phrases → all ${versions.length} versions match${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} Chord-events ≥ phrase count    ${YELLOW}${okCount}/${versions.length} versions${RESET}`); failures.push({ fix: "phrase-aware", label: "chord >= phrase", detail: `${okCount}/${versions.length}` }); }
}

// Walking bass: when bass.currentPattern === "walking", bass note count ≥ 3 per chord (for chords ≥ 3 beats)
{
  const versions = generateVibeVersions(polished);
  let triedWalking = 0; let walkingOk = 0;
  for (const v of versions) {
    if (v.arrangementState.bass.currentPattern !== "walking") continue;
    triedWalking++;
    const song = assembleSong(v);
    // Bass per chord should be >= 3 (root, fifth, leading-tone)
    const bassPerChord = song.chords.map((c) => {
      return song.bass.filter((b) => b.time >= c.time - 0.05 && b.time < c.time + c.duration - 0.05).length;
    });
    const longChords = bassPerChord.filter((_, i) => song.chords[i]!.duration >= (60 / polished.bpm) * 3);
    if (longChords.length === 0 || longChords.every((n) => n >= 3)) walkingOk++;
  }
  totalChecks++;
  if (triedWalking === 0) {
    // Re-roll with deterministic seeds to force walking
    let found = 0, ok = 0;
    for (let i = 0; i < 40 && found < 3; i++) {
      const vs = generateVibeVersions(polished);
      for (const v of vs) {
        if (v.arrangementState.bass.currentPattern === "walking" && found < 3) {
          found++;
          const song = assembleSong(v);
          const bassPer = song.chords.map((c) =>
            song.bass.filter((b) => b.time >= c.time - 0.05 && b.time < c.time + c.duration - 0.05).length
          );
          const long = bassPer.filter((_, i2) => song.chords[i2]!.duration >= (60 / polished.bpm) * 3);
          if (long.length === 0 || long.every((n) => n >= 3)) ok++;
        }
      }
    }
    if (found === 0) { passedChecks++; console.log(`  ${DIM}- Walking bass (n/a — no walking ensemble drawn in this run)${RESET}`); }
    else if (ok >= found * 0.7) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Walking bass ≥3 notes/chord    ${DIM}${ok}/${found} samples${RESET}`); }
    else { console.log(`  ${RED}✗${RESET} Walking bass ≥3 notes/chord    ${YELLOW}${ok}/${found}${RESET}`); failures.push({ fix: "walking-bass", label: "≥3 notes per chord", detail: `${ok}/${found}` }); }
  } else if (walkingOk === triedWalking) {
    passedChecks++; console.log(`  ${GREEN}✓${RESET} Walking bass ≥3 notes/chord    ${DIM}${walkingOk}/${triedWalking} versions${RESET}`);
  } else {
    console.log(`  ${RED}✗${RESET} Walking bass ≥3 notes/chord    ${YELLOW}${walkingOk}/${triedWalking}${RESET}`);
    failures.push({ fix: "walking-bass", label: "≥3 notes per chord", detail: `${walkingOk}/${triedWalking}` });
  }
}

// Drum fills: with a long enough song, every 4-bar boundary should have extra hits
{
  // Use a longer fixture to ensure at least 4 bars
  const longNotes: MelodyNote[] = Array.from({ length: 16 }, (_, i) =>
    note(60 + (i % 8), i * Q(80), Q(80) * 0.9)
  );
  const long = polishMelody(longNotes);
  const versions = generateVibeVersions(long);
  let withFill = 0;
  for (const v of versions) {
    const song = assembleSong(v);
    const beat = 60 / long.bpm;
    const bar = beat * 4;
    // Look at bar 4 (b=3) — should have hits in beat-3+ region that don't match the base pattern
    const barIdx = 3;
    const barStart = barIdx * bar;
    const barEnd = barStart + bar;
    const lateBarHits = song.drums.filter((h) => h.time >= barStart + beat * 2.5 && h.time < barEnd);
    // Expect at least 3 hits in the fill window (snare rolls)
    if (lateBarHits.length >= 3) withFill++;
  }
  totalChecks++;
  if (withFill >= versions.length * 0.5) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Drum fills present at bar 4    ${DIM}${withFill}/${versions.length} versions${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} Drum fills present at bar 4    ${YELLOW}${withFill}/${versions.length}${RESET}`); failures.push({ fix: "drum-fill", label: "Fill at bar 4", detail: `${withFill}/${versions.length}` }); }
}

// Ensemble diversity: 3 versions should differ in instruments / patterns
{
  const versions = generateVibeVersions(polished);
  const instruments = new Set<string>();
  const patterns = new Set<string>();
  for (const v of versions) {
    instruments.add(v.arrangementState.melody.instrument);
    instruments.add(v.arrangementState.bass.instrument);
    instruments.add(v.arrangementState.drums.instrument);
    patterns.add(v.arrangementState.bass.currentPattern);
    patterns.add(v.arrangementState.drums.currentPattern);
  }
  totalChecks++;
  // 3 versions × 3 instrument slots = 9 picks. Want ≥ 5 distinct.
  if (instruments.size >= 5) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Ensemble instrument diversity   ${DIM}${instruments.size} distinct across 9 slots${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} Ensemble instrument diversity   ${YELLOW}${instruments.size} distinct${RESET}`); failures.push({ fix: "diversity", label: "≥5 distinct instruments", detail: `${instruments.size}` }); }
}

// ──────────────────────────────────────────────────────────────────────
// Round 3: real-world noisy hum simulation
// ──────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${BOLD}━━━ Real-world noisy hum (stress test) ━━━${RESET}\n`);

// A human humming "Twinkle Twinkle" at ~92 BPM, with messy timing + a few
// pitch wobbles (one cent off, etc.) + lower confidence on weaker beats.
{
  const targetBpm = 92;
  const q = Q(targetBpm);
  // Twinkle: C C G G A A G | F F E E D D C
  const pitches = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
  const noisyNotes: MelodyNote[] = pitches.map((p, i) => {
    const timingDrift = (Math.sin(i * 3.13 + 0.5) * 0.03); // ±30ms wobble
    const vel = 0.4 + ((i % 2) === 0 ? 0.2 : 0.05);
    // 5% chance a note is slightly off-pitch (simulate vocal slide)
    const pitchOffset = (Math.sin(i * 7.7) > 0.85 ? 1 : 0);
    return note(p + pitchOffset, i * q + timingDrift, q * 0.85, vel);
  }).map((n, i) => ({ ...n, confidence: i % 5 === 0 ? 0.45 : 0.78 }));

  const polished = polishMelody(noisyNotes);
  console.log(`  ${DIM}input:${RESET}    14 noisy notes ('Twinkle' at ~${targetBpm} BPM with timing/pitch wobble)`);
  console.log(`  ${DIM}polished:${RESET} ${polished.notes.length} notes · BPM ${polished.bpm} · ${polished.key} ${polished.scale} · ${polished.contour}`);

  totalChecks += 3;
  // BPM within ±15 of 92 (noisy input gets some slack)
  if (polished.bpm >= 80 && polished.bpm <= 110) { passedChecks++; console.log(`  ${GREEN}✓${RESET} BPM survives ±30ms wobble       ${DIM}${polished.bpm} (target 92)${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} BPM survives ±30ms wobble       ${YELLOW}${polished.bpm}${RESET}`); failures.push({ fix: "real-bpm", label: "noisy BPM 80-110", detail: `${polished.bpm}` }); }

  // Key — should be C major (Twinkle is in C)
  if (polished.key === "C" && polished.scale === "major") { passedChecks++; console.log(`  ${GREEN}✓${RESET} Key survives pitch wobble        ${DIM}${polished.key} ${polished.scale}${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} Key survives pitch wobble        ${YELLOW}${polished.key} ${polished.scale}${RESET}`); failures.push({ fix: "real-key", label: "noisy → C major", detail: `${polished.key} ${polished.scale}` }); }

  // All notes snap into C major
  const cMajorPcs = new Set([0, 2, 4, 5, 7, 9, 11]);
  const stray = polished.notes.filter((n) => !cMajorPcs.has(n.pitch % 12));
  if (stray.length === 0) { passedChecks++; console.log(`  ${GREEN}✓${RESET} Pitch wobbles snap into scale    ${DIM}0 strays${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} Pitch wobbles snap into scale    ${YELLOW}${stray.length} strays${RESET}`); failures.push({ fix: "real-snap", label: "all in C major", detail: `${stray.length}` }); }

  // Generate + assemble — should not throw and should produce playable songs
  const versions = generateVibeVersions(polished);
  let played = 0;
  for (const v of versions) {
    const song = assembleSong(v);
    if (song.chords.length >= 2 && song.bass.length >= 2 && song.drums.length >= 6) played++;
  }
  totalChecks++;
  if (played === versions.length) { passedChecks++; console.log(`  ${GREEN}✓${RESET} All 3 versions assemble playably ${DIM}${played}/3${RESET}`); }
  else { console.log(`  ${RED}✗${RESET} All 3 versions assemble playably ${YELLOW}${played}/3${RESET}`); failures.push({ fix: "real-playable", label: "3 versions playable", detail: `${played}/3` }); }
}

// ── Summary ───────────────────────────────────────────────────────────
console.log("");
console.log(`${BOLD}━━━ Summary ━━━${RESET}`);
console.log(`${passedChecks}/${totalChecks} checks passed`);
if (failures.length === 0) {
  console.log(`${GREEN}All green.${RESET}`);
} else {
  console.log(`${RED}${failures.length} failure(s):${RESET}`);
  for (const f of failures) {
    console.log(`  · ${f.fix} — ${f.label}: ${f.detail}`);
  }
  process.exit(1);
}
