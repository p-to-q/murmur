# Murmur Audio Architecture Loop

Last updated: 2026-06-05

This is the architecture-level control document for Murmur's audio system.
It is meant to keep product intent, engineering boundaries, fallback strategy,
and local acceptance in one place.

## 1. System goal

Murmur's audio stack is not trying to be a general music-AI platform.
It exists to make one user promise hold up consistently:

1. the result still feels like the melody the user sang;
2. the result sounds musical enough to keep listening to.

Everything below should be judged against those two outcomes.

## 2. End-to-end architecture

```mermaid
flowchart LR
    capture["Capture\nbrowser / app"] --> gate["Input quality gate"]
    gate --> route["/api/transcribe"]
    route --> worker["Audio worker"]
    worker --> denoise["Optional denoise"]
    denoise --> pitch["Pitch detector\nRMVPE / SwiftF0 / pYIN fallback"]
    pitch --> contour["Contour + raw notes"]
    contour --> engine["Humming engine\nintent / corrected / musical"]
    engine --> arrange["Arrange / render"]
    arrange --> save["Save / gallery / reopen"]
```

## 3. Architectural layers

### 3.1 Capture layer

Responsibilities:

- record audio reliably;
- enforce duration and payload limits;
- surface only simple front-door guidance.

Should eventually expose:

- level awareness;
- clipping awareness;
- "too quiet" and "too noisy" hints.

### 3.2 Server route layer

Current boundary:

- [src/app/api/transcribe/route.ts](../src/app/api/transcribe/route.ts)

Responsibilities:

- request validation;
- billing / dev fallback;
- stable API contract for the app;
- structured error mapping.

### 3.3 Worker layer

Current boundary:

- [workers/audio-engine/main.py](../workers/audio-engine/main.py)

Responsibilities:

- decode and normalize audio;
- trim silence;
- optional denoise;
- detector selection and fallback;
- when a configured detector path still looks musically weak, rerun with
  repair-oriented segmentation and compare against the alternate provider
  instead of treating the first detector answer as final;
- contour + raw note extraction;
- onset-aware note segmentation with light hysteresis, so first-note noise and
  single-frame pitch blips do not become committed notes too early;
- internal note-hypothesis comparison (`balanced` / `agile` / `steady`) so the
  worker can choose the least awkward segmentation instead of trusting one
  slicing pass;
- repair-side timing redistribution for overheld interior notes, so "one middle
  note dragged too long" can be reshaped before the app layer ever sees it;
- stable-pitch voicing-gap healing, so noisy first notes are not discarded just
  because the detector briefly flips `voiced=false` while pitch remains stable;
- urgent-phrase coherence scoring, so short but rhythmically tidy phrases are
  not treated as automatically less musical just because they are dense;
- low-level diagnostics.

### 3.4 Musical decision layer

Current boundary:

- [src/modules/music/humming-engine.ts](../src/modules/music/humming-engine.ts)

Responsibilities:

- preserve melodic intent;
- choose between `intent`, `corrected`, and `musical`;
- use note-level and contour-level evidence, not just one final note list.
- when acceptance is weak, run a stronger repair pass that tightens overheld
  interior notes, nudges ambiguous durations toward cleaner rhythmic buckets,
  and only then decides whether the repaired melody should replace the first
  musical reading.

### 3.5 Arrangement / render layer

Responsibilities:

- keep downstream rendering controllable;
- make "good sounding" come from arrangement taste and sound sources, not only
  from rewriting the melody.

## 4. Fallback matrix

| Failure / condition | Primary path | Fallback |
|---|---|---|
| RMVPE unavailable in `auto` | `rmvpe` | `swiftf0`, then `pyin` |
| RMVPE returns weak/no notes in `auto` | `rmvpe` | compare against `swiftf0` / `pyin` candidates |
| SwiftF0 unavailable in `auto` | `swiftf0` | `pyin` |
| SwiftF0 returns no notes in `auto` | `swiftf0` | retry with `pyin` |
| Billing unavailable in local dev | ledger | dev billing bypass |
| Denoise unavailable | configured denoise | continue with provider warnings |
| Worker missing entirely | `/api/transcribe` | user-facing setup / retry copy, not silent fixture |
| Main-path complexity too high | expose nothing extra | keep advanced control in `Me!`, `Gallery`, saved-song surfaces |

## 4.1 Latency boundary

Not every slow path should be optimized the same way.

Murmur now treats slow audio paths as two architecture-level families:

1. `quality_tail`
   where `auto` ends up selecting `pYIN`, and the extra time is still buying a
   better melody answer.
2. `engineering_tail`
   where `auto` still ends up selecting a lighter fallback such as `SwiftF0`,
   so most of the delay is alternate-review overhead rather than the final
   musical decision.

Current enforced stance:

- `HumTrans` case `wav_data_sync_with_midi/F01_0191_0001_2_D` is a
  `quality_tail` boundary. The local closure loop shows `auto` picking
  `pyin/steady`, with only about `200 ms` of extra wall time beyond direct
  `pYIN`. Do not cut that path unless the same melody result survives.
- `vocadito` tails such as `vocadito_37`, `vocadito_39`, and `vocadito_33`
  are `engineering_tail` examples. Those are the right places to shrink
  alternate-review breadth while keeping the winning detector choice stable.

This distinction is part of the architecture, not just a temporary report note.
It exists to stop latency work from silently damaging the "this is still what I
sang" promise.

## 5. Current observability contract

The worker now returns enough data to make real decisions later:

- `rawNotes`
- `contour.timestamps`
- `contour.pitchHz`
- `contour.confidence`
- `contour.voiced`
- diagnostics including:
  - `snr`
  - `voicedRatio`
  - `rmsDbfs`
  - `peakDbfs`
  - `clippingRatio`

