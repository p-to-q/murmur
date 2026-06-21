# Murmur Audio System Closure

Last updated: 2026-06-05

This document closes the loop between product intent, engineering design,
validation, supportability, and fallback behavior for Murmur's audio system.

It exists to answer five questions in one place:

1. what the main audio path is;
2. what should happen when the path weakens or fails;
3. how we validate quality without manual intervention;
4. what should live on device vs. on the server;
5. how we debug user issues without guessing.

## 1. Main line

The main line is deliberately narrow:

1. accept a short monophonic hum;
2. recover the user's intended melody contour;
3. repair only the parts that are unstable or musically broken;
4. hand a structured melody to arrangement/render;
5. return a result that still feels like "me, but better sung".

Everything else is secondary.

If a change does not strengthen that line, it is probably local optimization.

## 2. Existing methods we already have

Current validation / optimization methods in the repo:

1. unit tests on worker detectors, denoise, segmentation, and route behavior;
2. full worker tests for reroute, repair, and synthetic phrase cases;
3. app-side tests for melody selection and stronger musical repair;
4. synthetic audio audit with strict gateable expectations;
5. production-route typed errors with request IDs;
6. debug surfaces and observability events for failed hum attempts.

These are not just tests. They are the current optimization harness.

The repo now also supports a zero-download bootstrap for the local golden set:

```bash
bun run audit:audio:seed-golden
```

That command creates a non-empty local `murmur-golden` suite from curated
product-shaped synthetic cases. It is intentionally weaker than a true internal
recording set, but it means the closure can validate more than the strict
baseline even on a fresh machine.

## 3. Missing but now supported evaluation path

Synthetic cases are necessary but not enough.

The worker audit tool now supports plugging in external WAV datasets through a
manifest:

```bash
cd workers/audio-engine
./.venv/bin/python tools/audio_audit.py \
  --all-providers \
  --manifest tools/dataset_manifest.example.json \
  --pretty
```

Manifest format:

- `name`
- optional `family`
- optional `source`
- `path`
- `expected_min_notes`
- optional `expected_pitches`
- optional `pitch_match_min`
- optional `music_feel_min`
- optional `tags`

Example:

- [workers/audio-engine/tools/dataset_manifest.example.json](../workers/audio-engine/tools/dataset_manifest.example.json)

This lets us do two things:

1. keep our synthetic corpus as a stable baseline;
2. attach public datasets or our own recorded eval set without rewriting the
   audit harness.
3. hold different dataset families to different bars instead of one global
   threshold.

One important implementation detail: manifest item paths are resolved relative
to the dataset root. If the manifest file lives elsewhere, use
`--manifest-root` or the closure config's `manifestRoot` field.

## 4. Public dataset candidates

These are the most useful public or semi-public sources to plug into the
manifest path.

The practical filter is:

- does it contain monophonic singing or humming close to Murmur input;
- does it include frame-level F0, note labels, or both;
- can we actually download it and normalize it into our manifest;
- will it tell us something different from our synthetic cases.

### 4.0 Recommended order

1. `HumTrans` for closest-task humming evaluation;
2. `vocadito` for clean monophonic singing with note annotations;
3. `DALI` for note-aligned vocal phrases and rhythm sanity;
4. `MIR-QBSH` for rough, search-style humming robustness;
5. `MedleyDB` as a harder contour stress set, not a product-fit gold set.

### 4.0.1 Dataset fit table

| Dataset | What it gives us | Fit for Murmur | Practical use in Murmur |
|---|---|---|---|
| `HumTrans` | Hummed melody audio plus reference MIDI / evaluation code | Best fit | Main external regression set for humming-to-note quality |
| `vocadito` | Solo monophonic singing with frame-level F0 and note labels | High fit | Note segmentation / pitch repair sanity |
| `DALI` | Audio, lyrics, and vocal notes | Medium fit | Rhythm / note-duration sanity, especially for phrase timing |
| `MIR-QBSH` | Query-by-humming style humming clips | Medium fit | Stress tolerant retrieval-style humming inputs without copying retrieval objectives |
| `MedleyDB melody` | Continuous melody F0 annotations on richer music | Low-medium fit | Contour stress and detector benchmarking, not acceptance gold data |

### 4.1 HumTrans

- Good for: actual humming transcription rather than polished singing.
- Why it matters: closest public task shape to Murmur's front door.
- What the official repo says: it is the official repository for
  `HumTrans: A Novel Open-Source Dataset for Humming Melody Transcription and Beyond`,
  points to the full dataset, and explicitly notes there is still significant
  room for improvement in humming transcription quality.
