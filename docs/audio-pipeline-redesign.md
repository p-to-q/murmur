# Audio Pipeline: Current Architecture & Redesign Plan

Server-authoritative hum-to-melody pipeline. The browser captures raw
audio; all pitch detection, polishing, and scoring runs server-side.

---

## 1. Pipeline overview

```
Browser capture (webm/opus)
  → POST /api/transcribe
    → audio-engine worker (Python, Fly.io)
      → decode → trim → denoise → pitch detect → segment → score
    ← raw notes + contour + diagnostics
  → polishMelody (TypeScript)
  → range clamp → melody intent → generation variants
  ← TranscriptionResult (cleanMelody, melodies, diagnostics)
```

## 2. Browser capture

- 15-second max recording via `MediaRecorder`
- Output: webm/opus, webm, or mp4
- No client-side denoise; raw mic stream only
- Optional client-side decode + mono mix + silence trim before upload
  (`src/lib/api/transcribe.ts`); falls back to raw blob on decode failure

## 3. Server route (`src/app/api/transcribe/route.ts`)

Validation:
- Audio file present & non-empty (400)
- Size ≤ 2 MB (413)
- `targetInstrument` is valid melody carrier (400)

Billing: notes ledger spend before worker call, refund on failure.

Retry: up to 3 attempts, 20 s per attempt, 40 s total budget.

Route timeout: `maxDuration = 60`.

## 4. Audio worker (`workers/audio-engine/main.py`)

Python FastAPI service on Fly.io. Bearer token auth via
`AUDIO_WORKER_TOKEN`.

### 4.1 Decode & preprocess

- `soundfile` + `pydub` fallback for webm/opus/mp4/wav/m4a
- Converts to **22.05 kHz mono float32**
- Max 30 seconds (413 if exceeded)
- Silence trim: `librosa.effects.trim(y, top_db=38)`, 0.18 s head
  pad, 0.12 s tail pad
- Diagnostics: SNR, RMS dBFS, peak dBFS, clipping ratio

### 4.2 Denoise (optional)

Provider via `AUDIO_ENGINE_DENOISE_PROVIDER`:
- `"off"`: skip
- `"auto"`: DeepFilterNet if available, else passthrough
- `"deepfilternet"`: require it, fail loudly

DeepFilterNet: lazy-loaded model, resamples to model rate → enhance →
resample back to 22.05 kHz.

### 4.3 Pitch detection — ensemble mode

Five detectors, three in the auto chain:

| Detector | Role | Notes |
|---|---|---|
| **RMVPE** | Primary (auto) | ONNX model, GPU-capable, highest quality |
| **SwiftF0** | Fallback #1 (auto) | Lighter, poly-aware but mono output |
| **pYIN** | Fallback #2 (auto) | librosa, reliable legacy fallback |
| YIN | Lab-only | Light reference implementation |
| Parselmouth | Lab-only | PRAAT bridge |

Auto mode tries RMVPE → SwiftF0 → pYIN. Each detector runs
independently; multiple note hypotheses extracted per detector.

**Note hypothesis system:**
- Base: balanced (80 ms min), agile (60 ms), steady (100 ms)
- Rescue: relaxed confidence for pYIN/RMVPE
- Repair: triggered if acceptance score < 0.62
- Proposal: glide, wobble, urgent (contour motion analysis)

**Scoring** (per hypothesis):
- Coverage, confidence, music feel, rhythm coherence
- Fast-path exits if RMVPE/SwiftF0 hit quality thresholds
- Ensemble selection ranks by score with provider tiebreakers

### 4.4 Frame-to-note segmentation (`audio_engine/frames.py`)

Input: frame-level f0, voiced flags, confidence.
Parameters per hypothesis: `min_note_duration`, `onset_confirm_frames`,
`pitch_change_confirm_frames`, `min_confidence`.
Output: `{pitch, start, duration, confidence, velocity}` per note.

### 4.5 Candidate refinement

1. Collapse adjacent same-pitch notes
2. Collapse short wobble detours
3. Redistribute excessive interior holds
4. Regularize urgent phrases (lengthen short notes)

### 4.6 Worker output

```
provider, rawNotes[], contour{timestamps, pitchHz, confidence, voiced},
warnings[], diagnostics{}
```

## 5. Server-side polish (`src/modules/music/melody-polisher.ts`)

Applied in TypeScript after worker returns:

