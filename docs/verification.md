# Verification Log

Status: historical evidence log, not a current guarantee<br>
Owner: product engineering<br>
Last verified: 2026-07-18

Entries below accumulated across multiple revisions. Before release, record the
exact SHA, environment, date, and command output in release evidence; an old
checkbox does not prove the current tree.

## Status

### Tested
- [x] `bun install` — passes (684 packages, +1 lamejs, +essentia.js)
- [x] `bunx tsc --noEmit` — 0 errors
- [x] `bun run build` — Next.js build completes through the configured
  webpack command path
- [x] `bun run build:audit` — build succeeds with no audited Next.js warnings
- [x] `bun run lint` — 0 errors, 0 warnings
- [x] `bun run smoke:local` — web app, user balance API, transcribe validation,
  and audio worker health all pass against the running local stack
- [x] `bun run smoke:pages` — primary page shells mount and expose their
  expected route markers on a running local stack, including deep QA entry
  routes for `/vibe?demo=1`, `/studio?demo=1`, and `/studio/name?demo=1`
- [x] `bun run verify:local` — compact local operator gate passes
- [x] `bash scripts/ci-local-stack-smoke.sh` — boots the built app plus a live
  worker on isolated ports, then runs the shared smoke contract (API + page
  shell checks)
- [x] Browser-verified deep-link QA surfaces: `/vibe?demo=1` and
  `/studio?demo=1` and `/studio/name?demo=1` hydrate a deterministic demo flow
  without requiring a prior hum in the same tab
- [x] `/me/debug?debug=1` now acts as a hidden QA cockpit with shortcut links
  into the mainline and demo-route checkpoints
- [x] `/api/qa/health` aggregates web / worker / QA-route health, and the
  debug cockpit still renders that summary even when event-stream access is
  denied
- [x] `bun run qa:report` emits a single local QA snapshot spanning aggregated
  health plus every shared QA route contract
- [x] First transient hum worker failure now stays human-first; support code is
  reserved for hard faults or repeated transient failures
- [x] Client-side pitch fallback: browser pYIN via Essentia.js WASM when worker
  is transiently unavailable (`src/lib/audio/client-pitch-fallback.ts`)
- [x] Transient error classification service (`src/lib/errors/transient.ts`) with
  centralized `isTransient()`, `classifyError()`, `classifyHttpStatus()` for
  retry decisions across routes, workers, and client
- [x] Per-component latency budgets (`src/lib/observability/latency-budgets.ts`)
  with P50/P95 ceilings for transcribe, music_generate, llm_edit, db.query, db.transaction
- [x] Stage-based funnel tracking (`src/lib/observability/stage-tracking.ts`)
  for hum → vibe → studio → save → gallery drop-off observability
- [x] SongCard memo + reduced-motion preference support + ISR caching (`minimumCacheTTL: 3600`)
  and AVIF/WebP image optimization
- [x] Per-route error boundaries (`src/components/murmur/route-error-screen.tsx`)
  for Gallery, Studio, Song, Topup, Me with contextual retry + back actions
- [x] CSP security headers (report-only) applied globally, XSS hardening
- [x] Music engine v2: rhythm-engine + chord-engine + bass-engine + drum-engine + assemble-song wired through both live preview and offline render
- [x] Hum demo → Stainer facade → fixture → 3 VibeVersions
- [x] Live hum → `/api/transcribe` → audio worker → 3 VibeVersions
- [x] VersionCardsOverlay shows 3 cards, audition with synth, "Pick" routes to Studio
- [x] StudioScreen mixer + 8 scene presets + restore button
- [x] StudioScreen prompt bar — rule parser + LLM fallback (/api/strummer/edit)
- [x] EditToken allowlist (28 tokens, server-side validated)
- [x] Studio save → audio render → songs API → object storage when configured,
  with a legacy `mp3DataUrl` fallback when upload is unavailable
- [x] Studio save renders WAV fallback when MP3 encoding fails
- [x] SongDetail uses real MP3 playback (HTMLAudioElement) with Tone fallback
- [x] SongDetail audio and poster downloads
- [ ] Self-contained share HTML is dormant reference material under
  `src/_recovered/`; do not advertise it as a current export
- [x] Poster PNG rendered via html2canvas at 1080×1080
- [x] BottomNav simplified to 3 items (Hum / Gallery / Me) — Vibe + Studio hidden via `mobileNav: false`
- [x] SideNav (desktop) — 252px column with brand + nav; Vibe hidden via `desktopNav: false`
- [x] Layout padding fixed: `md:pl-[252px]` matches sidebar width; desktop bottom padding via `--main-pb` CSS var (0 on md+)
- [x] Safe-area insets honored top + bottom
- [x] i18n zh / en switcher in Me screen, first-paint language negotiated from
  `murmur.lang` + `Accept-Language` before client browser-language fallback
- [x] Murmur SVG mark + favicon
- [x] Guest mode (`userId="guest"`) preserved for hackathon demo

### Optional upgrades (off by default)
- [ ] PYIN audio worker — set server-only `AUDIO_WORKER_URL`
- [x] Browser Web Push notifications — set `WEB_PUSH_PUBLIC_KEY` and
  `WEB_PUSH_PRIVATE_KEY` to enable OS-level alerts from registered browsers.
  `WEB_PUSH_SUBJECT` is optional and defaults to `mailto:ops@example.com` when
  absent.

### Known limitations
- Metadata URLs default to `https://murmur.ptoq.io` when `MURMUR_APP_URL` and
  `VERCEL_URL` are both unset. Set `MURMUR_APP_URL` in deployed environments
  that need a different canonical origin.
- Mobile Safari may reject `audio.play()` if invoked outside the gesture frame
  after route navigation — SongDetail falls back to Tone player automatically.
- MP3 encoding uses `@breezystack/lamejs`; it dynamically imports so render
  pipeline never blocks save on encoder load.
- The legacy `/api/transcribe` route is now a strict proxy to the remote
  worker. It no longer returns fixture notes for real recordings.
- Songs saved before the music-engine v2 (no `gen:<vibeId>` marker in
  `chords.currentPattern`) fall back to tag-based vibe inference inside
  `assemble-song`. Re-save migrates them.
- Client-side pitch fallback requires `essentia.js` WASM (~2.5 MB lazy-loaded),
  only triggered on transient server failures — not a replacement for full
  quality transcription.

### Demo safety
Four demo modes still work without any network:
1. Live hum → `/api/transcribe` → 3 cards → Studio → save (MP3 rendered) → Gallery
2. Live hum → worker transient failure → client pYIN WASM → 3 cards → Studio → save
3. Mic denied → "Try with an example melody" → fixture → identical flow
4. Pre-saved songs visible in Gallery with sticker record wall layout
