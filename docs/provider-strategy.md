# Transcription Strategy

## Stainer Facade

All UI calls `transcribeWithStainer(input)` from
`src/modules/stainer/transcribe.ts`. Screens do not import providers directly.

The facade now has exactly two paths:

- `input.audioBlob` present: upload to server `/api/transcribe`.
- `input.audioBlob` absent: use `fixture` for the explicit demo melody.

This is the Phase 1 boundary cut. Real recordings never fall through to fixture
inside the browser.

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
  provider: "swiftf0" | "pyin";
  rawNotes: MelodyNote[];
  cleanMelody: CleanMelody;
  warnings: string[];
  diagnostics: {
    duration: number;
    snr: number | null;
    voicedRatio: number | null;
    denoiseMs?: number;
    denoiseProvider?: "off" | "deepfilternet";
    denoiseModel?: string | null;
    pitchMs?: number;
    polishMs?: number;
    workerMs?: number;
    targetInstrument?: string;
    rangeClampApplied?: boolean;
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
AUDIO_ENGINE_DENOISE_PROVIDER=auto

# Optional legacy alias for older local PYIN worker setups.
BASIC_PITCH_WORKER_URL=
```

No transcription URL is exposed as `NEXT_PUBLIC_*`. The browser does not pick
providers and does not call the worker directly.

## Worker Roadmap

The current worker defaults to `auto`: SwiftF0 primary with pYIN fallback.
It also has an independent denoise provider seam selected by
`AUDIO_ENGINE_DENOISE_PROVIDER`:

- `off`: skip denoise and keep the lightweight worker path.
- `auto`: use DeepFilterNet when the optional PyTorch stack is installed,
  otherwise return raw audio with a `deepfilternet_unavailable:*` warning.
- `deepfilternet`: require DeepFilterNet and fail loudly when dependencies or
  model files are missing.

The next Phase 1 stops deepen the implementation behind the same route:

1. worker rename/containerization under `workers/audio-engine/`;
2. silence trim and optional DeepFilterNet-family denoise;
3. SwiftF0 primary detection with pYIN fallback through the
   `audio_engine.detectors` provider seam;
4. worker-native diagnostics for `snr`, `voicedRatio`, `denoiseProvider`,
   `denoiseModel`, `denoiseMs`, `pitchMs`, and `polishMs`.

The contract above stays stable while the algorithm improves.
