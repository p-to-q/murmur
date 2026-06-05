# Murmur Audio Engine Borrowing Deltas

Last updated: 2026-06-05

This note compares Murmur's current humming pipeline with the strongest nearby
reference implementations and records the highest-value next moves.

## 0. Borrowing status matrix

| Area | External signal | Landed in Murmur now | Still open |
|---|---|---|---|
| Continuous contour truth | SwiftF0 / CREPE | `SwiftF0` main path, `pYIN` fallback, contour frames returned through worker contract | offline CREPE benchmark on Murmur eval sets |
| Note proposals | Basic Pitch | contour-driven hypothesis bundle (`balanced` / `agile` / `steady` plus glide / wobble / urgent flavors) | true onset-evidence stream, bend-aware proposal objects |
| Front-end cleanup | DeepFilterNet | denoise seam + capture diagnostics + optional repair reruns | stricter policy for when to denoise vs. ask for rerecord |
| Confidence-first repair | pYIN / modern pitch stacks | contour-aware melody choice, acceptance scores, repair-biased selection | full stage-by-stage confidence map and note provenance |
| Real-data closure | public datasets | `vocadito` integrated into local closure, smoke + full closure runnable | real `HumTrans` subset still missing locally |
| “像我唱的 / 更好听” product control | Auto-Tune / Voloco-style taste axis | `Me` page repair-bias slider feeding melody selection | drive more downstream arrangement/render choices from the same axis |

## 1. Murmur current state

Current local boundaries:

- worker:
  [workers/audio-engine/main.py](../workers/audio-engine/main.py)
- server normalization:
  [src/lib/platform/audio-worker.ts](../src/lib/platform/audio-worker.ts)
- client facade:
  [src/modules/stainer/transcribe.ts](../src/modules/stainer/transcribe.ts)
- melody repair and selection:
  [src/modules/music/humming-engine.ts](../src/modules/music/humming-engine.ts)

What Murmur already does well:

- the worker is behind a stable contract;
- `SwiftF0` with `pYIN` fallback is already part of the direction of travel;
- denoise is optional and hidden behind a provider seam;
- Murmur already distinguishes `intent`, `corrected`, and `musical` melody
  layers.

What is still thin:

- worker response now exposes raw contour frames to the web app, but that
  contour is not yet used everywhere it could be;
- note segmentation is still effectively a single-path note list, not
  multi-evidence fusion;
- confidence now exists at both note and contour level, but it is not yet a
  full repair map across every stage;
- there is still no formal real-user eval set to compare detector behavior on
  Murmur takes, though the local synthetic/stress corpus is now much richer and
  includes familiar hooks, overheld interior notes, pitch-weak stable phrases,
  and urgent fragments.

## 2. Delta against SwiftF0

Reference:

- `/Users/dujiayi/murmur-research/references/swift-f0/swift_f0/core.py`
- `/Users/dujiayi/murmur-research/references/swift-f0/swift_f0/music.py`

What SwiftF0 has explicitly:

- `pitch_hz`
- `confidence`
- `voicing`
- timestamps
- `segment_notes()`

Murmur gap:

- Murmur worker currently returns `rawNotes`, not the full frame-level contour
  object.

What is now in place:

- worker response now includes:
  - `timestamps`
  - `pitchHz`
  - `confidence`
  - `voiced`
- Murmur keeps `rawNotes` for compatibility while it consumes contour data.

Why it matters:

- the humming engine can only become confidence-first if the raw confidence map
  survives beyond the worker boundary.

## 3. Delta against Basic Pitch

Reference:

- `/Users/dujiayi/murmur-research/references/basic-pitch/basic_pitch/inference.py`
- `/Users/dujiayi/murmur-research/references/basic-pitch/basic_pitch/note_creation.py`

What Basic Pitch has explicitly:

- separate `note`, `onset`, and `contour` outputs;
- note creation that uses both onset evidence and frame changes;
- optional pitch-bend values attached to note events.

Murmur gap:

- Murmur now has a first worker-side `noteProposalProfile` layer that can tag a
  take as `glide`, `wobble`, `urgent`, or `balanced`, then widen the hypothesis
  set before final selection;
- Murmur still does not have a learned onset head, so these proposals are
  contour-driven rather than model-driven;
