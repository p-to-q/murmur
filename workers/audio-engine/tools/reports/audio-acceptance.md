# Murmur Audio Acceptance Report

- Generated at: `2026-06-05T05:45:25.760Z`
- Overall status: `ok`
- Includes lint: `no`
- Includes build: `no`
- Closure report: [audio-closure.md](/Users/dujiayi/murmur/workers/audio-engine/tools/reports/audio-closure.md)

## Main line

Understand the user's melody faithfully, then repair only unstable or musically broken parts so the result still feels like their line but lands more like a song.

## How we are doing

- The research-engineering loop is now local and repeatable: workspace scaffold, seeded local golden audio, app-side audio tests, worker tests, and closure evaluation can run from one command and write durable operator artifacts.
- Real-data suites currently in the loop: humtrans_local, vocadito_report.
- The clearest remaining user-path bottleneck is auto latency in humtrans_local (p95 pitch 898.8 ms).
- The slowest humming tail is currently a quality-tail case in humtrans_local (wav_data_sync_with_midi/F01_0191_0001_2_D), where pYIN still appears to be buying fidelity rather than pure waste.
- The main reducible latency bucket is currently an engineering-tail case in vocadito_report (vocadito_37), where SwiftF0 still wins and the delay is mostly comparison overhead.
- The remaining engineering tail is now split into concrete subfamilies: hold_repair_tail, general_review_tail, fragmented_urgent_tail, compact_review_tail, late_onset_tail.

## Step results

- `audio_eval_workspace` -> `ok` in `41.7 ms`
  - cwd: `/Users/dujiayi/murmur/workers/audio-engine`
  - cmd: `./.venv/bin/python tools/scaffold_audio_eval_workspace.py --pretty`
- `seed_murmur_golden` -> `ok` in `457.3 ms`
  - cwd: `/Users/dujiayi/murmur/workers/audio-engine`
  - cmd: `./.venv/bin/python tools/seed_murmur_golden.py --pretty`
- `app_audio_tests` -> `ok` in `82 ms`
  - cwd: `/Users/dujiayi/murmur`
  - cmd: `bun test src/lib/audio/fixture-rescue-policy.test.ts src/lib/audio/hum-support-visibility.test.ts src/lib/audio/hum-error-log-level.test.ts src/lib/observability/support-code.test.ts src/lib/platform/audio-worker.test.ts src/modules/music/humming-engine.test.ts src/app/api/transcribe/route.test.ts`
- `worker_audio_tests` -> `ok` in `22148.9 ms`
  - cwd: `/Users/dujiayi/murmur/workers/audio-engine`
  - cmd: `./.venv/bin/python -m unittest tests.test_detectors tests.test_frames tests_full.test_pipeline tests_full.test_audio_audit tests_full.test_audio_eval_closure tests_full.test_prepare_public_dataset tests_full.test_build_dataset_manifest tests_full.test_scaffold_audio_eval_workspace tests_full.test_seed_murmur_golden`
- `audio_closure_report` -> `ok` in `187528 ms`
  - cwd: `/Users/dujiayi/murmur/workers/audio-engine`
  - cmd: `./.venv/bin/python tools/audio_eval_closure.py --config tools/audio_eval_closure.report.json --markdown-out tools/reports/audio-closure.md`

## Closure summary

- Real-data suites: `humtrans_local, vocadito_report`
- Primary path slow provider: `auto` in `humtrans_local` at p95 pitch `898.8 ms`
- Primary path slow provider: `auto` in `synthetic_baseline` at p95 pitch `167.9 ms`
- Primary path slow provider: `auto` in `murmur_golden_local` at p95 pitch `158.6 ms`
- Primary path slow provider: `auto` in `vocadito_report` at p95 pitch `2352.1 ms`
- Slow provider: `auto` in `humtrans_local` at p95 pitch `898.8 ms`
- Slow provider: `swiftf0` in `humtrans_local` at p95 pitch `688.9 ms`
- Slow provider: `pyin` in `humtrans_local` at p95 pitch `678.4 ms`
- Slow provider: `auto` in `synthetic_baseline` at p95 pitch `167.9 ms`
- Slow provider: `auto` in `murmur_golden_local` at p95 pitch `158.6 ms`
- Slow provider: `swiftf0` in `murmur_golden_local` at p95 pitch `133 ms`
- Slow provider: `pyin` in `murmur_golden_local` at p95 pitch `130.6 ms`
- Slow provider: `pyin` in `synthetic_baseline` at p95 pitch `130.3 ms`
- Latency archetype: `quality_tail` in `humtrans_local` via `wav_data_sync_with_midi/F01_0191_0001_2_D` — fallback quality tail where pYIN still wins decisively enough that latency is likely buying fidelity rather than waste.
- Latency archetype: `engineering_tail` in `vocadito_report` via `vocadito_37` — ensemble cost tail where SwiftF0 still wins, so most of the delay is comparison overhead rather than the final detector choice.
- Engineering-tail subfamily: `hold_repair_tail` in `vocadito_report` via `vocadito_37` — The phrase still carries enough interior hold / overhold risk that alternate review is spending time on repair-sensitive timing.
- Engineering-tail subfamily: `general_review_tail` in `vocadito_report` via `vocadito_39` — SwiftF0 wins, but the case still sits in the general ensemble-overhead bucket rather than a sharper repair subtype.
- Engineering-tail subfamily: `fragmented_urgent_tail` in `vocadito_report` via `vocadito_18` — The phrase is fragmented or rushed enough that alternate review is still paying for timing-shape confirmation.
- Engineering-tail subfamily: `compact_review_tail` in `vocadito_report` via `vocadito_33` — SwiftF0 is already clearly stable enough that the remaining cost is mostly compact alternate sanity review.
- Engineering-tail subfamily: `late_onset_tail` in `vocadito_report` via `vocadito_38` — The phrase starts late enough that alternate review is still paying to double-check onset placement.

## What to do next

- Review pitch latency for provider auto in suite humtrans_local.
- Inspect the slowest concrete case next: wav_data_sync_with_midi/F01_0191_0001_2_D in suite humtrans_local (auto -> pyin).
- Treat wav_data_sync_with_midi/F01_0191_0001_2_D in suite humtrans_local as a quality-tail case first; do not trim latency by removing the pYIN win path unless fidelity stays intact.
- Treat vocadito_37 in suite vocadito_report as an engineering-tail case next; focus on reducing ensemble overhead while keeping SwiftF0's final choice unchanged.
- Use vocadito_37 in suite vocadito_report as the current hold_repair_tail example when deciding the next narrow latency rule.
- Use vocadito_39 in suite vocadito_report as the current general_review_tail example when deciding the next narrow latency rule.
- Use vocadito_18 in suite vocadito_report as the current fragmented_urgent_tail example when deciding the next narrow latency rule.
- After latency, keep pushing worker-side musical repair quality rather than growing front-door complexity.