- Source:
  - [HumTrans repo](https://github.com/shansongliu/HumTrans)
  - [HumTrans paper](https://arxiv.org/abs/2309.09623)

### 4.2 vocadito

- Good for: short solo monophonic singing with both F0 and note annotations.
- Why it matters: useful for separating "pitch contour is right" from
  "note slicing is musically plausible".
- Practical warning: this is singing, not humming, so it is better for repair
  and segmentation checks than for full product acceptance.
- Evaluation note: Murmur now treats `vocadito` as a contour / segmentation
  sanity suite, not as an absolute-register gold set. The generated manifest
  carries octave-equivalent reference pitch sets alongside the primary
  annotation so a stable whole-octave normalization does not masquerade as a
  broken melody path.
- Source:
  - [vocadito loader docs](https://mirdata.readthedocs.io/en/0.3.9/_modules/mirdata/datasets/vocadito.html)
  - [vocadito paper](https://arxiv.org/abs/2110.05580)

### 4.3 DALI

- Good for: note timing and phrase structure on vocal material with aligned
  notes.
- Why it matters: Murmur's weak spots are often duration and onset placement,
  not just pitch class.
- Practical warning: richer and more produced than Murmur input, so it should
  be used to test phrase shaping, not to define success alone.
- Source:
  - [DALI repo](https://github.com/gabolsgabs/DALI)
  - [DALI paper](https://arxiv.org/abs/1906.10606)

### 4.4 MIR-QBSH / query-by-humming sets

- Good for: tolerant humming / singing queries rather than polished vocals.
- Why it matters: closer to off-key, search-like humming behavior.
- Practical warning: this family optimizes retrieval, not creation, so use it
  to test robustness, not as the final objective.
- Source: [MIR Corpora / MIR-QBSH](https://mirlab.org/dataSet/public/)

### 4.5 MedleyDB melody annotations

- Good for: contour extraction validation on harder material.
- Why it matters: the official annotations are continuous F0 curves, which is
  exactly the sort of raw contour we want to benchmark detector stability
  against.
- Practical warning: far richer than Murmur's target input and not a humming
  dataset, so do not score product acceptance off this alone.
- Source:
  - [MedleyDB description](https://medleydb.weebly.com/description.html)
  - [mirdata MedleyDB docs](https://mirdata.readthedocs.io/en/0.2.2/source/mirdata.html)

### 4.6 TONAS

- Good for: monophonic singing F0 / note tracking.
- Why it matters: still useful as a classic singing contour set when we need a
  narrow monophonic baseline.
- Practical warning: lower leverage than `HumTrans` and `vocadito`, so not the
  first dataset to ingest.
- Source: [TONAS](https://mtg.github.io/tonas/)

### 4.7 Our own eval set

This is still the most important one.

Public datasets help with algorithm sanity. They do not replace "real Murmur
style humming" where:

- rhythm is right but pitch is rough;
- pitch is right but note boundaries smear;
- a phrase is recognisable but badly sung.

We should build a small internal eval set with:

- familiar hooks;
- off-key but rhythm-stable takes;
- rushed fragmented takes;
- glide-heavy takes;
- vibrato / wobble takes;
- breathy / noisy / clipped takes.

### 4.8 Ingestion rule

Do not bulk-import public corpora into product code.

Instead:

1. keep raw downloaded datasets outside the app bundle;
2. convert selected clips into a Murmur audit manifest;
3. store only normalized eval metadata in-repo;
4. keep acceptance thresholds per dataset family, not one global bar;
5. review results by `family` and `tags`, not only by top-level pass count.

## 5. Accuracy strategy

Accuracy should improve in layers, not from one magic model.

### 5.1 What should stay rule-heavy

These are better handled by rules and heuristics first:

- onset confirmation;
- short-gap healing;
- overheld interior note trimming;
- duration redistribution after overheld repair, so the phrase lands on a
  cleaner pulse instead of only shrinking one note;
- phrase-end cadence shaping;
- rhythm bucket regularization;
- urgent-phrase coherence bonuses for short but internally stable note groups;
- reduced rushed-phrase penalty when that short phrase is already internally
  coherent, so "tight hook" and "messy fragment" do not get conflated;
- confidence-driven note movement limits.

This is attractive because:

- it is inspectable;
- it is easy to regress-test;
- it does not require retraining.
- it keeps the audit and the shipped worker on the same scoring logic.

### 5.2 What we should keep borrowing from open source

Not one idea. Multiple ideas:

- `SwiftF0`: fast continuous F0 backbone
- `pYIN`: conservative fallback and sanity check
- `Basic Pitch`: note proposal mindset, onset-aware segmentation, bend-aware thinking
- `CREPE`: offline contour benchmark
- `DeepFilterNet`: lightweight cleanup only
- `DDSP`: later-phase render/timbre exploration

The right posture is greedy-but-disciplined:

- absorb useful pieces;
- do not let Murmur become a patchwork of disconnected models.

## 6. Where code should live: device vs. server

First-principles split:

### Keep on the device

- recording UX
- lightweight trim
- level / clipping / "too quiet" hints
- explicit demo melody
- tiny local rescue memory (for fixture policy)
- the single creative-bias slider in `Me!`

Reason:

- fast feedback
- low payload
- better user feel

### Keep on the server

- denoise
- detector ensemble
- note proposal comparison
- acceptance rerun and reroute
- stronger musical repair
- diagnostics aggregation
- dataset evaluation
- bug forensics
- heavy offline baselines such as `CREPE` / `Basic Pitch`
- dataset replay and provider bake-offs
- aggressive musical repair experiments before they are proven safe

Reason:

- one canonical result path
- easier rollback
- easier observability
- easier A/B of heuristics
- avoids shipping every experiment into every client

### Current judgment

Murmur is mostly on the right side of this split, but there are two important
lines to hold:

1. do not let the client become a second melody engine;
2. do not move latency-critical recording feedback to the server.

The client is still acceptable because it only does:

- capture
- trim
- explicit fixture path
- selection of returned melody variants
- one high-level taste preference

That is not much technical debt yet.

What we should resist adding locally:

- multiple detector fallbacks in the browser
- local rerun / acceptance loops
- heavy denoise models by default
- debug-only musical repair branches

Those belong server-side because they change often, need observability, and are
hard to compare consistently once shipped to multiple clients.

## 7. Fixture rescue policy

Fixture should no longer be a silent substitute for failed real audio.

But it can be a controlled rescue tool.

### Allow rescue only when all of these are true

1. the failure is transient (`network_error`, `worker_unavailable`,
   `billing_unavailable`);
2. the user has at least one prior successful live hum on this device;
3. this is not the second consecutive transient failure in the same outage;
4. fixture has not already rescued the current live-success window in the last
   ten minutes;
5. the app is not in a cold-start broken state.

### Never auto-rescue these

- `no_voiced_frames`
- `audio_required`
- `audio_too_large`
- `validation_error`
- repeated transient failure loops
- "just opened the app and nothing works" conditions

### Why

This matches user psychology:

- if the system usually works, a single rough network blip should not feel like
  a dead end;
- if the system is fundamentally broken, fixture must not hide it.

The current implementation now keeps a tiny local rescue state and only
auto-routes to fixture in that narrow transient bucket:

- first transient blip after a known-good live success: rescue allowed;
- rapid repeat of the same outage: rescue blocked and real error shown;
- later isolated blip after cooldown: one more rescue allowed;
- after two rescues without a new live success: stop masking and surface the
  failure.

## 8.1 Long-take latency guard

HumTrans exposed an important real-data behavior:

- some longer humming takes were not slow because `SwiftF0` itself was slow;
- they were slow because `auto` still paid the cost of a full `pYIN` comparison
  even when `SwiftF0` had already produced a strong, stable result and would
  win the ensemble anyway.

Murmur now keeps a second, narrower fast path for that shape:

- only in `auto`;
- only when the active detector is `SwiftF0`;
- only on longer contours;
- only when acceptance / feel / onset / hold metrics already clear a conservative
  bar.

This is intentionally different from the ordinary `swift_fast_path`:

- `swift_fast_path` is for clearly strong general cases;
- `swift_long_take_fast_path` is specifically for longer real humming takes
  where extra ensemble review adds latency but not useful decision change.

The rule is product-aligned because it does **not** skip review on ambiguous
or weak material. It only removes redundant fallback cost when the main path is
already clearly landing in the right place.

## 9. Closure sampling stance

The default closure report now runs the full local `vocadito_report` manifest,
not only a shallow sample.

Why:

- aggregate pass rates were hiding the concrete weak cases we actually need to
  repair;
- the operator report should name the weakest real cases directly;
- the extra runtime is acceptable in the heavier unattended acceptance pass.

Tradeoff:

- `bun run audit:audio:acceptance:full` is intentionally slower now because the
  closure step is doing real weak-case discovery, not just spot-checking.

## 10. Error codes and supportability

For user support, raw request IDs are useful but not ergonomic enough.

Murmur now derives a formal support code of the form:

`<AREA>-<ERROR>-<SHORTID>`

Examples:

- `HUM-WORKER_UNAVAILABLE-Y72ZLB`
- `HUM-NO_VOICED_FRAMES-9UKWDG`
- `PAY-BILLING-4M7Q2R`

Design choice:

- keep **feature-scoped** codes, not one giant project-wide number ladder;
- pair them with `requestId`, not instead of `requestId`;
- let UI show the compact support code while logs keep full request metadata.
- keep the user-facing suffix short, uppercase, and easy to read over chat.

This gives us:

- easier user-to-support communication;
- stable grouping in dashboards;
- no need to memorize a giant error registry too early.
- browser-side hum failures that are already product-handled can stay at `warn`
  level instead of tripping local red-error overlays.

Operator flow should be:

1. user sees human copy first, not raw system detail;
2. only persistent or hard failures surface the support code;
3. support code maps to a product area, an error family, and a short internal locator;
4. `/me/debug` and logs use the same request id so we can correlate route,
   worker, and repair decisions.

This is better than a giant project-wide numeric registry because Murmur's real
support task is usually "which hum path failed?" not "which product area is
this in?".

Current visibility rule:

- show support code immediately for hard backend faults like
  `worker_unconfigured` or unexpected `server_error`;
- hide it for the first transient post-success blip like
  `worker_unavailable` / `network_error` / `billing_unavailable`;
- also keep the first cold-start transient failure human-first;
- show it once those transient failures become persistent.

## 10.1 Fixture rescue rule

Automatic fixture rescue exists to save a single otherwise-healthy session, not
to conceal a broken system.

Current shipped rule:

1. rescue is allowed only for transient transport / worker / billing failures;
2. rescue is never allowed for fundamental audio failures like
   `no_voiced_frames`;
3. rescue is never allowed before the device has seen at least one successful
   live hum;
4. rescue stops after repeated transient failures, short-repeat failures, or
   too many rescues since the last live success;
5. once the system starts looking persistently unhealthy, Murmur surfaces the
   real failure and support path instead of continuing to swap in fixture audio.

This is deliberately a "save the moment once" policy, not a broad masking
policy.

## 11. Failure-mode map

Primary failure families:

1. capture failures
2. upload / network failures
3. worker unavailable / misconfigured
4. billing unavailable
5. no usable melody in audio
6. detector disagreement
7. musically weak but technically valid output
8. downstream arrangement/render disappointment

Current coverage is strongest in 2-7.

Still comparatively weak:

- proactive capture guidance before upload
- saved-song provenance around repair decisions
- longitudinal comparison on real humming data
- automatic clustering of repeated support codes by build / provider / detector
- HumTrans still contains one `pYIN`-winning long take that keeps the p95 tail
  elevated, even after the long-take `SwiftF0` fast path.

## 11.1 Latency archetypes

Not every slow case means the same thing.

Murmur now treats slow real-data tails as two different archetypes:

### Quality tail

Shape:

- `auto` ends up selecting `pYIN`;
- the winning case keeps clearly good pitch / feel scores;
- the extra latency is likely buying fidelity rather than pure waste.

Current example:

- `HumTrans` case `wav_data_sync_with_midi/F01_0191_0001_2_D`

Current evidence from the local closure loop:

- `auto` selects `pyin/steady`
- `pyin/steady` scores `3.255`
- the closest `SwiftF0` candidate (`swiftf0/steady`) scores `3.138`
- direct `pyin` takes about `1000 ms`
- `auto` takes about `1193 ms`

That means the remaining `auto` overhead on this case is only about `200 ms`,
while the winning melody path is still coming from `pYIN`. This is exactly the
kind of slow case we should preserve until we can prove the same melody result
survives a faster path.

Operator stance:

- do not trim this by deleting the `pYIN` win path;
- only optimize if the same musical result survives.

### Engineering tail

Shape:

- `auto` ends up selecting RMVPE or a lighter fallback such as `SwiftF0`;
- `providerPitchMs` is much smaller than final `pitchMs`;
- most of the delay is comparison / alternate-review overhead.

Current worker handling inside this bucket:

- `light_no_repair` for very long SwiftF0-led takes that are already strong;
- `light_no_repair_hold` for hold-sensitive takes where SwiftF0 is already
  winning, but alternate review is still paying mostly to re-check interior
  hold / overhold behavior rather than the core pitch path;
- `light_no_repair_general` for the broad middle band where SwiftF0 is already
  ahead on score, onset shape, and voicing, so `pYIN` only needs a narrow
  `steady / balanced` sanity pass instead of the wider alternate search;
- `light_no_repair_compact` for a narrower medium-length family where
  SwiftF0 is already clearly ahead on score, onset shape, and hold behavior,
  so `pYIN` only needs a sanity pass instead of a full repair rerun.

Current example:

- `vocadito` case `vocadito_37` for the `hold_repair_tail` family
- `vocadito` case `vocadito_39` for the new `general_review_tail` family
- `vocadito` case `vocadito_33` for the tighter `compact_review_tail` family

Operator stance:

- this is the right place to reduce ensemble overhead;
- preserve the final detector choice while shrinking the comparison cost.

This distinction matters because it prevents the team from making the system
faster by silently making it less faithful.

## 12. Acceptance loop we can run alone

This is the closed loop we should use without user intervention:

1. `bun test src/lib/audio/fixture-rescue-policy.test.ts`
2. `bun test src/lib/platform/audio-worker.test.ts src/modules/music/humming-engine.test.ts src/app/api/transcribe/route.test.ts`
3. `cd workers/audio-engine && ./.venv/bin/python -m unittest tests.test_detectors tests_full.test_pipeline tests_full.test_audio_audit`
4. `bun run audit:audio:gate`
5. `bun run audit:audio:closure`
6. optional external dataset pass via `--manifest`
7. `bun run lint`
8. `bun run build`

When we need a faster human review loop instead of raw JSON, generate the
operator report:

9. `bun run audit:audio:closure:report`

When we want one unattended operator entrypoint that also exercises the key
app-side and worker-side test layers, run:

10. `bun run audit:audio:acceptance`

That command writes:

- `workers/audio-engine/tools/reports/audio-closure.md`
- `workers/audio-engine/tools/reports/audio-acceptance.md`
- `workers/audio-engine/tools/reports/audio-acceptance.json`

It also self-bootstraps the minimum local eval surface before the real checks:

- scaffolds the local dataset workspace if it does not exist yet;
- seeds the local `murmur-golden` corpus from the checked-in synthetic cases;
- then runs app-side tests, worker tests, and the closure report on top.

Use:

11. `bun run audit:audio:acceptance:full`

when you want the same run to also include repo `lint` and `build`.

That command is intentionally bounded for operator use:

- full synthetic baseline;
- full local `humtrans` suite when present;
- a limited `vocadito` slice for turnaround;
- local `murmur-golden`.

Use the full closure command when changing core evaluation logic or when you
need the deepest local picture across every staged case.

When we want to pressure-test only the staged real humming suite, run:

12. `bun run audit:audio:humtrans`

If these are green, the system is not "done", but it is at least locally
self-defending.

## 13. Main line assessment

### 11.1 Main line

Understand the melody faithfully, then make it musical with minimal betrayal.

### 11.2 How we are doing

Good:

- architecture is clearer;
- fallback paths are more explicit;
- acceptance rerun/reroute is real;
- local unattended validation exists;
- typed errors and supportability are improving.
- the client is no longer carrying too much hidden music logic.
- the `auto` detector path now has RMVPE / SwiftF0 fast paths, so a clearly
  strong first-pass melody no longer always pays the full pYIN review cost.

Still soft:

- real-data evaluation;
- richer capture quality gating;
- provenance of repair choices over time;
- stronger benchmark separation between "accurate" and "pleasant".
- HumTrans pitch latency is still the clearest remaining hard bottleneck in the
  real humming suite.
- `auto` suite latency in closure reports now reflects ensemble wall time, not
  only the winning detector's raw inference time; that is the number to watch
  for the real user path.

### 11.3 What to do next

1. keep `HumTrans` as the primary real humming gate and continue pulling its
   p95 latency down;
2. treat the current `HumTrans` quality-tail example as a fidelity boundary,
   not just a speed target; the burden of proof is on any change that tries to
   bypass its `pYIN` win path;
3. build a small internal real-humming eval set beside the public datasets, not
   after them;
4. add capture quality hints before upload;
5. persist repair/provenance diagnostics on saved songs or debug events;
6. keep tuning rule-based musical repair before adding heavier model complexity.
