# music-engine worker

Local HTTP wrapper around [Magenta RealTime 2](https://github.com/magenta/magenta-realtime)
(MLX backend, Apple Silicon). Murmur's vibe cards call this through
`/api/music/generate` to turn randomized text prompts — optionally blended
with the user's hum — into real audio clips.

## Setup

```bash
bun run setup:music   # uv venv + magenta-rt[mlx] + model download (~4 GB)
bun run dev:music     # uvicorn on http://127.0.0.1:8002
```

The model (`MAGENTA_MODEL`, default `mrt2_base`) loads once at startup
(~45 s on an M4 Max) and stays resident; after that an 8-second clip takes
~5 s to generate (faster than real time). Use `mrt2_small` on lower-end
Apple Silicon.

## Endpoints

- `POST /generate` — multipart `prompt`, `duration` (2–30 s), `style_mix`
  (0–0.8), optional `hum` audio file → `audio/wav` 48 kHz stereo.
- `GET /health` — load state; the Next.js app probes this and falls back to
  the legacy Tone.js synth engine when the worker is unreachable.

## Env

| var | default | notes |
| --- | --- | --- |
| `MAGENTA_MODEL` | `mrt2_base` | or `mrt2_small` |
| `MUSIC_WORKER_TOKEN` | _(unset)_ | bearer token, same scheme as audio-engine |
| `MUSIC_ENGINE_MOCK` | _(unset)_ | `1` → sine-chord placeholder clips, no model |
| `MUSIC_ENGINE_PRELOAD` | `1` | `0` → lazy-load on first request |

## Tests

```bash
bun run test:music
```
