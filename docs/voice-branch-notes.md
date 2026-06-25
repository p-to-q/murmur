# Voice Branch Notes

Branch: `codex/local-closure`

This branch carries the local voice-input infra and acceptance scaffold for the
Murmur voice-aware capture path.

What it includes:

- local speech worker baseline for Voice routing
- `POST /api/capture/analyze` voice-first routing
- MiniMax music generation mock/stable storage path for local smoke
- `bun run smoke:voice` as the smallest end-to-end voice acceptance check
- local dev-stack wiring for speech worker + voice input

How to use it:

```bash
bun run dev:stack
bun run smoke:voice
```

Notes:

- Voice remains conservative: noisy or ambiguous input should still fall back
  to Hum.
- The smoke path is intentionally local/self-contained and does not require
  external ASR or MiniMax access.
