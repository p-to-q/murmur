# Phase 1 Plan — Server Transcription Boundary

Date: 2026-06-03

## User / System Problem

Real hums can still disappear into a browser-side provider chain and silently
become fixture melodies. Before deepening DeepFilterNet and SwiftF0, the
product needs one honest server boundary: real audio either returns a scored
melody with diagnostics or returns a visible retry/demo error.

## Real Constraints

- The full worker upgrade is not shippable as a fake local stub. The current
  Python worker must stay honest about which providers are actually installed,
  so this slice accepts pYIN fallback while enabling SwiftF0 and denoise behind
  explicit provider seams.
- The root Next app remains under `src/`; no `apps/web` move in Phase 1.
- Hum UI can receive only contract-required affordances: explicit demo and
  couldn't-hear-that retry state.
- Demo-safe local usage still matters when `AUDIO_WORKER_URL` is absent.

## Stable Behavior

- Explicit demo melody continues to produce vibe versions.
- `Hum -> Vibe -> Studio` remains intact once transcription succeeds.
- The fixture provider is still available, but only when the caller sends no
  audio blob.

## Stops / PRs

1. **Server route contract.** Recreate `POST /api/transcribe` as a Next route
   that validates multipart audio, calls a server-only audio-worker adapter,
   polishes/clamps raw worker notes when needed, and returns diagnostics.
2. **Client facade cutover.** Collapse Stainer live transcription to the server
   route; keep fixture only for explicit demo.
3. **Hum affordances.** Add a non-recording demo control and a couldn't-hear
   retry state that does not masquerade as mic permission failure.
4. **Dead provider removal.** Delete browser YIN, browser Basic Pitch, remote
   Python provider-chain config, and public transcription env vars.
5. **Tests/docs.** Add route/adapter smoke coverage where possible and update
   env/provider docs to name `AUDIO_WORKER_URL` as server-only.

## Validation

- `bun test`
- `bun run lint`
- `bun run build`
- Browser smoke on Hum, Gallery, and Me when the worker is unconfigured.

## Done Checklist

- [x] Real audio never falls through to fixture.
- [x] `/api/transcribe` returns 422 for unusable audio and 503 for missing
      worker configuration.
- [x] Public transcription provider env vars are removed from runtime docs/env.
- [x] Fixture remains reachable through an explicit demo action.
- [x] Logs include worker/provider/timing diagnostics.

## Shipped

- Recreated `POST /api/transcribe` as a server-authoritative route with
  multipart validation, request IDs, structured logs, target-instrument
  validation, and explicit 503/422 error semantics.
- Added `src/lib/platform/audio-worker.ts` as the server-only worker adapter.
  It accepts both legacy pYIN `{ notes, source }` and v2
  `{ rawNotes, provider, diagnostics }` responses, then polishes and clamps
  melody notes to the requested instrument.
- Collapsed live Stainer transcription to `/api/transcribe`; fixture now runs
  only when the caller omits `audioBlob`.
- Added the Hum explicit demo affordance and separated "mic unavailable" from
  "couldn't hear that" retry state.
- Added real input-level feedback during recording using the existing analyser
  path, including a quiet-input hint after sustained low signal.
- Added client-side head/tail silence trim before upload. The browser decodes
  the recording, trims low-RMS leading/trailing silence with 250 ms padding,
  uploads mono WAV, and falls back to the original blob if decoding fails.
- Removed browser YIN / browser Basic Pitch / remote Python provider-chain
  files and the MeScreen provider-debug list.
- Renamed and containerized the Python worker at `workers/audio-engine/`.
  The current implementation is still pYIN fallback, but now returns v2-shaped
  diagnostics, trims silence, has an octave-blip guard, enforces size/duration
  limits, and supports optional bearer auth.
- Extracted the worker's frame-to-note segmentation into
  `workers/audio-engine/audio_engine/frames.py` and added CI-covered Python
  unit tests for MIDI conversion, octave-blip suppression, silence filtering,
  and note segmentation.
- Added a full worker integration lane, `bun run test:audio:full`, with
  synthetic WAV fixtures covering decode-to-mono/resample, silence trim, and
  pYIN note extraction. CI installs `workers/audio-engine/requirements.txt`
  before running it.
- Added `audio_engine.detectors` and `audio_engine.pyin_provider` so pYIN is
  now a pluggable detector provider selected by `AUDIO_ENGINE_PITCH_PROVIDER`.
- Added `audio_engine.swift_f0_provider` and the `swift-f0` runtime dependency.
  The worker now defaults to `AUDIO_ENGINE_PITCH_PROVIDER=auto`, which runs
  SwiftF0 first and falls back to pYIN when SwiftF0 is unavailable or returns
  no usable notes.
- Added `audio_engine.denoise` and `AUDIO_ENGINE_DENOISE_PROVIDER`. The worker
  now supports `off`, `auto`, and explicit `deepfilternet`; `auto` preserves
  local demos by falling back to raw audio with a warning when optional
  DeepFilterNet/PyTorch dependencies are absent, while explicit
  `deepfilternet` fails loudly.
- Added optional `workers/audio-engine/requirements-denoise.txt` for
  denoise-enabled deployments. Research validation found
  `deepfilternet==0.5.6` requires a separately installed PyTorch/torchaudio
  stack and works with `torch==2.5.1` / `torchaudio==2.5.1`.
- Updated `.env.example`, README, provider strategy, verification notes, and
  worker path docs.

## Validation Evidence

- `bun test` passed.
- `bun run lint` passed.
- `bun run build` passed.
- `python3 -m py_compile workers/audio-engine/main.py` passed.
- `bun run test:audio` passed.
- `bun run test:audio:full` skips cleanly when runtime deps are absent.
- `/tmp` venv full worker validation passed after installing
  `workers/audio-engine/requirements.txt`.
- `/tmp` venv validation also confirmed the real SwiftF0 auto provider path
  on a synthetic hum fixture.
- `/tmp` Python 3.11 venv validation confirmed the official DeepFilterNet API
  (`df.enhance.init_df` / `enhance`) with pinned torch/torchaudio, including a
  synthetic noisy tone enhancement call that returned finite worker-rate audio.
- Browser smoke:
  - `/` renders with explicit `示例旋律` / `Try demo` action.
  - Demo action reaches Vibe cards.
  - `/me` shows `Server Audio Engine` instead of the old provider chain.
  - `curl -F audio=@... /api/transcribe` returns `503 worker_unconfigured`
    when `AUDIO_WORKER_URL` is absent.

## Carry-Forward

- DeepFilterNet is optional and not installed in the base worker deps; deploy
  with `requirements-denoise.txt` and
  `AUDIO_ENGINE_DENOISE_PROVIDER=deepfilternet` when denoise is required.
- Need real recorded audio fixture/golden tests; current full worker tests use
  synthetic WAV fixtures.
- Need real recorded DeepFilterNet golden fixtures; current denoise full test
  is synthetic and skips when optional deps are absent.