- there is no extra onset evidence channel yet;
- slide / bend detail is not represented separately from final note repair.

What was implemented:

- the worker now records `noteProposalProfile`, `noteProposalCandidates`, and
  contour-derived glide / wobble / urgent ratios;
- proposal-specific hypotheses such as `glide_guarded`, `wobble_guarded`, and
  `urgent_attack` are scored alongside the existing balanced / repair
  hypotheses;
- when the top candidate is too `steady` for the observed contour motion,
  Murmur now applies a narrow detail-preserving rerank so clearly better glide
  or balanced readings can win without turning the whole selector into an
  over-segmenting machine;
- short-hook scoring now distinguishes "coherent fast phrase" from "fragmented
  rushed phrase", so Murmur does not punish musically tidy urgent hooks just
  for being short and dense;
- the local audit corpus now includes `glide_phrase` and `vibrato_phrase` so
  this behavior is exercised in unattended runs.

Best next move:

- replace some of these contour heuristics with a true onset-evidence stream;
- preserve sub-note bend detail separately from the discrete note list;
- keep the proposal bundle internal until the humming engine has a stronger way
  to compare proposal families across real-user takes.

Why it matters:

- it gives Murmur a route to handle glide-heavy humming and rushed takes without
  overcommitting to hard note boundaries too early.
- it also prevents the selector from hiding real melodic detail under a
  musically pleasant but too-flat `steady` reading.

## 4. Delta against CREPE

Reference:

- `/Users/dujiayi/murmur-research/references/crepe/crepe/core.py`

What CREPE has explicitly:

- activation matrix output;
- frame confidence;
- optional Viterbi smoothing.

Murmur gap:

- Murmur has no benchmark contour oracle beyond current local detector choices;
- uncertain regions are not yet diagnosable from an activation-like view.

Best next move:

- use CREPE offline on a Murmur eval set as a benchmark, not as the main live
  path;
- compare:
  - voiced ratio stability
  - contour continuity
  - phrase-ending stability
  - onset over-fragmentation

Why it matters:

- Murmur needs a quality reference, not just another runtime dependency.

## 5. Delta against DeepFilterNet

Reference:

- `/Users/dujiayi/murmur-research/references/DeepFilterNet/DeepFilterNet/df/enhance.py`

What DeepFilterNet has explicitly:

- a practical denoise entrypoint;
- clear real-time and offline usage paths;
- low-latency orientation.

Murmur gap:

- denoise is available as a seam, but the product-level rule for when to use it
  is still mostly implicit;
- Murmur does not yet expose enough input diagnostics to decide when to suggest
  rerecord vs. light clean-up.

Best next move:

- add recording quality diagnostics earlier in the flow:
  - level
  - clipping
  - snr estimate
  - voiced ratio estimate
- only run heavier cleanup when those metrics justify it.

Why it matters:

- this improves the raw material before any melody logic has to guess.

## 6. Delta against DDSP

Reference:

- `/Users/dujiayi/murmur-research/references/ddsp/ddsp/synths.py`
- `/Users/dujiayi/murmur-research/references/ddsp/ddsp/training/encoders.py`

What DDSP has explicitly:

- structured timbre modeling;
- synth parameter thinking instead of only fixed samples.

Murmur gap:

- render quality currently depends more on arrangement logic and current sound
  sources than on expressive synthesis.

Best next move:

- do not move DDSP-class work into the critical path yet;
- keep it as a later render experiment after melody confidence is stable.

Why it matters:

- this keeps the product focused on "recognizable and musical" instead of
  turning into a research sink.

## 7. Recommended implementation order

1. Expand worker output with frame-level contour data.
2. Build a tiny Murmur eval set of real humming cases on top of the current
   unattended synthetic/stress corpus.
3. Compare current `pYIN` fallback and `SwiftF0` contour quality on that set.
4. Add optional note-proposal support inspired by Basic Pitch.
5. Push more of Murmur's repair toward confidence-driven phrase correction.
6. Upgrade sound sources and mix presets before advanced timbre modeling.

## 8. Bottom line

Murmur does not need a giant rewrite to benefit from outside work.

The highest-leverage borrowing path is:

- `SwiftF0` for contour truth,
- `Basic Pitch` ideas for note proposals,
- `DeepFilterNet` for careful pre-clean,
- Murmur itself for the final musical judgment.
