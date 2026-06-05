# Murmur Audio Dataset Ingestion

Last updated: 2026-06-05

This note explains how to turn a downloaded public dataset or an internal hum
recording folder into a Murmur audit manifest that the worker can run without
manual editing.

This is intentionally boring.

The goal is not to build a dataset platform. The goal is to make external
evaluation repeatable on one machine.

## 1. Main rule

Keep raw datasets out of the app bundle and out of Git.

Only bring in:

1. the local dataset directory on disk;
2. a generated manifest JSON;
3. optional pitch-sketch metadata;
4. the audit output.

## 2. Build a manifest from a local folder

The worker now includes a helper:

```bash
cd workers/audio-engine
./.venv/bin/python tools/build_dataset_manifest.py \
  --root /absolute/path/to/humtrans_subset \
  --out tools/manifests/humtrans.local.json \
  --family humtrans \
  --source public_dataset \
  --tag real \
  --tag humming \
  --expected-min-notes 3 \
  --pitch-match-min 0.65 \
  --music-feel-min 0.48
```

By default it scans:

- `**/*.wav`
- `**/*.flac`

It writes a Murmur-compatible manifest where every case gets:

- `family`
- `source`
- `path`
- `expected_min_notes`
- optional thresholds
- optional tags

If you want the whole local workspace scaffolded first, run:

```bash
bun run audit:audio:scaffold
```

That creates local-only folders for:

- `humtrans`
- `vocadito`
- `murmur-golden`

plus placeholder manifests and pitch maps in the expected names.

If you want the local `murmur-golden` suite to stop being an empty shell
immediately, seed it with product-shaped synthetic fixtures:

```bash
bun run audit:audio:seed-golden
```

This writes:

- local WAV files under `workers/audio-engine/tools/datasets/murmur-golden/`
- `tools/manifests/murmur-golden.local.json`
- `tools/pitch-maps/murmur-golden.local.json`

This is not a substitute for real Murmur recordings. It is a bootstrap so the
closure can exercise a non-empty product-shaped suite on one machine before any
public dataset or internal hum library is downloaded.

## 3. Add expected pitches when available

If a dataset subset has trustworthy note sketches, prepare a JSON map:

```json
{
  "subset/take_a.wav": [60, 62, 64],
  "take_b": [67, 69]
}
```

Then pass it into the builder:

```bash
./.venv/bin/python tools/build_dataset_manifest.py \
  --root /absolute/path/to/vocadito_subset \
  --out tools/manifests/vocadito.local.json \
  --family vocadito \
  --source public_dataset \
  --expected-pitches-json /absolute/path/to/pitch-map.json
```

Keys may be:

- relative audio paths from the dataset root, or
- file stems

There is also an example for Murmur's own golden-set style here:

- [workers/audio-engine/tools/pitch-maps/murmur-golden.example.json](../workers/audio-engine/tools/pitch-maps/murmur-golden.example.json)

## 4. Run the audit

Once the manifest exists:

```bash
./.venv/bin/python tools/audio_audit.py \
  --all-providers \
  --manifest tools/manifests/humtrans.local.json \
  --manifest-root /absolute/path/to/humtrans_subset \
  --pretty
```

The summary now groups by:

- `family`
- `tags`

That matters because:

- `synthetic`
- `humtrans`
- `vocadito`
- internal Murmur hums

should not be judged as one blended bucket.

## 4.1 Run the full local closure

For a single local acceptance entrypoint, use:

```bash
bun run audit:audio:closure
```

This runs the suite config at:

- [workers/audio-engine/tools/audio_eval_closure.example.json](../workers/audio-engine/tools/audio_eval_closure.example.json)

Behavior:

- the checked-in synthetic baseline is required;
- local public-dataset manifests are optional;
- a local Murmur golden manifest is optional;
- missing optional manifests are reported as skipped, not failures;
- empty scaffold manifests are also skipped until they contain real cases;
- missing required suites fail the closure.
- the closure summary also points out missing manifests, weak tag buckets, and
  high-latency providers so the next action is visible without hand-reading the
  full raw audit output.

If you want a much faster local confidence pass before the full run, use:

```bash
bun run audit:audio:closure:smoke
```

That smoke config currently keeps:

