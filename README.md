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

## Architecture

### System Overview

```mermaid
flowchart TB
    classDef browser fill:#F5F1EB,stroke:#D2C9B6,stroke-width:2px,color:#1A1A1A
    classDef api fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#0D47A1
    classDef worker fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#4A148C
    classDef infra fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
    classDef accent fill:#FFF3E0,stroke:#FF5924,stroke-width:2px,color:#BF360C
    classDef user fill:#FFF8E1,stroke:#F57F17,stroke-width:2px,color:#E65100
    classDef anchor fill:transparent,stroke:transparent

    User(["🎤 User"]):::user

    subgraph Browser["🌐 Browser  ·  Next.js 16  ·  React 19"]
        direction LR
        Screens["Screens<br/>Hum · Vibe · Studio · Name · Gallery · Song Detail · Me"]
        ClientPitch["WASM pYIN<br/>Essentia.js · browser fallback"]
        ToneSynth["Tone.js · SimpleSynth<br/>live preview & playback"]
        Store["State<br/>Zustand · localStorage"]
        bBot[ ]:::anchor
    end

    subgraph API["⚡ API Routes  ·  Vercel  ·  Node.js"]
        direction LR
        aTop[ ]:::anchor
        Transcribe["/api/transcribe"]
        MusicGen["/api/music/generate"]
        Strummer["/api/strummer/edit"]
        Songs["/api/songs · CRUD"]
        Auth["/api/auth · NextAuth"]
        BillingAPI["/api/billing · Waffo"]
        Notifs["/api/notifications · Web Push"]
        aBot[ ]:::anchor
    end

    subgraph Workers["🐍 Python Workers"]
        direction LR
        wTop[ ]:::anchor
        AE["Audio Engine  ·  Fly.io<br/>RMVPE → SwiftF0 → pYIN<br/>DeepFilterNet denoise · FastAPI"]
        ME["Music Engine  ·  RunPod Serverless<br/>Magenta RT2 · GPU<br/>scale-to-zero · JAX/CUDA"]
        wBot[ ]:::anchor
    end

    subgraph Infra["🗄️ Infrastructure"]
        direction LR
        iTop[ ]:::anchor
        DB[("PostgreSQL<br/>Drizzle ORM")]
        Storage[("Object Storage<br/>S3 / R2")]
        AI[("AI Gateway<br/>OpenAI-compatible")]
        Waffo[("Waffo Pancake<br/>Billing")]
    end

    bBot --- aTop
    aBot --- wTop
    wBot --- iTop

    User -->|"capture hum"| Screens
    Screens -->|"transcribe audio"| Transcribe
    Screens -->|"select vibe"| MusicGen
    Screens -->|"edit arrangement"| Strummer
    Screens -->|"CRUD songs"| Songs
    Screens -.->|"transient failure"| ClientPitch

    ClientPitch -.->|"degraded notes"| Screens
    ToneSynth -->|"live preview"| Screens
    Screens -->|"persist draft"| Store

    Transcribe -->|"raw audio"| AE
    MusicGen -->|"melody + vibe"| ME
    Strummer -->|"prompt"| AI

    Songs --> DB
    BillingAPI --> Waffo
    Transcribe --> Storage
    MusicGen --> Storage
    Notifs --> DB

    AE -->|"contour + notes"| Transcribe
    ME -->|"WAV clip"| MusicGen
```

### Hum → Song Pipeline

```mermaid
flowchart LR
    classDef stage fill:#FFF3E0,stroke:#FF5924,stroke-width:2px,color:#BF360C
    classDef transform fill:#F5F1EB,stroke:#D2C9B6,stroke-width:2px,color:#1A1A1A
    classDef output fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
    classDef module fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#0D47A1

    Start(["🎤 Raw Hum"]):::stage

    Transcribe["Audio Worker<br/>pYIN · RMVPE · SwiftF0"]:::module
    Transcribe -->|"RawNote[]"| Polish

    Polish["Melody Polisher<br/>denoise · pitch correction · tonal inference"]:::module
    Polish -->|CleanMelody| Intent

    Intent["Humming Engine<br/>intent / corrected / musical"]:::module
    Intent -->|selected| Versions

    Versions["Generate Versions<br/>3 per vibe · 2 ensembles · seeded"]:::module
    Versions -->|VibeVersion ×3| Assemble

    Assemble["Assemble Song<br/>chords · bass · drums · bpm"]:::module
    Assemble -->|AssembledSong| Live

    Live["Live Preview<br/>SimpleSynth · Web Audio"]:::output
    Assemble -->|AssembledSong| Save

    Save["Export<br/>MP3 · WAV · poster PNG · share HTML · video"]:::output

    Start --> Transcribe
```

### Transcription Fallback & Resilience

