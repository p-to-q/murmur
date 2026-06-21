# Music Engine

How a hum becomes a finished little song. Five engines in series, one
assembler, two players.

```
RAW BLOB (mic / fixture)
  ↓ stainer/transcribe
RawNote[]              (pitch + start + duration + velocity + confidence)
  ↓ melody-intent profile
IntentSkeleton         (tonal candidates + anchors + correction policy)
  ↓ melody-polisher
CleanMelody            (denoised + pitch-corrected notes + key + scale + bpm + duration + contour)
  ↓ generate-versions
VibeVersion × 3        (preset + ensemble + arrangementState)
  ↓ assemble-song
AssembledSong          (chords + bass + drums + bpm + totalDuration)
  ↓ SimpleSynth.play()         ←─ live preview
  ↓ render-mp3.renderAudio()   ←─ saved MP3 / WAV
```

Both players consume the same `AssembledSong`, so the live audition on a
card and the saved MP3 sound identical.

## 0. melody-intent profile — `src/modules/music/humming-engine.ts`

Before Murmur decides whether to use the `intent`, `corrected`, or `musical`
melody, it builds a lightweight intent profile from raw notes, contour
diagnostics, and the corrected melody.

The profile records:

- ranked key / scale candidates;
- the locked tonal reading used for correction policy;
- related-key pitch-class support used by corrected / musical snapping;
- stable anchor pitches and phrase endings;
- the rhythmic / pitch trace that the musical layer must still step on after
  stronger repair;
- an intent confidence score;
- vocal-card style repair knobs such as allowed pitch classes, correction
  strength, retune speed, timing quantize, and vibrato tolerance.

The `musical` melody may smooth weak takes into a more finished line, but it is
not a free rewrite. Selection now treats `musical` as an identity-preserving
songlike candidate:

- it can beat an ordinary `corrected` melody when it clearly improves musical
  feel, timing, awkward leaps, or cadence;
- it must still track the user's hum identity through relative contour, rhythm
  contour, interval motion, range, and structural notes such as strong beats,
  long holds, and repeated motives;
- a prettier candidate that fails this identity check stays secondary, so the
  arrangement still feels like the user's sketch rather than an arbitrary tune.

This is the first implementation of the melody-intent model direction described
in [humming-engine-v2.md](humming-engine-v2.md). It borrows the parameter shape
of light Auto-Tune / vocal-card systems without adding a real-time DSP
dependency to the main hum path. See
[melody-intent-and-vocal-card.md](melody-intent-and-vocal-card.md) for the
selection rationale.

## 1. melody-polisher — `src/modules/music/melody-polisher.ts`

Before rhythm/chords do anything, Murmur now treats the detected pitches as
raw material rather than sacred truth:

- **Noise suppression** — drops ultra-short, low-confidence pitch bursts and
  removes isolated outliers far from the local melodic center.
- **Pitch drift correction** — merges adjacent near-unison notes, smooths
  local contour wobble, and corrects pitch toward nearby stable degrees
  without flattening expressive motion.
- **Tonal inference** — estimates the best-fit key/mode across major, minor,
  dorian, phrygian, and pentatonic profiles.
- **Musical normalization** — if the detected line looks ambiguously minor
  but strongly supports a brighter tonic/third relation, the line can be
  promoted toward a major reading.
- **Cadence stabilization** — end-of-phrase notes are nudged toward tonic /
  third / fifth targets so the melody resolves like a song phrase, not a
  detector trace.

This layer is intentionally opinionated: a hummed sketch is allowed to stay a
little human and imperfect, but it should not produce musically awkward or
accidentally atonal lead lines downstream.

The later melody-intent layer keeps the ranked tonal distribution around for
related-key correction. Following the MIREX-style key-error taxonomy used by
Korzeniowski/Widmer (correct, fifth, relative major/minor, parallel
major/minor, other), nearby tonal candidates contribute soft pitch-class and
cadence support before notes are snapped. Cadence support is tracked separately
from broad scale membership, so related-key evidence can preserve a plausible
relative-minor ending without treating every shared pitch class as a final
resolution. This helps a hum that is really sitting in a relative minor / major
or fifth relation avoid being made worse by one brittle global-key guess.

## 2. rhythm-engine — `src/lib/music/rhythm-engine.ts`

Replaces the old "median-interval × 60" BPM heuristic.

- **`detectBpm(notes)`** — autocorrelation over candidate BPMs 60–140 (step 2).
  For each candidate, sums the squared distance from every onset to the
  nearest 16th-note grid position. Lowest cost wins. Mild penalty above 120
  because human hums rarely go faster.

- **`quantize(notes, bpm, { grid, softness })`** — 16th-note grid by default,
  soft snap (`softness=0.25`): notes within 25% of a grid cell get half-pulled
  rather than slammed, so phrases keep a touch of human feel.

- **`detectPhrases(notes, bpm)`** — finds breath points where a phrase ends:
  either a gap ≥ one quarter-note OR a long anchor note followed by a step
  down. Returns `Phrase[]` with start/end/notes/anchor — used by the chord
  engine to time chord changes against the melody's breathing.

## 3. chord-engine — `src/lib/music/chord-engine.ts`

