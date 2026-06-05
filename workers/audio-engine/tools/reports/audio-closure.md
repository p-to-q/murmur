# Murmur Audio Closure Report

- Generated at: `2026-06-05T05:45:25+00:00`
- Config: `/Users/dujiayi/murmur/workers/audio-engine/tools/audio_eval_closure.report.json`
- Overall status: `ok`

## Coverage

- Real-data suites with cases: `2`
- Optional manifests missing: `0`
- Optional manifests empty: `0`
- Real-data suite names: `humtrans_local, vocadito_report`

## Suites

### synthetic_baseline

- Required: `yes`
- Status: `ok`
- Providers:
  - `auto` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `167.85`
  - `swiftf0` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `129.6`
  - `pyin` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `130.3`

### humtrans_local

- Required: `no`
- Status: `ok`
- Providers:
  - `auto` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `898.8`
  - `swiftf0` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `688.9`
  - `pyin` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `678.4`

### vocadito_report

- Required: `no`
- Status: `ok`
- Providers:
  - `auto` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `2352.1`
  - `swiftf0` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `458.9`
  - `pyin` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `392.85`

### murmur_golden_local

- Required: `no`
- Status: `ok`
- Providers:
  - `auto` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `158.6`
  - `swiftf0` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `133.0`
  - `pyin` pitch `n/a` feel `n/a` warn `0` fail `0` p95PitchMs `130.6`

## Risks

### Primary-path slow providers

- `auto` in `humtrans_local` with p95 pitch `898.8` ms
- `auto` in `synthetic_baseline` with p95 pitch `167.85` ms
- `auto` in `murmur_golden_local` with p95 pitch `158.6` ms
- `auto` in `vocadito_report` with p95 pitch `2352.1` ms

### Slow providers

- `auto` in `humtrans_local` with p95 pitch `898.8` ms
- `swiftf0` in `humtrans_local` with p95 pitch `688.9` ms
- `pyin` in `humtrans_local` with p95 pitch `678.4` ms
- `auto` in `synthetic_baseline` with p95 pitch `167.85` ms
- `auto` in `murmur_golden_local` with p95 pitch `158.6` ms
- `swiftf0` in `murmur_golden_local` with p95 pitch `133.0` ms
- `pyin` in `murmur_golden_local` with p95 pitch `130.6` ms
- `pyin` in `synthetic_baseline` with p95 pitch `130.3` ms

### Slow cases

- `wav_data_sync_with_midi/F01_0191_0001_2_D` in `humtrans_local` (requested `auto`, selected `pyin`, pitch `1169.0` ms, providerPitch `976.0` ms, decision `highest_score`)
- `wav_data_sync_with_midi/F01_0191_0001_2_D` in `humtrans_local` (requested `swiftf0`, selected `pyin`, pitch `985.0` ms, providerPitch `None` ms, decision `explicit_highest_score`)
- `wav_data_sync_with_midi/F01_0191_0001_2_D` in `humtrans_local` (requested `pyin`, selected `pyin`, pitch `971.0` ms, providerPitch `None` ms, decision `explicit_highest_score`)
- `wav_data_sync_with_midi/M05_0306_0001_2` in `humtrans_local` (requested `auto`, selected `swiftf0`, pitch `397.0` ms, providerPitch `392.0` ms, decision `swift_fast_path`)
- `wav_data_sync_with_midi/F03_0305_0001_2_D` in `humtrans_local` (requested `auto`, selected `swiftf0`, pitch `276.0` ms, providerPitch `268.0` ms, decision `swift_fast_path`)
- `vocadito_37` in `vocadito_report` (requested `auto`, selected `swiftf0`, pitch `3162.0` ms, providerPitch `564.0` ms, decision `highest_score`)
- `vocadito_1` in `vocadito_report` (requested `auto`, selected `swiftf0`, pitch `2563.0` ms, providerPitch `359.0` ms, decision `highest_score`)
- `vocadito_39` in `vocadito_report` (requested `auto`, selected `swiftf0`, pitch `2341.0` ms, providerPitch `243.0` ms, decision `highest_score`)

### Latency archetypes

- `quality_tail` in `humtrans_local` via `wav_data_sync_with_midi/F01_0191_0001_2_D`: fallback quality tail where pYIN still wins decisively enough that latency is likely buying fidelity rather than waste.
- `engineering_tail` in `vocadito_report` via `vocadito_37`: ensemble cost tail where SwiftF0 still wins, so most of the delay is comparison overhead rather than the final detector choice.

### Engineering-tail subfamilies

- `hold_repair_tail` in `vocadito_report` via `vocadito_37`: The phrase still carries enough interior hold / overhold risk that alternate review is spending time on repair-sensitive timing.
- `general_review_tail` in `vocadito_report` via `vocadito_39`: SwiftF0 wins, but the case still sits in the general ensemble-overhead bucket rather than a sharper repair subtype.
- `fragmented_urgent_tail` in `vocadito_report` via `vocadito_18`: The phrase is fragmented or rushed enough that alternate review is still paying for timing-shape confirmation.
- `compact_review_tail` in `vocadito_report` via `vocadito_33`: SwiftF0 is already clearly stable enough that the remaining cost is mostly compact alternate sanity review.
- `late_onset_tail` in `vocadito_report` via `vocadito_38`: The phrase starts late enough that alternate review is still paying to double-check onset placement.

## Next actions

- Review pitch latency for provider auto in suite humtrans_local.
- Inspect the slowest concrete case next: wav_data_sync_with_midi/F01_0191_0001_2_D in suite humtrans_local (auto -> pyin).
- Treat wav_data_sync_with_midi/F01_0191_0001_2_D in suite humtrans_local as a quality-tail case first; do not trim latency by removing the pYIN win path unless fidelity stays intact.
- Treat vocadito_37 in suite vocadito_report as an engineering-tail case next; focus on reducing ensemble overhead while keeping SwiftF0's final choice unchanged.
- Use vocadito_37 in suite vocadito_report as the current hold_repair_tail example when deciding the next narrow latency rule.
- Use vocadito_39 in suite vocadito_report as the current general_review_tail example when deciding the next narrow latency rule.
- Use vocadito_18 in suite vocadito_report as the current fragmented_urgent_tail example when deciding the next narrow latency rule.