```mermaid
flowchart TB
    classDef tier1 fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20
    classDef tier2 fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px,color:#4A148C
    classDef tier3 fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#0D47A1
    classDef tier4 fill:#FFF8E1,stroke:#F57F17,stroke-width:2px,color:#E65100
    classDef obs fill:#E0F7FA,stroke:#006064,stroke-width:1px,color:#004D40

    Capture(["🎤 User captures"]):::tier1

    Capture --> Tier1

    subgraph Tier1["Tier 1 · Server (primary)"]
        RMVPE["RMVPE ONNX<br/>Fly.io · GPU-capable"]:::tier1
        RMVPE -->|"confident"| Result["✅ Full Quality<br/>TranscriptionResult"]
    end

    Capture --> Tier2

    subgraph Tier2["Tier 2 · Server (fallback)"]
        SwiftF0["SwiftF0<br/>Fast contour"]:::tier2
        pYIN["pYIN<br/>Conservative"]
    end

    RMVPE -.->|"weak / model absent"| SwiftF0
    SwiftF0 -->|"normal"| Result
    SwiftF0 -.->|"unstable"| pYIN
    pYIN --> Result

    Capture --> Tier3

    subgraph Tier3["Tier 3 · Browser WASM<br/>transient failure only"]
        Essentia["Essentia.js WASM pYIN<br/>lazy-loaded · ~2.5 MB"]:::tier3
        Essentia -->|"degraded"| Degraded["⚠️ Degraded Quality<br/>+ warning in result"]
        Degraded --> Polisher["Melody Polisher<br/>same server-side pipeline"]
        Polisher -->|"usable"| Result
    end

    Capture --> Tier4

    subgraph Tier4["Tier 4 · Explicit Demo<br/>never auto-triggered"]
        Demo["Fixture melody<br/>user chooses 'try an example'"]:::tier4
        Demo --> Result
    end

    subgraph Observability["Observability across all tiers"]
        Latency["Latency Budgets<br/>P50 / P95 per component"]:::obs
        Stage["Stage Tracking<br/>hum → vibe → studio → save → gallery"]:::obs
        Errors["Error Classification<br/>transient.ts · isTransient()"]:::obs
    end

    Result -.-> Observability
```

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

