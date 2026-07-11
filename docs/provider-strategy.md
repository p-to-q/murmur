# Transcription Strategy

## Stainer Facade

All UI calls `transcribeWithStainer(input)` from
`src/modules/stainer/transcribe.ts`. Screens do not import providers directly.

The facade now has exactly three paths:

- `input.audioBlob` present + server reachable: upload to `/api/transcribe`.
- `input.audioBlob` present + server transient failure: fall back to
  browser-side pYIN via Essentia.js WASM (`src/lib/audio/client-pitch-fallback.ts`),
  then run the result through the same melody-polisher + humming-engine pipeline
  (`src/lib/audio/build-client-transcription-result.ts`).
- `input.audioBlob` absent: use `fixture` for the explicit demo melody.

The client fallback architecture is:
```
remote RMVPE (best model, Fly.io)
  → local SwiftF0 (worker-side fallback)
    → client pYIN (browser-side WASM, last resort)
```

This is the current boundary cut. Real recordings never fall through to fixture
inside the browser — they stop at the WASM pYIN layer at worst, preserving a
usable transcription result with a degraded-quality warning.

Before live recordings are uploaded, HumScreen runs a client-side preparation
step:

- decode the recorded blob in Web Audio;
- mix to mono;
- trim sustained low-RMS head/tail silence with 250 ms padding;
- upload mono WAV when trimming succeeds;
- fall back to the original blob when browser decode fails.

This is a capture optimization only. The server worker still trims
defensively and remains authoritative for transcription.

## Server Route

`POST /api/transcribe` accepts multipart audio and returns a
`TranscriptionResult`:

```ts
{
  provider: "rmvpe" | "swiftf0" | "pyin" | "yin" | "parselmouth" | "client_pyin" | "fixture";
  rawNotes: MelodyNote[];
  contour?: TranscriptionContour;
  melodyIntent?: MelodyIntentProfile;
  melodies: TranscriptionMelodies;
  selectedMelodyKind: "intent" | "corrected" | "musical";
  cleanMelody: CleanMelody;
  warnings: string[];
  diagnostics: {
    duration: number;
    snr: number | null;
    voicedRatio: number | null;
    rmsDbfs?: number | null;
    peakDbfs?: number | null;
    clippingRatio?: number | null;
    acceptanceScore?: number | null;
    musicFeelScore?: number | null;
    frameCount?: number;
    decodeMs?: number;
    trimMs?: number;
    denoiseMs?: number;
    denoiseProvider?: "off" | "deepfilternet";
    denoiseModel?: string | null;
    providerPitchMs?: number;
    pitchMs?: number;
    polishMs?: number;
    totalMs?: number;
    rmvpeFrames?: number;
    rmvpeVoicedFrames?: number;
    rmvpeHopMs?: number;
    rmvpeConfidenceThreshold?: number;
    rmvpeDevice?: string;
    rmvpeModel?: string;
    rmvpeExecutionProvider?: string | null;
    workerMs?: number;
    targetInstrument?: string;
    rangeClampApplied?: boolean;
    selectedMelodyKind?: "intent" | "corrected" | "musical";
    noteHypothesis?: string;
    ensembleDecision?: string;
    ensembleSelected?: string;
    providerRerouted?: boolean;
  };
}
```

The route validates size and target instrument, calls the server-only audio
worker adapter, polishes pYIN-style raw-note responses when needed, and clamps
the final melody to the target instrument range.

## Environment

```env
AUDIO_WORKER_URL=http://localhost:8001
AUDIO_WORKER_TOKEN=
AUDIO_ENGINE_PITCH_PROVIDER=auto
AUDIO_ENGINE_RMVPE_MODEL_PATH=
AUDIO_ENGINE_RMVPE_DEVICE=cpu
AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD=0
AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD=0.03
AUDIO_ENGINE_DENOISE_PROVIDER=auto
```

No transcription URL is exposed as `NEXT_PUBLIC_*`. The browser product flow
does not pick providers and does not call the worker directly. The hidden Melo
Lab also defaults to the product auto route; its loopback-only test API still
accepts a request-level `pitchProvider` for low-level diagnostics, but the Lab
client and UI send `auto` and do not expose detector selection. Production test
APIs still require `MURMUR_ENABLE_MELO_LAB=1` and never route to the product
worker.

## Client-side fallback

When the remote worker is unavailable due to a transient failure (network error,
worker unavailable, billing unavailable), Murmur now falls back to browser-side
pYIN pitch detection via Essentia.js WASM (`src/lib/audio/client-pitch-fallback.ts`):

- `essentia.js` is lazy-loaded on first use; never inflates the initial bundle.
- Runs pYIN probabilistic pitch detection at 256-hop / 2048-frame with
  80–800 Hz range and 0.3 voiced threshold.
- Merges adjacent notes within 80 cents to avoid oversegmentation.
- Output is a `ClientPitchResult` with `provider: "client_pyin"`.
- `buildClientTranscriptionResult()` runs the raw notes through the standard
  melody-polisher + humming-engine pipeline to produce a complete
  `TranscriptionResult` — so the rest of the app (Vibe → Studio → Save) sees
  a normal TranscriptionResult regardless of where pitch detection happened.
- Results carry `warnings: ["Transcribed using browser-side pitch detection (degraded quality)"]`.

This is the third tier of a three-tier fallback hierarchy:
```
RMVPE (best, server) → SwiftF0 (worker fallback) → pYIN in WASM (browser last resort)
```

## Worker Roadmap

The current product worker defaults to `auto`: RMVPE primary with SwiftF0 and
pYIN fallback. RMVPE requires a prepared ONNX model path or explicit local
download opt-in; if the model is absent, `auto` continues through the fallback
chain instead of blocking a product request. `AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD`
controls RMVPE voiced-frame gating and should move only after saved Melo Lab
sample review. Explicit `rmvpe`, `swiftf0`,
`pyin`, `yin`, and `parselmouth` requests are diagnostic probes: they stay on
the requested detector and do not silently reroute. The worker also exposes
`yin` and `parselmouth` as light lab providers for local comparison; they do not
participate in the product auto reroute.

Deployment treats the RMVPE ONNX file as a third-party model asset, not a
hidden runtime download. The production Docker image bakes the file during build
and points `AUDIO_ENGINE_RMVPE_MODEL_PATH` at it. The first implementation uses
the MIT-licensed `rmvpe-onnx` wrapper; its default download target is
`lj1995/VoiceConversionWebUI`'s `rmvpe.onnx`, so release review should verify
both wrapper and model-weight licensing before updating production baselines.

It also has an independent denoise provider seam selected by
`AUDIO_ENGINE_DENOISE_PROVIDER`:

- `off`: skip denoise and keep the lightweight worker path.
- `auto`: use DeepFilterNet when the optional PyTorch stack is installed,
  otherwise return raw audio with a `deepfilternet_unavailable:*` warning.
- `deepfilternet`: require DeepFilterNet and fail loudly when dependencies or
  model files are missing.

The next milestones deepen the implementation behind the same route:

1. worker rename/containerization under `workers/audio-engine/`;
2. silence trim and optional DeepFilterNet-family denoise;
3. RMVPE primary detection with SwiftF0 / pYIN fallback through the
   `audio_engine.detectors` provider seam, plus lab-only YIN/Parselmouth
   comparison providers;
4. worker-native diagnostics for `snr`, `voicedRatio`, `denoiseProvider`,
   `denoiseModel`, `denoiseMs`, `pitchMs`, `providerPitchMs`, selection
   diagnostics, and `polishMs`.

The contract above stays stable while the algorithm improves.
