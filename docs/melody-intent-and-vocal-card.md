# Melody Intent and Vocal-Card Repair

Murmur should borrow the useful parts of light vocal-card / Auto-Tune systems
without becoming a real-time vocal effects rack. The product problem is still
hum-to-song: preserve the user's melodic idea, then make it accurate and
pleasant enough for arrangement.

## Product Contract

The audio path now has an explicit intent layer:

```text
raw audio
  -> trim / input diagnostics / optional denoise
  -> frame contour + raw notes
  -> melody intent profile
  -> intent / corrected / musical melodies
  -> generation melody choice
  -> phrase-aware chords and arrangement
```

`MelodyIntentProfile` is deliberately lighter than a learned model today. It
captures:

- the closest user-intent skeleton;
- ranked key / scale candidates before the final lock;
- stable anchor pitches and phrase-ending pitches;
- an intent confidence score;
- a correction policy inspired by vocal-card controls.

The first implementation lives in
`src/modules/music/humming-engine.ts` and is returned on
`TranscriptionResult.melodyIntent`.

## Borrowed Algorithm Ideas

These projects are useful references, but they should not all become runtime
dependencies.

| Reference | Useful idea | First Murmur use |
| --- | --- | --- |
| [Autotalent](https://github.com/michaeldonovan/AutoTalent) | scale-constrained pitch correction, correction strength, retune speed, vibrato tolerance | borrow parameter model |
| [x42-autotune / zita-at1](https://x42-plugins.com/x42/x42-autotune) | restrained monophonic pitch correction around a known scale, especially small vocal errors without formant correction | borrow conservative correction behavior |
| [aubio](https://github.com/aubio/aubio) | pitch, onset, beat, and note-boundary utilities | evaluate for onset evidence only if current contour heuristics stall |
| [librosa pYIN](https://librosa.org/doc/latest/generated/librosa.pyin.html) | probabilistic F0, voicing, and frame-level confidence | keep as a contour/reference baseline, especially for lab comparisons |
| [Rubber Band](https://breakfastquay.com/rubberband/) | high-quality pitch/time stretching | later export/offline audio polish, not hum-intent critical path |
| [SoundTouch](https://www.surina.net/soundtouch/) | lighter tempo/pitch/playback-rate shifting | later lightweight export experiment |
| [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) | modern lightweight time/pitch DSP | later C++/native shell experiment |
| [WORLD](https://github.com/mmorise/World) | F0 + spectral envelope + aperiodicity for voice manipulation | research/reference only until melody confidence is solved |

The first stage should avoid adding a DSP dependency. Murmur already has
RMVPE / SwiftF0 / pYIN contour data and enough TypeScript-side melody logic to
make the intent layer explainable and testable.

## Dependency Risk

Treat GPL-family projects as references unless the product deliberately accepts
their distribution constraints:

- Autotalent is GPL-2.0 in common maintained ports, so use it as a parameter
  and interaction reference rather than copying runtime code.
- x42-autotune / fat1.lv2 is GPL-2.0 and inherits the zita-at1 design, so keep
  it on the reference side of the boundary.
- aubio is GPL-3.0-or-later. Its onset/pitch concepts are useful, but direct
  linking would need a conscious licensing decision.
- Rubber Band is GPL for open-source use with commercial licensing available,
  making it more plausible for an offline/export stage than the default hum
  path.
- SoundTouch is LGPL-2.1 with commercial options. It is lighter than Rubber
  Band, but still needs packaging and replacement-linking review before product
  integration.
- Signalsmith Stretch is MIT and is the friendliest lightweight time / pitch
  candidate if Murmur later needs a real DSP dependency.
- WORLD is modified BSD and patent-cleared by its upstream README, but it is a
  voice-analysis / resynthesis toolkit rather than the first melody-intent
  problem to solve.

## Correction Policy

The current policy fields are intentionally close to vocal-card language:

- `allowedPitchClasses`: scale notes the melody may snap toward;
- `correctionStrength`: how strongly unstable notes move toward scale tones;
- `retuneSpeed`: how quickly a pitch should be treated as corrected;
- `timingQuantize`: how strongly unstable onsets move toward the rhythmic grid;
- `vibratoTolerance`: how much wobble is treated as expression instead of error;
- `formantPolicy`: currently `preserve`, because Murmur is correcting melody
  symbols, not resynthesizing the user's voice.

This is product-facing scaffolding, not a promise that every field already
drives audio DSP. The important boundary is that the correction policy is
computed from melody intent before `corrected` and `musical` are selected for
generation.

## Key / Scale Timing

Key and scale should be estimated twice:

1. **Early estimate:** rank tonal candidates from the intent skeleton and raw
   note anchors. This happens before heavy musical repair so weak singing does
   not erase the user's contour.
2. **Late lock:** prefer the polished melody's key / scale when it agrees with
   the candidate set, otherwise use the strongest candidate as evidence that
   the generated melody should lean more musical.

This prevents two bad extremes: locking too early to noisy input, or polishing
so aggressively that the original tonal intent disappears.

## Chords Follow Melody

Chords should follow the selected generation melody, not the raw detector trace.
That means:

- `intent` arrangements stay close to the user's contour;
- `corrected` arrangements use the naturally tuned reading;
- `musical` arrangements use the prettier repaired reading;
- chord voicing may still reference the intent skeleton later to avoid moving
  accompaniment into a register that masks the hummed line.

This keeps the sound-card metaphor in the right place: pitch and timing are
corrected around the user's line, then harmony supports that line.

## Next Engineering Steps

1. Show `melodyIntent` in MeLo Lab beside raw / intent / corrected / musical.
2. Add note-level repair reasons for the strongest changed notes.
3. Show the computed correction policy values in the lab view before exposing
   any front-door control.
4. Add an offline comparison note for Autotalent / x42 / aubio before taking
   any dependency.