`bun run db:migrate` resolves its target through the shared fail-closed DSN
resolver (prefer `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`, then
`DATABASE_URL` / `POSTGRES_URL`). Locally it uses the `.env` `DATABASE_URL`; with
no DSN set it errors loudly rather than silently migrating `localhost` — see
[Connection string precedence](#connection-string-precedence).

For real audio transcription, run the audio worker separately and point the
web app at it:

```bash
bun run setup:audio
bun run dev:audio
```

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
AUDIO_ENGINE_PITCH_PROVIDER=auto
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
MURMUR_DEV_NOTES_BALANCE=9999
```

`auto` tries RMVPE first, then falls back to SwiftF0 and pYIN. For RMVPE-backed
local work, set `AUDIO_ENGINE_RMVPE_MODEL_PATH` to a prepared `rmvpe.onnx`
file, or set `AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD=1` when you explicitly want the
worker to fetch the default model. Without an RMVPE model, `auto` still keeps
the local demo alive through the existing SwiftF0 / pYIN fallback. Advanced
RMVPE tuning can adjust `AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD`; leave it at
`0.03` unless you are comparing saved Melo Lab samples.

The base worker keeps local demos light. To enable server denoise, install the
optional PyTorch stack and choose the denoise provider explicitly:

```bash
pip install -r requirements-denoise.txt
AUDIO_ENGINE_DENOISE_PROVIDER=deepfilternet uvicorn main:app --reload --port 8001
```

Then set `AUDIO_WORKER_URL=http://localhost:8001` in `.env`. Without the
worker, live recordings return a visible retry/demo error instead of silently
using a fixture melody.

For local "why does the generated song not match my hum?" work, use MeLo Lab:

```bash
bun run dev:audio
bun run dev:music # optional, only for final worker-output drift checks
bun dev
```

Open `/me/debug/melo-lab?debug=1`. The lab is a hidden debug-room surface: the
page may be visible, but its test APIs send requests only to loopback workers
(`MELO_LAB_AUDIO_WORKER_URL`, `MELO_LAB_MUSIC_WORKER_URL`) and never route
through billing, RunPod/serverless, or the main Hum -> Vibe product path. The
Lab uses the same product `auto` pitch route and renders its returned melody JSON
layers through the same browser piano/voice synth before any music-worker probe.
Detector details stay in diagnostics/export metadata rather than becoming a Lab
selection surface.

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
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Required in production when OAuth providers are configured. |
| `AUTH_URL` / `NEXTAUTH_URL` / `MURMUR_APP_URL` | Public origin used for Auth.js redirects, share URLs, and payment return links. |
| `AUDIO_WORKER_URL` | Server-only audio worker base URL used by `/api/transcribe`. |
| `AUDIO_WORKER_TOKEN` | Bearer token for Next.js -> audio worker calls; required for production deployments. |
| `MURMUR_CAPTURE_HUMS` | Audio-worker raw hum capture. Defaults off; keep unset/false in production unless an explicit review program is running. |
| `AUDIO_ENGINE_PITCH_PROVIDER` | Worker pitch detector provider. `auto` uses RMVPE first, then SwiftF0 and pYIN fallback. |
| `AUDIO_ENGINE_RMVPE_MODEL_PATH` | Optional path to a baked `rmvpe.onnx` model for the RMVPE provider. |
| `AUDIO_ENGINE_RMVPE_DEVICE` | RMVPE ONNX Runtime device hint. Defaults to `cpu`; GPU workers can set `cuda` or another supported provider. |
| `AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD` | Optional local/dev opt-in to let `rmvpe-onnx` download the default model when no model path exists. Defaults off. |
| `AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD` | RMVPE voiced-frame confidence threshold. Defaults to `0.03`; tune only with audio sample review. |
| `AUDIO_ENGINE_DENOISE_PROVIDER` | Worker denoise provider. `auto` uses DeepFilterNet when optional deps are installed; `deepfilternet` fails loudly if they are missing. |
| `MURMUR_ENABLE_MELO_LAB` | Explicit production diagnostic flag for the test-only MeLo Lab APIs. Local development enables them by default; worker URLs still must be loopback. |
| `MELO_LAB_AUDIO_WORKER_URL` | Optional loopback audio worker override for `/api/test/melo-lab/transcribe`. Defaults to `http://127.0.0.1:8001`. |
| `MELO_LAB_MUSIC_WORKER_URL` | Optional loopback music worker override for `/api/test/melo-lab/music`. Defaults to `http://127.0.0.1:8002`. |
| `DATABASE_URL` | Primary Postgres connection string for Drizzle (runtime + migrations). In production point this at the Neon **pooler** endpoint (`*-pooler.<region>.neon.tech`) — see [Database connections](#database-connections). |
| `POSTGRES_URL` | Vercel Postgres-compatible fallback for `DATABASE_URL`. Accepted everywhere the runtime and DB scripts resolve a DSN, and by the production env audit — one precedence contract, see [Database connections](#database-connections). |
| `DATABASE_URL_UNPOOLED` | Direct (non-pooler) endpoint used **only for migrations**, where it takes precedence over the pooled URLs. Set it (or `POSTGRES_URL_NON_POOLING`) as the production migration secret; the migration workflow fails closed when no DSN is present. |
| `POSTGRES_URL_NON_POOLING` | Vercel/Neon-integration name for the direct endpoint; accepted as an unpooled alias in migration context. |
| `MURMUR_DB_POOL_MAX` | Optional per-instance postgres-js pool bound. Defaults to `5`; only integers from `1` to `10` are accepted. Tune with production load-test evidence. |
| `MURMUR_RATE_LIMIT_DRIVER` | Rate-limit backend. Production defaults to `postgres` for shared route-level buckets; local/test default to `memory`. `redis` remains reserved until an adapter lands. |
| `CRON_SECRET` | Shared secret for cron routes; production must use a non-placeholder value. |
| `MURMUR_STORAGE_DRIVER` | Storage adapter. Production on Vercel must use `s3-compatible`; dev defaults to local storage. |
| `MURMUR_STORAGE_S3_*` | Bucket, region, access key, and secret for the `s3-compatible` storage adapter. |
| `WAFFO_MERCHANT_ID` / `WAFFO_PRIVATE_KEY_BASE64` / `WAFFO_TOPUP_PRODUCT_ID` | Waffo checkout and billing reconcile credentials required for production top-ups. |
| `ZPAY_PID` / `ZPAY_KEY` | Optional WeChat/Alipay route for CNY checkout. If absent, explicit WeChat checkout is unavailable. |
| `MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS` | Explicit production allow flag for ZPay checkout while Murmur lacks a reliable ZPay refund/chargeback webhook. Must be `1`/`true`/`yes` when `ZPAY_PID` and `ZPAY_KEY` are set in production; otherwise WeChat checkout stays closed. |
| `RUNPOD_SERVERLESS_ENDPOINT_ID` / `RUNPOD_API_KEY` | RunPod Serverless music-generation endpoint and bearer key. |
| `MURMUR_AUTH_MODE` | Auth runtime mode. Defaults to production-like behavior even on localhost: no session means 401. Set `demo` or `local` only for explicit preview fallback work. |
| `NEXT_PUBLIC_MURMUR_AUTH_MODE` | Browser-side companion for local header auth. Set to `local` only with `MURMUR_AUTH_MODE=local` when intentionally exercising localStorage user headers. |
| `MURMUR_ALLOW_HEADER_AUTH` | Local/demo-only legacy switch for `x-murmur-user-*` identity headers. Ignored in production auth mode. |
| `MURMUR_ALLOW_DEV_BILLING_FALLBACK` | Development-only switch. Defaults to enabled in `next dev`; when enabled, local development bypasses notes spending for hum/save/edit flows. Set to `0` to force real billing even in development. |
| `MURMUR_DEV_NOTES_BALANCE` | Development-only display balance returned by `/api/user/balance` and `/api/auth/me` when dev billing fallback is enabled. Defaults to `9999`. |

### Notes

- Authentication, notifications, and AI now go through Murmur's local
  platform adapter under [src/lib/platform](./src/lib/platform).
- Identity is session-resolved by `resolveRequestAuth()` in production and by
  default on localhost. Guest/header fallback is available only after opting
  into `MURMUR_AUTH_MODE=local` or `demo`; `x-murmur-user-*` is never a
  production identity source.
- Real recordings go through server `/api/transcribe`; the fixture melody is
  only used when the user explicitly chooses the demo action.
- In local development, billing fallback is enabled by default. Hum, save, and
  Studio edit flows bypass notes spending, and the UI balance defaults to
  `9999` unless `MURMUR_DEV_NOTES_BALANCE` overrides it. This bypass is
  disabled outside development.
- ZPay's current Murmur integration handles successful CNY payment notifications
  only. Production deployments with `ZPAY_PID` / `ZPAY_KEY` must set
  `MURMUR_ALLOW_PRODUCTION_ZPAY_WITHOUT_REFUNDS=1` to acknowledge the temporary
  refund/reversal gap; otherwise `/api/billing/checkout` returns
  `503 zpay_not_configured` for explicit WeChat checkout.
- `compose.yaml` provides the expected local Postgres at
  `postgresql://postgres:password@localhost:5432/myapp`.
- The server notification publisher is currently a stub so local development
  and demo flows stay usable without external push infrastructure. The client
  still has a local in-app notification inbox and browser alert opt-in for
  save / generation events.
- The Strummer edit route expects an OpenAI-compatible chat API.

### Database connections

The Drizzle client (`src/lib/db/client.ts`) opens up to 5 Postgres connections
**per warm serverless instance**. On Vercel, each concurrently warm
function instance holds its own pool, so the real backend load is:

```
peak_serverless_instances × max  <  neon_connection_limit
```

With `max: 5`, ~20 concurrent warm instances already reach 100 connections —
the Neon **Pro** ceiling, and far past Neon **Free**'s 20. A traffic spike can
then exhaust the limit and surface as `connection refused` across the whole app.

The durable fix is a connection pooler, not a smaller `max`: in production,
point `DATABASE_URL` at Neon's pooler endpoint
(`ep-...-pooler.<region>.aws.neon.tech`).
Neon's PgBouncer multiplexes many client connections onto a small backend pool,
so instance count no longer maps 1:1 to backend connections. This is an
environment/ops action on the deployment (swap the host in the `DATABASE_URL`
secret). The production env audit rejects direct Neon hosts such as
`ep-...<region>.aws.neon.tech` and accepts pooled Neon hosts; local and
non-Neon Postgres hosts are not affected.

`MURMUR_DB_POOL_MAX` can override the per-instance bound with an integer from 1
to 10. The default remains 5 because there is no production load-test evidence
that 1 or 2 preserves request throughput. Use the override only during measured
capacity work, and keep `peak_serverless_instances × max` within the database
plan's client-connection limit even when the Neon pooler is enabled.

#### Connection string precedence

The runtime client, the migration script, and Drizzle Kit all resolve their DSN
through one fail-closed helper (`resolveServerDsn` in
[`src/lib/db/config.ts`](./src/lib/db/config.ts)), so there is a single contract:

| Context | Precedence (first non-empty wins) |
| --- | --- |
| Runtime (pooled) | `DATABASE_URL` → `POSTGRES_URL` |
| Migrations (prefer direct) | `DATABASE_URL_UNPOOLED` → `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → `POSTGRES_URL` |

Migrations prefer the direct (unpooled) endpoint because DDL should not run
through PgBouncer. When no DSN is configured the resolver **throws a clear
error** instead of silently connecting to `localhost` — the migration script no
longer targets a dev database when an operator forgets the connection string.
The `localhost` default is only used as a fallback under an explicit local-dev
signal: `NODE_ENV=development` / `test`, or `MURMUR_DB_ALLOW_LOCAL_FALLBACK=1`.

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
