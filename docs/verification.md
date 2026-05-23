# Verification Log

## Status

### Tested
- [x] `bun install` — passes (684 packages, +1 lamejs)
- [x] `bunx tsc --noEmit` — 0 errors
- [x] `bunx next build` — 14 routes compile cleanly (Turbopack)
- [x] `bun run lint` — 0 errors, 1 pre-existing warning
- [x] Music engine v2: rhythm-engine + chord-engine + bass-engine + drum-engine + assemble-song wired through both live preview and offline render
- [x] Hum → Stainer facade → browser-yin / fixture → 3 VibeVersions
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
- [ ] Browser Basic Pitch — opt-in via `NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER=true`
- [ ] PYIN remote worker — set `NEXT_PUBLIC_REMOTE_PYIN_WORKER_URL` (or legacy `NEXT_PUBLIC_BASIC_PITCH_WORKER_URL`)
- [ ] Eazo notifications — needs `EAZO_PRIVATE_KEY` configured

### Known limitations
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
1. Live hum → browser-yin → 3 cards → Studio → save (MP3 rendered) → Gallery
2. Mic denied → "Try with an example melody" → fixture → identical flow
3. Pre-saved songs visible in Gallery with sticker record wall layout