This is important because it means Murmur can reason about:

- noisy takes;
- quiet takes;
- clipped takes;
- unstable contour regions;
- phrase continuity.

It also means the worker can now emit acceptance-facing evidence such as:

- `acceptanceScore`
- `musicFeelScore`
- `excessiveHoldRatio`
- `onsetFragmentation`
- `firstOnsetLag`
- `noteHypothesis`
- `detailPreservingRerank`

That last field matters because Murmur can now say, in a concrete and
test-visible way, when it decided that a flatter `steady` reading was too
coarse and a more detailed glide / balanced interpretation better preserved the
real sung line.

## 6. Local self-acceptance loop

The audio system should be testable on one machine without user-provided data.

### 6.1 Focused app / worker tests

Run:

```bash
bun test src/lib/platform/audio-worker.test.ts src/modules/music/humming-engine.test.ts src/app/api/transcribe/route.test.ts
cd workers/audio-engine && ./.venv/bin/python -m unittest tests.test_detectors tests_full.test_pipeline tests_full.test_audio_audit
```

### 6.2 Synthetic audio audit

Run:

```bash
bun run audit:audio
bun run audit:audio:compare
bun run audit:audio:gate
```

This uses:

- clean scale
- noisy scale
- quiet scale
- clipped scale
- rushed phrase
- two_tigers_phrase
- brightest_star_hook
- overheld_middle_phrase
- pitch_weak_stable_phrase
- urgent_hook_fragment

and reports:

- detected note count
- expected pitch sketch
- pitch match score
- music-feel score
- whether worker-side repair was triggered
- whether the configured provider was rerouted
- excessive-hold and onset-fragmentation indicators inside the feel score
- provider
- warnings
- diagnostics
- pass / warn / fail summary

The compare mode runs:

- `auto`
- `rmvpe`
- `swiftf0`
- `pyin`

side by side, so fallback quality can be reviewed instead of assumed.
The audit now follows the worker's real note-hypothesis selection path instead
of a parallel simplified segmentation path. Product fallback is reviewed through
`auto`; explicit provider runs stay on the requested detector so the comparison
shows each detector's own contour and repair behavior.
When the worker emits selected-candidate acceptance diagnostics, the audit now
prefers those values over a second approximate scorer, so closure artifacts
describe the same melody judgment path the shipped system actually used.
The gate mode compares the current output against the checked-in baseline at
`workers/audio-engine/tools/audio_audit_expectations.json` and exits non-zero
when the shipped path regresses.
When a manifest is supplied, the audit also groups results by dataset `family`
and `tags`, so real humming, monophonic singing, and synthetic stress cases can
be judged on their own bars instead of collapsing into one summary.

The stress cases are intentional:

- `overheld_middle_phrase` exists to make sure the system does not silently
  forget how to detect draggy interior notes;
- `pitch_weak_stable_phrase` checks the "meant to sing" path on stable rhythm;
- `urgent_hook_fragment` pressures rushed-hook behavior and reroute logic.

This is the minimum local engineering loop for:

- regressions;
- fallback coverage;
- capture-quality edge cases.
- optional public or private dataset replay through the audit manifest hook.

The closure runner sits one level above this and lets the machine execute:

- required synthetic baseline
- optional public dataset suites
- optional internal Murmur golden sets

through one local command instead of manual orchestration.
For a stronger unattended operator pass, `bun run audit:audio:acceptance`
now runs the key app-side tests, worker-side tests, closure evaluation, and
writes a combined markdown/json report beside the closure snapshot.

The music-feel score is intentionally heuristic, not authoritative. Its job is
to flag takes that may be recognisable in pitch but still feel rhythmically or
cadentially awkward.

## 7. What is implemented vs. still open

### Implemented now

- worker contour contract;
- contour-aware melody selection;
- input-quality diagnostics;
- onset-confirmed note segmentation;
- note-hypothesis comparison plus acceptance-scored selection;
- acceptance-driven musical repair for dragging / overheld phrases in the app
  melody layer;
- worker-side acceptance rerun that can escalate from configured provider to
  repair hypotheses and alternate-provider review;
- synthetic local audio audit;
- server-authoritative error and billing fallbacks.

### Still open

- note-proposal layer inspired by Basic Pitch;
- real eval-set comparison across providers;
- front-end capture quality hints;
- stronger saved-song provenance around repair decisions;
- worker-side alternate-detector reruns triggered by acceptance, not only
  melody-layer repair after one detector pass;

See also:

- [audio-system-closure.md](../docs/audio-system-closure.md)
- render / timbre upgrades after the melody front-end stabilizes.

## 7.1 What happens when acceptance is poor now

Murmur now has two different reactions to weak acceptance:

1. worker-side note candidate selection:
   compare multiple detector / segmentation candidates and keep the strongest
   one instead of trusting the first pass;
2. worker-side rerun and reroute:
   if the configured detector still looks merged, draggy, or low-confidence,
   rerun with repair-oriented note slicing and compare against the alternate
   provider before handing results upward;
3. app-side musical repair:
   if the chosen melody still looks draggy or awkward, run a stronger musical
   repair pass that:
   - trims ambiguous long notes inside phrases;
   - gently regularizes weak-note timing toward cleaner buckets;
   - keeps cadence holds subtle instead of over-romanticizing the tail.

This is deliberate. The first stage tries to recover what the user actually
sang. The second stage only steps in when the phrase still does not feel like a
coherent song line.

## 8. Acceptance philosophy

Do not mark the audio system "done" because one happy-path hum works.

The bar is:

- the architecture is explainable;
- fallbacks are explicit;
- local acceptance can run unattended;
- edge cases are visible in diagnostics;
- musical output stays recognizable and pleasant.
