# Murmur

Murmur is a humming-to-song studio. A user hums a sketch, the system
transcribes and polishes it into a melody, generates several vibe-led
arrangements, then lets the user refine, preview, save, and export the result
as audio, visuals, share HTML, and an audio-backed shareable video
(MP4 when supported, WebM as fallback).

## For Judges

If you are reviewing this repo with a code bot judge or a design bot judge,
start here:

- Product + design + engineering overview:
  [docs/judges-guide.md](./docs/judges-guide.md)
- Runtime architecture:
  [docs/architecture.md](./docs/architecture.md)
- Runtime surfaces:
  [docs/runtime-surfaces.md](./docs/runtime-surfaces.md)
- Delivery cadence:
  [docs/delivery-cadence.md](./docs/delivery-cadence.md)
- Engineering principles:
  [docs/engineering-principles.md](./docs/engineering-principles.md)
- Review gates:
  [docs/review-gates.md](./docs/review-gates.md)
- Workflow contract:
  [WORKFLOW.md](./WORKFLOW.md)
- Packaging and release:
  [docs/packaging-and-release.md](./docs/packaging-and-release.md)
- Melody, arrangement, and render pipeline:
  [docs/music-engine.md](./docs/music-engine.md)
- Humming engine v2 direction:
  [docs/humming-engine-v2.md](./docs/humming-engine-v2.md)
- Humming research landscape + borrowing plan:
  [docs/humming-research-landscape.md](./docs/humming-research-landscape.md)
- Audio-engine borrowing deltas:
  [docs/audio-engine-borrowing-deltas.md](./docs/audio-engine-borrowing-deltas.md)
- Audio-system closure, fallback, datasets, and supportability:
  [docs/audio-system-closure.md](./docs/audio-system-closure.md)
- Audio architecture loop:
  [docs/audio-architecture-loop.md](./docs/audio-architecture-loop.md)
- Audio dataset ingestion:
  [docs/audio-dataset-ingestion.md](./docs/audio-dataset-ingestion.md)
- Provider and transcription fallback strategy:
  [docs/provider-strategy.md](./docs/provider-strategy.md)
- Verification notes:
  [docs/verification.md](./docs/verification.md)

## What We Tried To Make Deliberately

- A creation flow with a clear emotional arc:
  `Hum -> Vibe -> Studio -> Gallery -> Song detail`
- A UI tone that feels editorial and restrained rather than tool-heavy:
  fewer knobs, stronger hierarchy, more guided choices
- A melody pipeline that treats raw humming as imperfect input:
  denoise, pitch correction, tonal inference, cadence stabilization
- A “what you hear is what you save” architecture:
  live preview, saved audio, and export all share the same arrangement logic
- Export that is not just static sharing:
  reusable visual presets, downloadable HTML, poster PNG, and audio-backed video

## Key Visible Files

- Entry flow shell:
  [src/app/page.tsx](./src/app/page.tsx)
- Capture / transcription handoff:
  [src/components/screens/HumScreen.tsx](./src/components/screens/HumScreen.tsx)
- Arrangement editing surface:
  [src/components/screens/StudioScreen.tsx](./src/components/screens/StudioScreen.tsx)
- Saved song playback + export surface:
  [src/components/screens/SongDetailScreen.tsx](./src/components/screens/SongDetailScreen.tsx)
- Real audio+video export:
  [src/modules/export/export-video.ts](./src/modules/export/export-video.ts)

## Getting Started

Install dependencies with Bun:

```bash
bun install
```

If dependency installation stalls on this machine during `sharp` setup, use:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 bun install
```

Start the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

For a fast "is the local stack alive?" pass once web + worker are running:

```bash
bun run smoke:local
```

That smoke check verifies:

- the web app answers on `localhost`
- `/api/user/balance` still returns the expected shape
- `/api/transcribe` fails gracefully with `audio_required` instead of 500
- the audio worker `/health` endpoint is alive

For the slightly stronger local operator loop, use:

```bash
bun run verify:local
```

That bundles the stack smoke check with local markdown-link validation,
repository lint, and audio-worker unit coverage.

For local persistence, start Postgres first:

```bash
bun run db:up
bun run db:migrate
```

If Docker Desktop is installed but not open yet, `bun run db:up` will fail
until the Docker daemon is running.

For real audio transcription, run the audio worker separately and point the
web app at it:

```bash
bun run setup:audio
bun run dev:audio
```

Melo Lab is the local/test-only bench for comparing the Murmur audio worker
against small pitch-provider baselines. To enable the light external Praat
baseline, install the lab requirements into the audio-worker venv:

```bash
cd workers/audio-engine
./.venv/bin/pip install -r requirements-lab.txt
```

Then run the worker on loopback and open
`http://127.0.0.1:3001/me/debug/melo-lab?debug=1` from a local `next start` or
`next dev` process. Melo Lab APIs only accept loopback worker URLs.

Equivalent manual steps:

```bash
cd workers/audio-engine
python3 -m venv .venv
./.venv/bin/python -m ensurepip --upgrade
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
```

For local audio acceptance and fallback verification, run:

```bash
bun run audit:audio
bun run audit:audio:compare
bun run audit:audio:gate
bun run audit:audio:closure
```

The gate command enforces the checked-in audio baseline at
`workers/audio-engine/tools/audio_audit_expectations.json` and exits non-zero
if the shipped path regresses.

To convert a downloaded public dataset or an internal recording folder into a
Murmur audit manifest, use the builder documented in
[docs/audio-dataset-ingestion.md](./docs/audio-dataset-ingestion.md).
The closure command uses a suite config so the synthetic baseline is always
required while local public datasets and internal golden sets can remain
optional until they exist on disk.
Recommended local manifest names live under
`workers/audio-engine/tools/manifests/`.

