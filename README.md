# Murmur

Murmur is a humming-to-song studio. A user hums a sketch, the system
transcribes and polishes it into a melody, generates several vibe-led
arrangements, then lets the user refine, preview, save, and export the result
as audio, visuals, share HTML, and an audio-backed WebM.

## For Judges

If you are reviewing this repo with a code bot judge or a design bot judge,
start here:

- Product + design + engineering overview:
  [docs/judges-guide.md](/Users/dujiayi/murmur/docs/judges-guide.md)
- Runtime architecture:
  [docs/architecture.md](/Users/dujiayi/murmur/docs/architecture.md)
- Runtime surfaces:
  [docs/runtime-surfaces.md](/Users/dujiayi/murmur/docs/runtime-surfaces.md)
- Delivery cadence:
  [docs/delivery-cadence.md](/Users/dujiayi/murmur/docs/delivery-cadence.md)
- Engineering principles:
  [docs/engineering-principles.md](/Users/dujiayi/murmur/docs/engineering-principles.md)
- Review gates:
  [docs/review-gates.md](/Users/dujiayi/murmur/docs/review-gates.md)
- Workflow contract:
  [WORKFLOW.md](/Users/dujiayi/murmur/WORKFLOW.md)
- Packaging and release:
  [docs/packaging-and-release.md](/Users/dujiayi/murmur/docs/packaging-and-release.md)
- Melody, arrangement, and render pipeline:
  [docs/music-engine.md](/Users/dujiayi/murmur/docs/music-engine.md)
- Provider and transcription fallback strategy:
  [docs/provider-strategy.md](/Users/dujiayi/murmur/docs/provider-strategy.md)
- Verification notes:
  [docs/verification.md](/Users/dujiayi/murmur/docs/verification.md)

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
  reusable visual presets, downloadable HTML, poster PNG, and audio-backed WebM

## Key Visible Files

- Entry flow shell:
  [src/app/page.tsx](/Users/dujiayi/murmur/src/app/page.tsx)
- Capture / transcription handoff:
  [src/components/screens/HumScreen.tsx](/Users/dujiayi/murmur/src/components/screens/HumScreen.tsx)
- Arrangement editing surface:
  [src/components/screens/StudioScreen.tsx](/Users/dujiayi/murmur/src/components/screens/StudioScreen.tsx)
- Saved song playback + export surface:
  [src/components/screens/SongDetailScreen.tsx](/Users/dujiayi/murmur/src/components/screens/SongDetailScreen.tsx)
- Real audio+video export:
  [src/modules/export/export-webm.ts](/Users/dujiayi/murmur/src/modules/export/export-webm.ts)

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

For real audio transcription, run the audio worker separately and point the
web app at it:

```bash
cd workers/audio-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

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

### Notes

- Authentication, notifications, and AI now go through Murmur's local
  platform adapter under [src/lib/platform](/Users/dujiayi/murmur/src/lib/platform).
- Real recordings go through server `/api/transcribe`; the fixture melody is
  only used when the user explicitly chooses the demo action.
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

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
