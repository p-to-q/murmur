# Speech Engine Model Artifacts

No production model artifact is bundled yet.

The current worker ships with a baseline local `faster-whisper` path and a
mock-only test mode. Before enabling `MURMUR_VOICE_INPUT_ENABLED=1` for a
broader audience, pin the exact production artifact here and check it against a
corpus acceptance report.

```text
provider:
runtime:
artifact:
sha256:
license:
license_source:
model_card:
accepted_report:
```

Current intended candidates:

- `Systran/faster-whisper-small` or another faster-whisper-compatible model as
  baseline/fallback.
- `FunAudioLLM/SenseVoiceSmall-GGUF`, only after the Apache-2.0 artifact claim
  and deployment path are reviewed and pinned.

The production env audit requires `SPEECH_WORKER_MODEL_ARTIFACT` and
`SPEECH_WORKER_MODEL_SHA` when Voice input is enabled.
