# Music Quality Operations

Status: active phase-one runbook<br>
Owner: music systems / on-call maintainer<br>
Last verified: 2026-07-30

Use this runbook when generated clips sound wrong, arrive damaged, or consume
unexpected GPU time. The durable `music_jobs` row is the investigation anchor.

## Current contract

The durable jobs path records one stable Murmur job id and one RunPod job id.
The RunPod handler returns hashes proving which prompt, melody, hum, duration,
and style mix it received without returning source material. It generates up to
`MUSIC_QUALITY_MAX_ATTEMPTS` candidates (default `2`) and rejects corrupt,
silent, low-average-level, severely clipped, DC-heavy, wrong-duration,
peak-dominated, excessively fragmented, or long-dropout WAVs. Candidate one
uses the configured Magenta sampling parameters; retries use a versioned,
more-conservative temperature/top-k recovery policy so they do not merely
repeat the same fixed JAX sampling trajectory.

Requested conditioning is fail-closed. A hum that cannot be decoded/embedded,
or a melody with no usable in-range notes, returns `conditioning_failed`
instead of silently falling back to text-only generation. The Worker reports
applied style mix, conditioned frame coverage, onset/segment counts, CFG,
sampling parameters, candidate/audio digests, pre-normalization level, and
normalization gain. The Web verifies the applied conditions and final digest.

The Web runner independently reparses the WAV. The Worker returns temporary
N/N-1 compatibility envelopes: old Web reads receipt/Gate v1 while new Web
prefers receipt/Gate v2 and verifies candidates. During a rolling upgrade,
missing receipts are reported as `qualityEvidence=legacy_missing` while the Web
WAV Gate remains active. `MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED=1` requires at
least a v1 receipt; only set `MURMUR_MUSIC_V2_EVIDENCE_REQUIRED=1` after a v2
SHA endpoint passes full warm-up. A rejected durable result ends as `failed` with
`error_code=music_quality_rejected` and uses the existing idempotent refund path.

This is a technical and execution-integrity Gate. It prevents objectively
broken delivery and proves requested conditioning was applied, but does not yet
score melody faithfulness, harmony, long-range structure, timbre, or appeal.
Interior quiet-gap counts are evidence only: normal rests can look identical to
transport dropouts, so they must not hard-reject a clip without stronger context.

## Correlation

Start with `music_jobs.id`, then inspect:

- `operation_id` and `input->>'generationBatchId'` for client/batch identity;
- `input->>'originRequestId'` for the bounded creation-request identity;
- `provider_job_id` for RunPod logs;
- `status`, `error_code`, and timestamps for queue/settlement state;
- `output->'quality'` for the Web-side Gate result;
- `output->'diagnostics'` for candidate count, Worker timing, runtime identity,
  sanitized input receipt, per-candidate digest/sampling/conditioning evidence,
  pre-normalization levels, and optional estimated cost.

Structured events use the same job id: `music.job_provider_attached`,
`music.job_provider_status`, `music.quality_gate_passed`,
`music.quality_gate_failed`, and `music.job_advance_failed`.

Never put raw prompts, melody arrays, hum bytes, or audio base64 into logs.
New durable jobs persist the hum digest, then eagerly delete the temporary hum
after RunPod acknowledges submission. Configure an object-store lifecycle rule
that permanently deletes the `tmp/` prefix after 24 hours as a crash/orphan
fallback; `Cache-Control` is not deletion. Verify that lifecycle rule in each
production region before claiming the 24-hour retention bound.

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

1. Release the compatibility Web build that accepts both v1 and v2 envelopes.
2. Build the exact SHA-tagged Worker image; mutable tags are not deployable.
3. Run `bun run deploy:music-serverless`. It creates a SHA-specific endpoint,
   then proves hum + melody conditioning, candidate digest, WAV, Gate and
   `engine_revision` before changing any Vercel environment variable.
4. Only after that proof may the script set the endpoint id and both evidence
   requirements in Vercel. The old endpoint remains the rollback target.
5. Release the exact same `main` SHA through the repository's **Release
   (production)** workflow; the Worker deploy script does not deploy Web code.
6. Verify a real generation and inspect `qualityEvidence=verified` before
   treating the rollout as complete.

Do not enable v2 evidence manually before the Worker endpoint is verified. Web
and Worker releases are separate systems and GitHub workflows may run in
parallel; the compatibility envelopes make N/N-1 safe, but not arbitrary older
versions. Remove them only in a later, separately observed protocol cleanup.

## Dataset evaluation

Keep technical online gating separate from offline musical evaluation. Use four
layers: deterministic technical Gate, conditioning-applied Gate, asynchronous
shadow metrics, then frozen-dataset plus human release evaluation.
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

Initial shadow candidates are FFmpeg EBU R128/true peak and channel statistics,
plus librosa chroma/DTW melody alignment. CLAP may help prompt/audio ranking but
is not an audio-quality judge; FAD is release/dataset-level and must never gate
a single clip. Review Essentia's AGPL/commercial licensing before adoption.

## Incident triage

1. Find the Murmur and RunPod job ids.
2. Confirm the input receipt matched. A mismatch is a protocol/release issue.
3. Confirm applied style mix, melody coverage, CFG, sampling parameters, and
   candidate digest. Duplicate digests point to a retry-diversity failure.
4. Compare pre-normalization RMS/peak with normalization gain. A large gain or
   crest factor points to weak model output or a spike-dominated candidate.
5. Check candidate count and technical failures.
6. Compare generation time with Worker wall time; a large gap points to queue,
   startup, serialization, or runtime interference.
7. If technical checks pass but audio sounds bad, attach consent-safe
   `song.feedback` and add it to offline review.
8. Roll back the Worker image or conditioning configuration when one release or
   runtime fingerprint owns the regression.

## Phase-one limits

- Failed Worker candidate diagnostics live in structured error logs; delivered
  diagnostics persist in `music_jobs.output`.
- Browser polling still advances durable jobs; there is no dispatcher yet.
- The Gate is signal/execution-level, not perceptual or melody-similarity aware.
- Structured events are not distributed traces; no Collector, durable metrics
  store, dashboard, or paging backend is claimed by this runbook.
- Cost is an estimate until provider billing export is reconciled.

Add an append-only `music_job_attempts` table only after production evidence
shows failed-attempt retention cannot be served by the chosen log backend.
