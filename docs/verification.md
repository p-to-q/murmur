# Verification Log

## Status

### Tested
- [x] `bun install` — passes (684 packages, +1 lamejs)
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
- [x] Music engine v2: rhythm-engine + chord-engine + bass-engine + drum-engine + assemble-song wired through both live preview and offline render
- [x] Hum demo → Stainer facade → fixture → 3 VibeVersions
- [ ] Live hum → `/api/transcribe` → audio worker → 3 VibeVersions
- [x] VersionCardsOverlay shows 3 cards, audition with synth, "Pick" routes to Studio
- [x] StudioScreen mixer + 8 scene presets + restore button
- [x] StudioScreen prompt bar — rule parser + LLM fallback (/api/strummer/edit)
- [x] EditToken allowlist (28 tokens, server-side validated)
- [x] Studio save → Tone.Offline → lamejs MP3 → DB (`mp3DataUrl`)
- [x] Studio save renders WAV fallback when MP3 encoding fails
- [x] SongDetail uses real MP3 playback (HTMLAudioElement) with Tone fallback
- [x] SongDetail 3 downloads: audio / share HTML / poster PNG
- [x] Self-contained share HTML (embedded base64 audio + inline canvas)
- [x] Poster PNG rendered via html2canvas at 1080×1080
- [x] BottomNav simplified to 3 items (Hum / Gallery / Me) — Vibe + Studio hidden via `mobileNav: false`
- [x] SideNav (desktop) — 252px column with brand + nav; Vibe hidden via `desktopNav: false`
- [x] Layout padding fixed: `md:pl-[252px]` matches sidebar width; desktop bottom padding via `--main-pb` CSS var (0 on md+)
- [x] Safe-area insets honored top + bottom
- [x] i18n zh / en switcher in Me screen, device.locale auto-detected
- [x] Murmur SVG mark + favicon
- [x] Guest mode (`userId="guest"`) preserved for hackathon demo

### Optional upgrades (off by default)
- [ ] PYIN audio worker — set server-only `AUDIO_WORKER_URL`
- [ ] Native push notifications — local adapter is stubbed until a real gateway is configured

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

### Demo safety
Three demo modes still work without any network:
1. Live hum → `/api/transcribe` → 3 cards → Studio → save (MP3 rendered) → Gallery
2. Mic denied → "Try with an example melody" → fixture → identical flow
3. Pre-saved songs visible in Gallery with sticker record wall layout