- the full required synthetic baseline;
- a limited `vocadito` slice (`manifestCaseLimit: 8`);
- the local `murmur-golden` suite.

Use the smoke run for quick iteration and the full closure before trusting a
meaningful audio-engine change.

If you want a human-readable operator snapshot at the same time, use:

```bash
bun run audit:audio:closure:report
```

That writes:

- `workers/audio-engine/tools/reports/audio-closure.md`

The report command intentionally uses a bounded config:

- full required synthetic baseline;
- full staged `humtrans_local` when present;
- a limited `vocadito` slice (`manifestCaseLimit: 8`);
- the local `murmur-golden` suite.

That keeps the operator snapshot fast enough for normal iteration while the
full `audit:audio:closure` command still remains the deeper acceptance run.

Read the `vocadito` slice accordingly:

- it is a singing-side sanity suite, not Murmur's primary humming acceptance
  gold set;
- whole-octave-equivalent references are included on purpose, so the report is
  more sensitive to contour / segmentation regressions than to singer-range
  normalization.

The markdown report is deliberately short. It answers:

- which suites actually ran;
- whether real-data coverage exists yet;
- which family/tag buckets are weak in pitch or musical feel;
- which provider is currently slowest;
- what the next action should be.

Important path rule:

- the manifest `path` values are relative to the dataset root, not to the
  manifest file itself;
- when manifests live in `tools/manifests/` and audio lives elsewhere, pass
  `--manifest-root` or set `manifestRoot` in the closure config.

## 5. Suggested first real runs

1. `HumTrans` humming subset
2. `vocadito` monophonic singing subset
3. one tiny internal Murmur golden set
4. seeded local `murmur-golden` bootstrap if nothing else is on disk yet

That combination gives us:

- humming realism
- note segmentation sanity
- product-specific acceptance

## 5.1 Recommended local naming

Keep the local naming boring and stable:

- manifests:
  - `tools/manifests/humtrans.local.json`
  - `tools/manifests/vocadito.local.json`
  - `tools/manifests/murmur-golden.local.json`
- pitch maps:
  - `tools/pitch-maps/humtrans.local.json`
  - `tools/pitch-maps/vocadito.local.json`
  - `tools/pitch-maps/murmur-golden.local.json`

Recommended Murmur golden-set folders on disk:

- `familiar/`
- `pitch-weak/`
- `urgent/`
- `repair/`
- `glide/`
- `wobble/`
- `noisy/`
- `clipped/`

This mirrors the reasoning categories already used in the synthetic audit.

## 6. What this does not solve

This helper does not:

- download datasets for us;
- parse every academic annotation format automatically;
- decide the perfect threshold;
- replace an internal Murmur eval set.

It only removes the mechanical friction between "dataset on disk" and "same
audit loop Murmur already trusts".

## 7. Preset helper for public datasets

The worker now also includes a narrow preset helper:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py vocadito --describe --pretty
```

This is not a dataset platform.

It only codifies the two public-dataset presets we currently care about:

- `vocadito`
- `humtrans`

### 7.1 vocadito

`vocadito` is small enough to fetch directly.

Current source wired into the helper:

- `https://zenodo.org/api/records/5578807/files/vocadito.zip/content`

Example:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py vocadito \
  --download \
  --extract \
  --limit 24 \
  --pretty
