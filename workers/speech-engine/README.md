# Murmur Speech Engine

Local/self-hosted speech worker for Voice-aware capture.

This worker owns the speech-side contract only:

- VAD / vocal activity diagnostics
- ASR diagnostics
- audio quality diagnostics
- normalized text/language/confidence response for Murmur's conservative
  Hum-or-Voice router

It intentionally does not generate music and does not replace
`workers/audio-engine`, which remains the Hum melody transcription worker.

## Local Dev

```bash
bun run setup:speech
bun run dev:speech
```

`bun run dev:stack` starts this worker on `127.0.0.1:8003` alongside the
audio worker, music worker, and Next.js app.

## Modes

- `SPEECH_ENGINE_MOCK_TEXT` forces a deterministic transcript for contract tests
  and local plumbing checks.
- Without mock text, the worker uses a local `faster-whisper` baseline. If the
  runtime or model is unavailable, it falls back to a conservative Hum-shaped
  empty transcript instead of failing the product path.

## Routes

`GET /health`

Returns worker readiness and configured provider metadata.

`POST /analyze-speech`

Multipart form:

- `audio`: required file

Response shape matches `src/lib/platform/speech-recognition.ts`.

## Auth

`SPEECH_WORKER_TOKEN` is required in production or when bound outside loopback.
Local loopback development can run without a token.
Set `SPEECH_ENGINE_HOST=127.0.0.1` for local dev so the auth guard stays
explicit; set a non-loopback host only when you intentionally expose the
worker.

## Provider Roadmap

See [../../docs/voice-input-local-research.md](../../docs/voice-input-local-research.md).

Planned provider order:

1. faster-whisper baseline and fallback
2. SenseVoice provider through a pinned production-acceptable artifact
3. optional sherpa-onnx or GGUF/llama.cpp runtime path
