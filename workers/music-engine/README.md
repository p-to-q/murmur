# music-engine worker

Wraps [Magenta RealTime 2](https://github.com/magenta/magenta-realtime) so
Murmur's vibe cards (`/api/music/generate`) can turn randomized text prompts —
optionally blended with the user's hum — into real audio clips.

Two frontends share one backend-agnostic model core (`engine.py`) and one
transport-independent generation/quality pipeline (`pipeline.py`):

- **`main.py`** — local dev HTTP server (FastAPI, MLX backend on Apple Silicon),
  run via `bun run dev:music`.
- **`handler.py`** — production [RunPod Serverless](../../docs/DEPLOY_MUSIC_ENGINE_GPU.md)
  handler (JAX/CUDA), shipped in the Docker image and deployed with
  `bun run deploy:music-serverless`.

## Local setup (dev)

```bash
bun run setup:music   # uv venv + magenta-rt[mlx] + model download (~4 GB)
bun run dev:music     # uvicorn on http://127.0.0.1:8002
```

The model (`MAGENTA_MODEL`, default `mrt2_base`) loads once at startup
(~45 s on an M4 Max) and stays resident; after that an 8-second clip takes
~5 s to generate (faster than real time). Use `mrt2_small` on lower-end
Apple Silicon.

## Endpoints (dev HTTP server)

- `POST /generate` — multipart `prompt`, `duration` (2–30 s), `style_mix`
  (0–0.8), optional `melody` JSON, optional `hum` audio file → `audio/wav`
  48 kHz stereo.
- `GET /health` — load state; local/dev clients can use this before choosing a
  worker path.

In production the app instead calls the RunPod endpoint
(`api.runpod.ai/v2/{id}/run`) with a JSON `{input:{prompt, duration, style_mix,
melody, hum_b64}}` body and gets back `{output:{audio_b64, …}}`; the proxy
routes (`src/app/api/music/*`) speak both protocols. Browser hum uploads are
embedded as style whenever possible; if libsndfile cannot read the incoming
WebM/Opus blob directly, the worker transcodes it through ffmpeg to a temporary
48 kHz WAV before asking Magenta for the hum style embedding.

## Env

| var | default | notes |
| --- | --- | --- |
| `MAGENTA_MODEL` | `mrt2_base` | production highest-spec default; use `mrt2_small` only for constrained local tests |
| `MAGENTA_CFG_NOTES` | `1.5` | melody-conditioning scale; current experiment winner for clear melody without robotic over-control |
| `MAGENTA_TEMPERATURE` | `1.3` | first-candidate sampling temperature; quality retries use a lower versioned recovery value |
| `MAGENTA_TOP_K` | `40` | first-candidate top-k; quality retries use a lower versioned recovery value |
| `MUSIC_WORKER_TOKEN` | _(unset in loopback dev)_ | bearer token, required for deployed/public HTTP workers |
| `MUSIC_WORKER_REQUIRE_AUTH` | _(unset)_ | `1` forces startup to fail when `MUSIC_WORKER_TOKEN` is missing |
| `MUSIC_ENGINE_MOCK` | _(unset)_ | `1` → sine-chord placeholder clips, no model |
| `MUSIC_ENGINE_PRELOAD` | `1` | `0` → lazy-load on first request |
| `MUSIC_QUALITY_MAX_ATTEMPTS` | `2` | generate at most 1–3 candidates until the technical Gate passes |

The serverless handler returns a hashed input receipt and `music-technical-v2`
quality evidence. It rejects requested hum/melody conditioning that cannot be
applied, and retries failed technical candidates inside the same RunPod job
with an explicit conservative sampling policy. Raw prompts, melody arrays, and
hum bytes are not included in diagnostics; candidate/audio digests, applied
conditioning, sampling, runtime revision, and normalization evidence are.
The Web runtime independently applies the same versioned signal checks. Keep
threshold changes synchronized across `quality_gate.py` and
`src/lib/music/music-output-quality.ts`, and bump the Gate version whenever the
acceptance contract changes.

## Tests

```bash
bun run test:music
```
