# Music Quality Operations

Status: active phase-one runbook<br>
Owner: music systems / on-call maintainer<br>
Last verified: 2026-07-19

Use this runbook when generated clips sound wrong, arrive damaged, or consume
unexpected GPU time. The durable `music_jobs` row is the investigation anchor.

## Current contract

The durable jobs path records one stable Murmur job id and one RunPod job id.
The RunPod handler returns hashes proving which prompt, melody, hum, duration,
and style mix it received without returning source material. It generates up to
`MUSIC_QUALITY_MAX_ATTEMPTS` candidates (default `2`) and rejects corrupt,
silent, mostly silent, severely clipped, DC-heavy, or wrong-duration WAVs.

The Web runner independently reparses the WAV. During a rolling Worker upgrade,
missing receipts are reported as `qualityEvidence=legacy_missing` while the Web
WAV Gate remains active. After deployment warm-up proves the versioned receipt,
set `MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED=1`; receipt mismatches or missing
evidence then fail closed. A rejected durable result ends as `failed` with
`error_code=music_quality_rejected` and uses the existing idempotent refund path.

This is a technical Gate. It prevents objectively broken delivery, but does not
yet score melody faithfulness, harmony, structure, timbre, or musical appeal.

## Correlation

Start with `music_jobs.id`, then inspect:

- `operation_id` and `input->>'generationBatchId'` for client/batch identity;
- `provider_job_id` for RunPod logs;
- `status`, `error_code`, and timestamps for queue/settlement state;
- `output->'quality'` for the Web-side Gate result;
- `output->'diagnostics'` for candidate count, Worker timing, runtime identity,
  and optional estimated cost.

Structured events use the same job id: `music.job_provider_attached`,
`music.job_provider_status`, `music.quality_gate_passed`,
`music.quality_gate_failed`, and `music.job_advance_failed`.

Never put raw prompts, melody arrays, hum bytes, or audio base64 into logs.

## Cost monitoring

Set `RUNPOD_GPU_USD_PER_SECOND` in the Web runtime to the effective endpoint
rate. The runner stores `estimatedCostUsd = workerWallMs / 1000 * rate` and
emits it with the pass event. If absent, runtime evidence remains and cost is
`null`. This is monitoring only; it must not reject or downgrade generation.

Reconcile estimates against the RunPod invoice weekly. Idle workers,
network-volume charges, retries, and provider rounding are not fully represented
by per-job wall time. Track pass/fail rate by model and Gate version, p50/p95
Worker time, candidate-count distribution, cost per delivered clip, and cost of
failed/refunded clips.

## Safe rollout

1. Merge/build the SHA-tagged music Worker image.
2. Deploy that image to RunPod and drain old warm workers when necessary.
3. Run `bun run deploy:music-serverless` with warm-up enabled. The script checks
   the request receipt and `music-technical-v1` result, not only RunPod status.
4. Only after that proof may the script set
   `MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED=1` in Vercel.
5. Release the exact `main` SHA through the repository's **Release
   (production)** workflow; the Worker deploy script does not deploy Web code.
6. Verify a real generation and inspect `qualityEvidence=verified` before
   treating the rollout as complete.

Do not enable strict evidence manually before the Worker endpoint is verified.
Web and Worker releases are separate systems and GitHub workflows may run in
parallel.

## Dataset evaluation

Keep technical online gating separate from offline musical evaluation.
Transcription evaluation remains owned by
[audio-dataset-ingestion.md](../audio-dataset-ingestion.md) and the
`audit:audio:*` commands. Music generation needs a versioned internal set
covering clean/noisy hums, sparse/dense melodies, every Vibe family, short/long
clips, and known historical failures.

Every benchmark row must identify dataset version, source commit, model, Gate
version, prompt-template version, conditioning settings, provider job id, and
candidate number. Report technical pass rate separately from human 1-5 ratings
for melody match, musicality, arrangement coherence, artifacts, and preference.

Do not tune thresholds on production complaints alone. Promote a failure into
the consent-safe evaluation set, label it, reproduce it, then compare releases
on the frozen set.

## Incident triage

1. Find the Murmur and RunPod job ids.
2. Confirm the input receipt matched. A mismatch is a protocol/release issue.
3. Check candidate count and technical failures.
4. Compare generation time with Worker wall time; a large gap points to queue,
   startup, serialization, or runtime interference.
5. If technical checks pass but audio sounds bad, attach consent-safe
   `song.feedback` and add it to offline review.
6. Roll back the Worker image or conditioning configuration when one release or
   runtime fingerprint owns the regression.

## Phase-one limits

- Failed Worker candidate diagnostics live in structured error logs; delivered
  diagnostics persist in `music_jobs.output`.
- Browser polling still advances durable jobs; there is no dispatcher yet.
- The Gate is signal-level, not perceptual or melody-aware.
- Cost is an estimate until provider billing export is reconciled.

Add an append-only `music_job_attempts` table only after production evidence
shows failed-attempt retention cannot be served by the chosen log backend.