Replaces the old 4-tone-per-vibe fixed table.

- **2–3 candidate progressions per vibe × scale** (12 total banks). The seed
  (`version.id` hashed via FNV-1a) picks one deterministically — so the same
  hum yields the same progression on reload, but a different version of the
  same hum chooses differently.

- **Voice leading** — `voicedChordMidi(rootMidi, intervals, melodyTarget)`
  computes the chord's top note for every octave and picks the octave whose
  top sits closest to the melody's local average. Stops the chord from
  shouting over the hum.

- **Phrase-distributed timing** — each phrase gets ONE chord (or, if the
  phrase is > 4 beats, subdivides into ~4-beat slots). Chord changes happen
  where the melody breathes, not on a fixed clock.

## 4. bass-engine — `src/lib/music/bass-engine.ts`

Four pattern styles, each picked per-vibe by the ensemble layer:

| Pattern         | Description                                    | Where used                |
|-----------------|------------------------------------------------|---------------------------|
| `root_sustain`  | One long root note per chord                   | bedroom, rain (calm)      |
| `walking`       | root → 5th → leading-tone → next root          | sunset, cinematic         |
| `arpeggio`      | 8th-note up-arp through 1/5/8/3                | party, synth (motion)     |
| `sidechain`     | Quarter pulse, ducked on 2 & 4                 | electronic feels          |

Output is `BassNote[]` with absolute times. The synth + the offline renderer
consume the same array.

## 5. drum-engine — `src/lib/music/drum-engine.ts`

- Base patterns: `soft`, `swing`, `four_on_floor`, `four_hi`, `sparse`,
  `slow`, `halftime`. Each is a bar-relative list of (beat, voice, velocity).
- **Fills** — every 4 bars OR just before a phrase boundary, a fill from
  `FILL_LIBRARY` overlays beats 2.5–4 of the bar. Seeded random picks which.
- **Intensity ramp** — gentle 0.85 → 1.0 ramp across the song so it feels
  like it's moving toward something.
- **Ghost notes** — quiet snare/perc fills under the main pattern for the
  lo-fi "alive" feel.
- **Humanization** — non-kick hits get ±10ms jitter so the beat doesn't sound
  quantized to death.

Output is `DrumHit[]` — `{ time, type, velocity }`. The synth + renderer map
`type` to their respective drum voices.

## 6. assemble-song — `src/lib/music/assemble-song.ts`

The single function both players call.

```ts
assembleSong(version) → {
  bpm, totalDuration, chords, bass, drums, vibeId
}
```

Reads `version.melody`, `version.arrangementState`, `version.id` and produces
ready-to-play event lists. Live preview and offline render are now guaranteed
to be byte-equivalent.

## 7. SimpleSynth v3 — `src/lib/music/simple-synth.ts`

Live preview engine. Pure Web Audio, zero deps.

- **Multi-oscillator detuned voices** — pad/chord/string sounds layer a
  primary oscillator with two detuned partners and optionally a sub-octave
  sine. Makes "one oscillator + ADSR" stop sounding like a kids toy.
- **Filter envelope** — instruments with `filterPeak/filterFloor` get a
  lowpass that sweeps from peak → floor during the attack, giving the bite
  that flat ADSR can't.
- **Programmatic reverb** — a single `ConvolverNode` on a shared bus, fed by
  a synthesized noise IR (~1.8s exponential decay). No asset, ~6KB code,
  unlocks the perceived "produced" quality.
- **Drum voices** — kick (pitched membrane sweep), snare (filtered noise +
  band-pass), hi-hat (high-pass noise, closed/open variants), ghost
  (tiny high-pass click). Velocity always honored.

New API: `synth.play(version, intensityOverride?)`.

## 8. render-mp3 v2 — `src/modules/export/render-mp3.ts`

Offline render with the same arrangement plus Tone.js-grade effects.

- **`Tone.Offline`** schedules every event in a sealed `OfflineAudioContext`.
- Master chain: light compressor (ratio 2.4, threshold -22) → reverb (1.8s,
  wet 0.25).
- All synth voices mirror SimpleSynth's choices so playback and saved MP3
  are perceptually identical.
- Encoded to 128kbps mono MP3 via `@breezystack/lamejs`; WAV fallback;
  audio-skip fallback (song still saves, just no `mp3DataUrl`).

## 9. Ensemble variation — `src/modules/strummer/generate-versions.ts`

Each vibe now has **2 ensembles** (instrument set + bass pattern + drum
pattern + intensity recipe). Seed picks one per version. Combined with the
2–3 chord progressions per vibe, the same hum can produce ~6 distinct
arrangements per vibe instead of the same template every time.

## Bundle cost

Net added: ~10 KB of source code, **0** new npm deps. lamejs (50 KB) was
added in the prior change; everything in this pass is pure TypeScript.

## Determinism guarantees

Given the same `(melody, vibeId, version.id)`:
- Chord progression is identical (seeded pick).
- Bass walk / drum fills are identical (drum-engine uses `seed + ":drums"`).
- The MP3 is byte-equivalent to the live preview.

Re-rolling a version (new `crypto.randomUUID()`) reseeds everything, so the
user gets genuinely different takes on the same hum.