The unattended corpus now includes:

- capture edge cases: quiet / noisy / clipped;
- familiar hooks: `two_tigers_phrase`, `brightest_star_hook`;
- structural stress cases: `overheld_middle_phrase`,
  `pitch_weak_stable_phrase`, `urgent_hook_fragment`.

The summary also reports repair / reroute counts and median pitch latency so
the local loop can catch stability and performance drift, not only note-count
failures.

For a faster human-readable snapshot, run:

```bash
bun run audit:audio:closure:report
```

For a single unattended acceptance entrypoint that runs the key app-side audio
tests, worker acceptance tests, scaffolds the local audio-eval workspace,
seeds the local `murmur-golden` corpus, refreshes the closure report, and
writes a combined operator summary, run:

```bash
bun run audit:audio:acceptance
```

It writes:

- `workers/audio-engine/tools/reports/audio-closure.md`
- `workers/audio-engine/tools/reports/audio-acceptance.md`
- `workers/audio-engine/tools/reports/audio-acceptance.json`

If you also want repo-wide lint and build folded into the same run, use:

```bash
bun run audit:audio:acceptance:full
```

That report uses a bounded operator config:

- full synthetic baseline;
- full local `humtrans` suite when present;
- a limited `vocadito` slice for readable turnaround;
- the local `murmur-golden` suite.

For the most reliable local startup, set:

```bash
AUDIO_WORKER_URL=http://localhost:8001
AUDIO_ENGINE_PITCH_PROVIDER=pyin
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
MURMUR_DEV_NOTES_BALANCE=9999
```

`pyin` is slower than SwiftF0 but is more predictable for first-run local
development because it avoids SwiftF0 model warmup surprises. Once the worker
is stable on your machine, you can switch back to `AUDIO_ENGINE_PITCH_PROVIDER=auto`.

The base worker keeps local demos light. To enable server denoise, install the
optional PyTorch stack and choose the denoise provider explicitly:

```bash
pip install -r requirements-denoise.txt
AUDIO_ENGINE_DENOISE_PROVIDER=deepfilternet uvicorn main:app --reload --port 8001
```

Then set `AUDIO_WORKER_URL=http://localhost:8001` in `.env`. Without the
worker, live recordings return a visible retry/demo error instead of silently
using a fixture melody.

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | API key for the default OpenAI-compatible chat endpoint used by `/api/strummer/edit`. |
| `OPENAI_BASE_URL` | Optional override for an OpenAI-compatible base URL. |
| `AI_GATEWAY_API_KEY` | Optional alternative to `OPENAI_API_KEY` when routing through a custom gateway. |
| `AI_GATEWAY_BASE_URL` | Optional base URL for a custom AI gateway. |
| `AUDIO_WORKER_URL` | Server-only audio worker base URL used by `/api/transcribe`. |
| `AUDIO_WORKER_TOKEN` | Optional bearer token for Next.js → audio worker calls. |
| `AUDIO_ENGINE_PITCH_PROVIDER` | Worker pitch detector provider. `auto` uses SwiftF0 first, then pYIN fallback. |
| `AUDIO_ENGINE_DENOISE_PROVIDER` | Worker denoise provider. `auto` uses DeepFilterNet when optional deps are installed; `deepfilternet` fails loudly if they are missing. |
| `DATABASE_URL` | Postgres connection string for Drizzle. |
| `CRON_SECRET` | Shared secret for the daily digest cron route. |
| `MURMUR_ALLOW_DEV_BILLING_FALLBACK` | Development-only switch. Defaults to enabled in `next dev`; when enabled, local development bypasses notes spending for hum/save/edit flows. Set to `0` to force real billing even in development. |
| `MURMUR_DEV_NOTES_BALANCE` | Development-only display balance returned by `/api/user/balance` and `/api/auth/me` when dev billing fallback is enabled. Defaults to `9999`. |

### Notes

- Authentication, notifications, and AI now go through Murmur's local
  platform adapter under [src/lib/platform](./src/lib/platform).
- Real recordings go through server `/api/transcribe`; the fixture melody is
  only used when the user explicitly chooses the demo action.
- In local development, billing fallback is enabled by default. Hum, save, and
  Studio edit flows bypass notes spending, and the UI balance defaults to
  `9999` unless `MURMUR_DEV_NOTES_BALANCE` overrides it. This bypass is
  disabled outside development.
- `compose.yaml` provides the expected local Postgres at
  `postgresql://postgres:password@localhost:5432/myapp`.
- The notification publisher is currently a stub so local development and demo
  flows stay usable without external push infrastructure.
- The Strummer edit route expects an OpenAI-compatible chat API.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Bun
- OpenAI-compatible AI gateway
- Web Audio / Tone-based render pipeline

## Deployment

**Production**: https://murmur.ptoq.io

**Current architecture**: Next.js frontend on Vercel; transcription (audio-engine) runs on Fly.io; music generation (Magenta RT2) runs on RunPod Serverless (scale-to-zero GPU); Postgres via Drizzle; billing via Waffo.

For deployment, see:
- **[docs/DEPLOY_MUSIC_ENGINE.md](./docs/DEPLOY_MUSIC_ENGINE.md)** — canonical deploy guide (Vercel shell + workers)
- **[docs/DEPLOY_MUSIC_ENGINE_GPU.md](./docs/DEPLOY_MUSIC_ENGINE_GPU.md)** — RunPod Serverless music-engine deploy

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