1. Normalize velocities to 0–1
2. Filter: confidence ≥ 0.42, duration ≥ 0.06 s
3. Compact noise bursts (isolated low-confidence blips)
4. Merge adjacent same-pitch (gap ≤ 0.12 s, ±1 semitone)
5. Remove pitch outliers (drift ≥ 10 semitones)
6. Smooth pitch contour (local 3-note average)
7. Detect BPM (IOI-based, `rhythm-engine.ts`)
8. 16th-note quantize (softness 0.22)
9. Revoice quantized durations
10. Infer tonal profile (Krumhansl-style scale fit)
11. Fit notes to scale (snap ±3 semitones)
12. Stabilize cadence (favor root/fifth/third on endings)
13. Final merge (collapse adjacent unison)

Output: `CleanMelody { notes, key, scale, bpm, duration, contour }`.

## 6. Range clamp & melody intent

- `clampMelody()`: clamp each note to `targetInstrument` valid range
- `buildMelodyIntentProfile()`: analyze raw vs polished, infer user
  intent (skeleton, tonal candidates, stable anchors, phrase endings)
- `buildTranscriptionMelodies()`: three variants — intent, corrected,
  musical
- `chooseGenerationMelodyKind()`: selects which variant to use

## 7. Fixture/demo fallback

Only when `audioBlob` is absent (explicit demo action, not failed
transcription). Five preset melodies go through the same polish →
intent/corrected/musical pipeline. Lives in
`src/modules/stainer/providers/fixture.ts`.

## 8. Key constants

| Constant | Value | Location |
|---|---|---|
| Working sample rate | 22,050 Hz | Worker |
| Pitch range | 75–1,050 Hz | Worker |
| Frame hop | 512 samples (23.2 ms) | Worker |
| Max audio | 2 MB / 30 s | Route + Worker |
| Min note duration | 80 ms (balanced) | Worker |
| Confidence filter | ≥ 0.42 | Polisher |
| Duration filter | ≥ 0.06 s | Polisher |
| Quantize softness | 0.22 | Polisher |
| Adjacent merge gap | ≤ 0.12 s | Polisher |

## 9. Environment variables

**Route:**
- `AUDIO_WORKER_URL` (required for production)
- `AUDIO_WORKER_TOKEN` (optional bearer auth)

**Worker:**
- `AUDIO_ENGINE_PITCH_PROVIDER`: auto | rmvpe | swiftf0 | pyin | yin | parselmouth
- `AUDIO_ENGINE_RMVPE_MODEL_PATH`: path to .onnx
- `AUDIO_ENGINE_RMVPE_DEVICE`: cpu | cuda
- `AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD`: 1 to auto-download
- `AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD`: 0–1, default 0.03
- `AUDIO_ENGINE_DENOISE_PROVIDER`: auto | off | deepfilternet

**Capture (optional):**
- `MURMUR_CAPTURE_HUMS`: 0 | 1
- `MURMUR_CAPTURE_DIR`: default ~/Documents/murmur-hums
- `MURMUR_CAPTURE_MAX_FILES`: default 3000

## 10. Error codes

| Code | Status | Phase |
|---|---|---|
| `audio_required` | 400 | validate |
| `audio_too_large` | 413 | validate |
| `validation_error` | 400 | validate |
| `insufficient_notes` | 402 | billing |
| `billing_unavailable` | 503 | billing |
| `no_voiced_frames` | 422 | worker |
| `worker_unconfigured` | 503 | worker |
| `worker_http_error` | 503 | worker |
| `worker_invalid_response` | 503 | worker |
| `server_error` | 500 | route |

## 11. Redesign direction

Remaining work from the original redesign plan:

1. **Streaming pipeline** — stream transcription results as frames
   arrive instead of batch-after-recording. Enables progressive vibe
   preview during capture (see `project-streaming-pipeline` memory).

2. **Client-side pYIN fallback** — Essentia.js in the browser as a
   graceful degradation path when the server worker is unavailable or
   latency is too high (see `project-swift-f0-fallback` memory).

3. **Structured diagnostics API** — expose pipeline diagnostics to a
   `/me/debug` overlay for development and support triage.

4. **Capture-side silence detection** — detect silence client-side to
   stop recording early and reduce upload size.

See also:
- [diagnosis-2026-06.md](archive/diagnosis-2026-06.md) — factual state audit
- [research-2026-06.md](archive/research-2026-06.md) — external research notes
- [execution-roadmap.md](execution-roadmap.md) — phase sequencing