```

That will:

1. download the archive into `tools/datasets/`;
2. extract it under `tools/datasets/vocadito/`;
3. build `tools/manifests/vocadito.local.json`;
4. build `tools/pitch-maps/vocadito.local.json`.

The helper also parses `Annotations/Notes/*_notesA1.csv` by default and injects:

- `expected_pitches`
- derived `expected_min_notes`
- tags like `annotated` and `a1`
- octave-equivalent `expected_pitch_sets` for both `A1` and `A2`, so
  `vocadito` can stay useful as a contour / segmentation regression suite even
  when Murmur normalizes a low-register phrase by a full octave

Important path convention:

- preset-built manifest paths are relative to the dataset root;
- for `vocadito`, that means entries look like `Audio/vocadito_1.wav`, not just
  `vocadito_1.wav`;
- this keeps the generated manifest compatible with the closure config and the
  full extracted dataset tree.

### 7.2 HumTrans

`HumTrans` is intentionally treated more carefully because the public audio zip
is large.

Current source wired into the helper:

- `https://huggingface.co/datasets/dadinghh2/HumTrans/resolve/main/all_wav.zip`

As of 2026-06-05, the remote header reports a payload around `14.7 GB`, so the
helper refuses to download it unless you opt in explicitly.

Use it in one of two ways:

1. point at an already extracted local subset:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py humtrans \
  --root /absolute/path/to/humtrans_subset \
  --limit 32 \
  --pretty
```

2. or explicitly allow the full-archive download:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py humtrans \
  --download \
  --allow-large-download \
  --extract \
  --limit 32 \
  --pretty
```

The second path is meant for deliberate local research work, not for casual
bootstrap on every machine.

### 7.3 Recommended HumTrans staging flow

For day-to-day Murmur work, the better path is usually:

1. keep the full extracted HumTrans archive somewhere outside the repo;
2. use the official split keys JSON to choose a principled `train`, `valid`,
   or `test` slice;
3. copy only a tiny subset into `workers/audio-engine/tools/datasets/humtrans/`;
4. let the normal closure config pick it up automatically.

Example:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py humtrans \
  --root /absolute/path/to/humtrans_full_extract \
  --split valid \
  --limit 32 \
  --stage-root /Users/dujiayi/murmur/workers/audio-engine/tools/datasets/humtrans \
  --stage-clean \
  --manifest-out /Users/dujiayi/murmur/workers/audio-engine/tools/manifests/humtrans.local.json \
  --pitch-map-out /Users/dujiayi/murmur/workers/audio-engine/tools/pitch-maps/humtrans.local.json \
  --name-mode relative \
  --pretty
```

If you only have the large local zip and do **not** want to extract the whole
thing first, stage a subset straight from the archive:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py humtrans \
  --archive /absolute/path/to/humtrans-all_wav.zip \
  --split valid \
  --limit 32 \
  --split-keys /absolute/path/to/train_valid_test_keys.json \
  --stage-root /Users/dujiayi/murmur/workers/audio-engine/tools/datasets/humtrans \
  --stage-clean \
  --manifest-out /Users/dujiayi/murmur/workers/audio-engine/tools/manifests/humtrans.local.json \
  --name-mode relative \
  --pretty
```

If you also have `all_midi.zip`, add it so the staged subset carries reference
pitch sketches into Murmur's audit manifest:

```bash
cd workers/audio-engine
./.venv/bin/python tools/prepare_public_dataset.py humtrans \
  --archive /absolute/path/to/humtrans-all_wav.zip \
  --midi-archive /absolute/path/to/humtrans-all_midi.zip \
  --split valid \
  --limit 32 \
  --split-keys /absolute/path/to/train_valid_test_keys.json \
  --stage-root /Users/dujiayi/murmur/workers/audio-engine/tools/datasets/humtrans \
  --stage-clean \
  --manifest-out /Users/dujiayi/murmur/workers/audio-engine/tools/manifests/humtrans.local.json \
  --pitch-map-out /Users/dujiayi/murmur/workers/audio-engine/tools/pitch-maps/humtrans.local.json \
  --name-mode relative \
  --pretty
```

What this gives us:

- a closure-friendly local subset under the expected workspace path;
- a manifest that already matches the checked-in `humtrans_local` suite;
- a way to rotate between `train` / `valid` / `test` without copying the full
  archive into the repo workspace.
- an archive-first path when disk or time makes full extraction annoying.
- a route to reference pitch sequences through HumTrans MIDI files, so pitch
  match becomes less guessy than pure listening-based review.

What it does **not** do:

- it does not download the 14.7 GB audio archive unless you ask it to;
- it does not turn HumTrans into a product dependency;
- it does not pretend the first 32 files are enough for full acceptance.

The point is narrower: make real humming coverage practical enough that we
actually use it in the local closure loop.

If you want to validate only the current HumTrans subset without waiting for
the whole closure stack, run:

```bash
bun run audit:audio:humtrans
```

That is the quickest way to answer:

- did the staged subset really land;
- did MIDI references line up with the same audio cases;
- is Murmur weak on humming pitch match or on musical feel.
