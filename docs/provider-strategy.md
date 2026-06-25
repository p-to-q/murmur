# Transcription Strategy

## Stainer Facade

Hum-only transcription still goes through `transcribeWithStainer(input)` from
`src/modules/stainer/transcribe.ts`. The live recording ingress is now
`/api/capture/analyze`, which can route to either Hum or Voice without exposing
provider selection to screens.

The facade now has exactly two paths:

- `input.audioBlob` present: upload to server `/api/capture/analyze`.
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

`POST /api/capture/analyze` accepts multipart audio and optional
`targetInstrument`. When `MURMUR_VOICE_INPUT_ENABLED=1` and `SPEECH_WORKER_URL`
is configured, it asks the local/self-hosted speech worker for VAD, ASR, audio
quality, and model diagnostics through `src/lib/platform/speech-recognition.ts`.
The planned recognition strategy is SenseVoice-first with faster-whisper as the
baseline/fallback after model artifact and corpus acceptance.
Recognized lyrical Chinese/English singing returns:

```ts
{
  kind: "voice";
  lyrics: string;
  language: "zh" | "en" | "unknown";
  confidence: number;
  diagnostics: VoiceRouteDiagnostics;
}
```

Low-confidence, non-lyrical, nonsense-syllable, unconfigured, or failed ASR
cases default to Hum and return:

```ts
{
  kind: "hum";
  transcription: TranscriptionResult;
}
```

This preserves the original demo-safe Hum path while letting Voice become an
additive branch. The Voice branch generates a single whole-song version through
`/api/music/voice-generate` and MiniMax `music-2.6`; it stores the resulting
audio in Murmur object storage before any song record is saved.

`POST /api/transcribe` accepts multipart audio and returns a
`TranscriptionResult`:

```ts
{
  provider: "rmvpe" | "swiftf0" | "pyin" | "yin" | "parselmouth" | "fixture";
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
MURMUR_VOICE_INPUT_ENABLED=0
SPEECH_WORKER_URL=http://127.0.0.1:8003
SPEECH_WORKER_TOKEN=
SPEECH_RECOGNITION_PROVIDER=worker
SPEECH_WORKER_TIMEOUT_MS=8000
SPEECH_WORKER_PRIMARY_PROVIDER=sensevoice
SPEECH_WORKER_FALLBACK_PROVIDER=faster-whisper
SPEECH_WORKER_REQUIRE_ARTIFACT_LICENSE=1
SPEECH_WORKER_MODEL_ARTIFACT=
SPEECH_WORKER_MODEL_SHA=
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
MINIMAX_MUSIC_MODEL=music-2.6
MINIMAX_MUSIC_API_URL=https://api.minimax.io/v1/music_generation
```

No transcription URL is exposed as `NEXT_PUBLIC_*`. The browser product flow
does not pick providers and does not call the worker directly. The hidden Melo
Lab also defaults to the product auto route; its loopback-only test API still
accepts a request-level `pitchProvider` for low-level diagnostics, but the Lab
client and UI send `auto` and do not expose detector selection. Production test
APIs still require `MURMUR_ENABLE_MELO_LAB=1` and never route to the product
worker.

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

The next Phase 1 stops deepen the implementation behind the same route:

1. worker rename/containerization under `workers/audio-engine/`;
2. silence trim and optional DeepFilterNet-family denoise;
3. RMVPE primary detection with SwiftF0 / pYIN fallback through the
   `audio_engine.detectors` provider seam, plus lab-only YIN/Parselmouth
   comparison providers;
4. worker-native diagnostics for `snr`, `voicedRatio`, `denoiseProvider`,
   `denoiseModel`, `denoiseMs`, `pitchMs`, `providerPitchMs`, selection
   diagnostics, and `polishMs`.

The contract above stays stable while the algorithm improves.
