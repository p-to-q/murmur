# Tech Stack — Current State

A current-state map of what Murmur actually runs in production, as of
2026-06. Exact dependency versions live in [package.json](../package.json) and
the worker `requirements`/`pyproject` files; this doc is the architecture-level
source of truth and links out for the parts that have their own deep docs.

> Earlier drafts of this file described a Cloudflare-Workers edge with Stripe /
> RevenueCat web checkout, and a sibling `tech-stack-comparison.md` weighed a
> rejected "rebuild" branch. Both are gone. The shape below is what ships.

## Architecture at a glance

```
                         ┌────────────────────────────┐
        Browser  ─────▶  │  Next.js 16 (App Router)    │
   (web / mobile WebView)│  React 19 · Vercel          │
                         │  murmur.ptoq.io             │
                         └──────────────┬──────────────┘
                                        │ Next.js API routes (Node runtime)
        ┌───────────────────┬───────────┼───────────────────┬───────────────────┐
        │                   │           │                   │                   │
 ┌──────▼───────┐   ┌───────▼───────┐   │            ┌──────▼───────┐   ┌───────▼───────┐
 │ audio-engine │   │ music-engine  │   │            │  PostgreSQL  │   │ Object storage│
 │  (transcribe)│   │ Magenta RT2   │   │            │ + Drizzle ORM│   │  S3 / R2-compat│
 │ FastAPI :8001│   │ dev :8002 /   │   │            └──────────────┘   └───────────────┘
 │ Fly.io       │   │ RunPod        │   │
 │              │   │ Serverless    │   │
 └──────────────┘   └───────────────┘   │
                                        │
                                 ┌──────▼───────┐
                                 │   Waffo      │  one-time note top-ups
                                 │  (Pancake)   │  checkout + webhook
                                 └──────────────┘
```

Both workers share one Python generation core. The audio worker speaks a
FastAPI HTTP contract on its host; the music worker keeps that same FastAPI
contract for local dev but runs as a **RunPod Serverless handler** in
production (JSON + base64 over the RunPod job queue). The Next.js app reaches
each by its configured transport and falls back gracefully when a worker is
unreachable.

## Frontend (web shell)

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2.x |
| UI runtime | React | 19.2.x |
| Language | TypeScript | 5.x |
| Package manager + runtime | Bun | 1.3.9 |
| Styling | Tailwind CSS | 4.x |
| Animation | Framer Motion | 12.x |
| State | Zustand | 5.x |
| Data viz | Recharts | 3.x |
| Client audio | Tone.js | 14.x |
| Validation | Zod | 4.x |

The Tone.js synth path is also the **client-side fallback** for music: when the
Magenta worker is unreachable, vibe cards degrade to the local arrangement
engine instead of failing.

## Backend (Next.js API routes)

All API routes run on the Node.js runtime on Vercel — there is no separate edge
or Workers tier.

| Concern | Choice |
|---|---|
| API surface | Next.js Route Handlers (`src/app/api/**`) |
| ORM | Drizzle ORM (`drizzle-orm` 0.45.x) over `postgres` 3.x |
| Auth | NextAuth v5 (beta) — OAuth + session |
| Object storage | AWS SDK v3 S3 client against any S3/R2-compatible bucket |
| Billing | Waffo Pancake (`@waffo/pancake-ts`) — see [billing-waffo.md](billing-waffo.md) |
| Validation | Zod schemas at every route boundary |

REST conventions, the error envelope, idempotency, and webhook handling are
specified in [api-conventions.md](api-conventions.md).

## Python workers

Both live under `workers/` and expose a small FastAPI app with a `/health`
probe.

### `audio-engine` — hum → melody (transcription)

- Port `:8001`. `pYIN` / `SwiftF0` pitch detection + `DeepFilterNet` denoise,
  wrapped by the Stainer provider facade ([provider-strategy.md](provider-strategy.md)).
- **Production runs on the operator's Mac**, exposed through a `cloudflared`
  quick tunnel; `scripts/serve-workers-public.sh --sync-vercel` brings it up and
  writes the rotating tunnel URL into Vercel env. Per
  [music-engine.md](music-engine.md) the Next.js app probes `/health` and routes
  `/api/transcribe` to whichever URL is live.

### `music-engine` — vibe → audio clip (generation)

- **Magenta RealTime 2** (`mrt2_base` by default). Generation takes a text
  prompt, duration, `style_mix`, optional melody, and an optional hum, and
  returns a 48 kHz WAV.
- **Production runs on RunPod Serverless** (scale-to-zero GPU, JAX/CUDA).
  `bun run deploy:music-serverless` creates/updates a network volume + template
  + endpoint and syncs the endpoint id to Vercel. The ~4 GB model lives on the
  network volume (downloaded once); workers cold-start on demand, so the first
  hum after idle may fall back to Tone.js. See
  [DEPLOY_MUSIC_ENGINE_GPU.md](DEPLOY_MUSIC_ENGINE_GPU.md).
- **Local dev** runs the FastAPI server on `:8002` with the MLX backend on
  Apple Silicon (`bun run dev:music`); the model loads once (~45 s on an
  M4 Max) and stays resident.

## Data + storage

- **PostgreSQL** is the system of record; the notes ledger is append-only and is
  the source of truth for balances. Full schema + invariants in
  [data-model.md](data-model.md).
- **Object storage** (S3 / Cloudflare R2-compatible) holds rendered audio (MP3),
  exported MP4 video, and share artifacts. Song rows reference object URLs, not
  inline blobs.

## Billing

Web checkout is **Waffo** (Pancake), not Stripe. The client opens a Waffo
checkout URL; a signed `order.completed` webhook at `/api/billing/webhook`
grants notes idempotently. Mobile-store IAP (Apple / Google, via RevenueCat) is
future work for the Capacitor shells. The full flow, SKUs, env vars, and
bootstrap scripts are in [billing-waffo.md](billing-waffo.md).

## Hosting + deploy topology

| Layer | Where it runs | How it's deployed |
|---|---|---|
| Web + API | Vercel (`murmur.ptoq.io`) | `vercel` CLI (project linked) |
| Music generation | RunPod Serverless | `bun run deploy:music-serverless` (syncs endpoint id → Vercel) |
| Audio transcription | Operator Mac + `cloudflared` | `scripts/serve-workers-public.sh --sync-vercel` |
| Database | Managed Postgres | migrations via Drizzle |
| Object storage | S3 / R2 bucket | provisioned out-of-band |

The audio worker's URL can rotate on restart, so `--sync-vercel` re-points
production in one command. The music serverless endpoint id is stable — re-run
`deploy:music-serverless` only to ship a new image or change scaling.

## CI/CD

GitHub Actions runs the required gate (lint, link check, TS/Bun tests, audio
tests, build audit, local-stack smoke) plus scheduled audio-acceptance,
CodeQL, and Dependabot. The full automation surface and its operating rhythm
are documented in [repository-operations.md](repository-operations.md).
