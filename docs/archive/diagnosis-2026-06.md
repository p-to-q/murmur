# Murmur Diagnosis — 2026-06

This document is the factual reality check the Murmur v2 roadmap is built on.
It was written after a full read of `src/` + `workers/` + `docs/` on
2026-06-03, after PR#1 (Eazo decouple) merged. Every claim points at a file
path so downstream agents can verify before changing anything.

This is **not** a wish list. Sibling docs cover what to build next:

- `docs/audio-pipeline-redesign.md` — the new hum → score pipeline
- `docs/cross-platform-strategy.md` — Web + iOS + Android + 微信小程序
- `docs/studio-compose-redesign.md` — Studio / Compose UX simplification
- `docs/payment-topup-feature.md` — pay + top-up surfaces
- `docs/execution-roadmap.md` — sequenced execution plan

If something here contradicts those, this file wins for "what currently is."

---

## 1. Product shape (today)

- **Stack:** Next.js 16 (App Router) + React 19 + Bun + Tailwind 4 + Tone.js +
  Drizzle/Postgres. ~12.5k LOC across 117 `.ts/.tsx` files. See
  [package.json](../../package.json).
- **Five-step arc:** `Hum → Vibe → Studio → Gallery → SongDetail`. Entry
  shell at [src/app/page.tsx](../../src/app/page.tsx).
- **Live screens:**
  [HumScreen](../../src/components/screens/HumScreen.tsx),
  VersionCardsOverlay（已随死代码清理移除，f856cdb）,
  [StudioScreen](../../src/components/screens/StudioScreen.tsx),
  [NameScreen](../../src/components/screens/NameScreen.tsx),
  [GalleryScreen](../../src/components/screens/GalleryScreen.tsx),
  [SongDetailScreen](../../src/components/screens/SongDetailScreen.tsx),
  [MeScreen](../../src/components/screens/MeScreen.tsx).
- **No payment / no top-up / no quota** anywhere. Users table has only
  `id / email / name / avatarUrl / createdAt / updatedAt` —
  [users.ts](../../src/lib/db/schema/users.ts).
- **Auth is a header stub.** `getRequestUser()` reads `x-murmur-user-id` and
  returns `"guest"` if absent —
  [server-auth.ts](../../src/lib/platform/server-auth.ts).
  Anyone can pose as any userId.
- **Notifications publisher is a stub.** Acknowledged in `architecture.md`.
- **i18n:** Chinese + English via [src/lib/i18n](../../src/lib/i18n).
  Locale auto-detected, switcher in MeScreen.

## 2. Audio + arrangement pipeline (today)

The pipeline runs as documented in
[docs/music-engine.md](../music-engine.md), but the
runtime reality has a few important gaps the doc doesn't surface.

### 2.1 Capture

[HumScreen.tsx](../../src/components/screens/HumScreen.tsx):

- 15 s max recording, browser `MediaRecorder` with
  `audio/webm;codecs=opus → audio/webm → audio/mp4` selection.
- **No client-side denoise.** Raw mic stream is the only input.
- **No silence trim, no level normalization.** A user starts and ends with
  ambient noise; the YIN frontend sees it as low-confidence frames and
  generates short "ghost" notes that the polisher then has to filter.
- No live "level meter that means something" — the aurora reactivity is
  cosmetic only.

### 2.2 Transcription facade

[src/modules/stainer/transcribe.ts](../../src/modules/stainer/transcribe.ts):

- This legacy facade now feeds the server-authoritative path instead of
  choosing among browser providers at runtime.
- The effective default chain today is `web /api/transcribe →
  [audio-worker.ts](../../src/lib/platform/audio-worker.ts) →
  [workers/audio-engine/main.py](../../workers/audio-engine/main.py)`.
- Silent fixture substitution is no longer allowed on the main hum path;
  fixtures are reserved for explicit demo / rescue surfaces such as
  [fixture.ts](../../src/modules/stainer/providers/fixture.ts).
- Provider switching moved out of `NEXT_PUBLIC_*` runtime flags and into
  server / worker configuration plus the humming-engine selection logic.

### 2.3 Pitch detection

Historical note: the browser-provider references in this section are kept to
explain the diagnosis that led to the current server-worker path. They are not
the recommended architecture for new work.

Two real implementations and two stubs:

- **`browser-yin`** —
  `pitch-engine.ts` (client engine since removed; pitch detection is now server-side).
  Hand-rolled YIN with `YIN_THRESHOLD = 0.20`, frame 2048 / hop 512 at
  44.1 kHz, voice MIDI range C2–C6 (36–84).
  - No HPSS, no harmonic-product spectrum, no octave-jump correction.
    Humming "嗯——" through "啊——" can flip octaves frame-to-frame; the
    `PITCH_CHANGE_TOLERANCE = 1.5` semitone merge only catches micro-drift,
    not octave jumps.
  - Recovers from `decodeAudioData` failure by returning **empty notes
    instead of throwing**, which directly hands control to fixture downstream
    (see 2.2). This was an Eazo iframe workaround; it now hides errors.
- **Server audio worker** —
  [audio-worker.ts](../../src/lib/platform/audio-worker.ts) posts multipart
  audio to [workers/audio-engine/main.py](../../workers/audio-engine/main.py),
  which now owns the worker contract and runs the current detector stack.
  - Deploy / CI / hosting notes live with the audio-engine workspace rather
    than the deleted `basic-pitch-service` prototype.
- **`browser-basic-pitch`** — gated by
  `NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER === "true"` (currently false), uses
  a 7 MB CDN model on unpkg, decodes at 22.05 kHz, and is poly-aware.
  Benchmarks (see audio redesign doc) put Basic Pitch's monophonic accuracy
  far below pYIN/CREPE — keeping it as a fallback for pure-hum input is
  questionable.
- **`fixture`** — see above. Always present, demo-only by intent but
  user-facing by accident.

### 2.4 Melody polisher

[melody-polisher.ts](../../src/modules/music/melody-polisher.ts).
This is where most of the "musical lawfulness" of the output comes from. It
does a lot:

1. Confidence + duration filter (≥0.42, ≥0.06 s).
2. Noise-burst compaction.
3. Adjacent near-unison merge.
4. Pitch-outlier removal.
5. 1–3-note contour smoothing.
6. BPM detection (IOI-mode based) →
   [rhythm-engine.ts](../../src/lib/music/rhythm-engine.ts).
7. 16th-note soft quantize (softness 0.22).
8. Tonal profile across five modes (major / minor / dorian / phrygian /
   pentatonic), Krumhansl-style scored scale fit + first-note / last-note
   anchor bonus + brightness bonus.
9. Snap each note ±3 semitones to the chosen scale.
10. Cadence stabilization on the last two notes (toward root / fifth /
    third).
11. Final re-merge of adjacent unison.

This is the heaviest single inference layer in the codebase. The audio
quality complaint **is partially this layer's fault**: when raw input is
broken (octave jumps, ghost notes), the polisher's outlier filter cannot
distinguish "user actually jumped an octave" from "YIN guessed wrong," and
its scale fit will commit to a wrong tonality if more than half the notes
are wrong. The polisher assumes a roughly-correct pitch contour; YIN under
noise does not give it one.

There is also **no instrument-range constraint**. `inferTonalProfile` picks
a key but never asks "is this melody actually singable on the chosen
instrument?" The user explicitly named this as a product goal in the v2
brief.

### 2.5 Arrangement (Strummer)

- [generate-versions.ts](../../src/modules/strummer/generate-versions.ts)
  picks three vibes from six presets (sunset / bedroom / cinematic / party /
  rain / synth — see
  [vibes.ts](../../src/presets/vibes.ts)). Each vibe has
  two ensembles; the seeded RNG picks one. Determinism on `version.id`.
- Chord / bass / drum engines live in
  [src/lib/music/](../../src/lib/music) and produce a
  unified `AssembledSong` consumed by both the live SimpleSynth preview and
  the offline Tone.js render. This is the cleanest, most-internally-coherent
  part of the system; do **not** rewrite without a forcing reason.
- All arrangement runs **client-side**. The server only stores blobs.

### 2.6 Studio edits

[applyEdit](../../src/modules/strummer/apply-edit.ts) is the
single mutation surface for `ArrangementState`. 28 allowlisted EditTokens
covering mood / drums / bass / strings / tempo / instrument swaps / preset
shifts / restore. LLM classifier at
[/api/strummer/edit](../../src/app/api/strummer/edit/route.ts)
asks deepseek to pick ≤3 tokens, validates output against `ALL_EDIT_TOKENS`.
Falls back to a Chinese+English rule parser
([parsePromptToToken](../../src/modules/strummer/apply-edit.ts))
if the LLM is unavailable.

This design is clean. The product-level complaint about Studio (see §3) is
not that the *mechanism* is wrong, it is that the *visible surface* is
larger than the mechanism deserves.

### 2.7 Save / export

- Save goes Studio → NameScreen → `/api/songs` (POST), persisting
  [songs.ts](../../src/lib/db/schema/songs.ts) row with
  `arrangementState` + `visualConfig` JSON blobs + a base64 `mp3DataUrl`.
- Export surface on SongDetailScreen offers MP3 / share-HTML / poster PNG /
  audio-backed WebM. Render code in
  [src/modules/export/](../../src/modules/export).
- **`mp3DataUrl` is stored as a base64 data URL inside Postgres.** A 30 s
  mono MP3 at 128 kbps is ~480 KB; base64 → ~640 KB. Hundred saves per user
  → ~64 MB of JSON-column rows. This will not scale; needs object storage
  (S3 / R2 / 腾讯云 COS) before launch.
- SongDetail's `playWithTone` fallback (when `mp3DataUrl` is missing)
  reconstructs the melody from
  `arrangementState.melody.currentPattern.split(" ").map(Number)` — i.e. a
  flat pitch sequence at 0.5 s steps. This silently throws away rhythm,
  BPM, and the real arrangement engine. It will play, but it will sound
  wrong, and users won't know the difference unless they compare side by
  side.

## 3. Studio / Compose UX reality

[StudioScreen.tsx](../../src/components/screens/StudioScreen.tsx)
currently shows, on one page:

- Header (back, title + vibe + BPM, restore).
- Hero card (gradient + play / pause + title + BPM pill).
- Overview panel (4 meta pills: vibe / key / BPM / melody instrument).
- **AurisPanel** — text input + 9 chips arranged in 3 groups
  (balance / color / motion) +
  [AurisPanel](../../src/components/studio/auris-panel.tsx).
- **TrackMixer** — 6 instrument rows, each a toggle + 0–100% slider
  ([track-mixer.tsx](../../src/components/studio/track-mixer.tsx)).
- **SceneGrid** — 5 mood cards (warm / cinematic / minimal / lush /
  brighter) with particle accents
  ([scene-grid.tsx](../../src/components/studio/scene-grid.tsx)
  + [scene-presets.ts](../../src/components/studio/scene-presets.ts)).
- Save CTA.

Counted: **~28 interactive surfaces** on one screen, before any save / back /
play affordance. The user's complaint ("选项太多、交互不清晰") is
factual. AGENTS.md already says "Murmur is intentionally not a DAW" — Studio
ships against that intent.

## 4. Other screens — quick state

- **GalleryScreen** — clean, MyMind-style grid, OK. Loads from `/api/songs`
  on every visit. No deletion UI; only an inferred `removeSong` in the
  store with no caller wired.
- **SongDetailScreen** — works when `mp3DataUrl` exists; degrades silently
  (§2.7). Exposes a "Sliders" button that drops user back into Studio for
  the same song, which is correct but unlabelled. Manual playback fallback
  is musically wrong.
- **MeScreen** — exposes runtime transcription-chain debug strings
  ("remote-python -> browser-yin -> fixture") to end users; status text like
  "Strummer v0.2" is dev-facing copy in user space. The "A QUIET PLACE"
  manifesto is good. No payment / plan / quota panel exists.
- **VersionCardsOverlay** — 3-card vibe-pick overlay, working.
- **NameScreen** — pre-save naming step, working.

## 5. State + persistence

[murmur-store.ts](../../src/lib/store/murmur-store.ts) is
in-memory zustand with no persistence. Implications:

- A user who refreshes between "vibes generated" and "save" loses
  everything: melody, versions, current version. There is no draft / autosave.
- `setSongs` is overwritten on every gallery load from `/api/songs`. The
  client never authoritatively owns Gallery state.
- Browser autoplay rules + `startAudioContext()` are honored, but a
  hard refresh during processing leaves Tone.js + AudioContext orphaned —
  no global teardown.

## 6. API surface

`src/app/api/`:

| Route | Notes |
|---|---|
| `POST /api/transcribe` | Proxies to Python worker. **Unused by client**; the client calls the worker URL directly via the stainer facade. Dead route. |
| `POST /api/strummer/edit` | LLM edit token classifier. Working when `OPENAI_API_KEY` set. |
| `GET / POST /api/songs` | Gallery CRUD. |
| `GET / PATCH / DELETE /api/songs/[id]` | Song detail / mutate. |
| `GET / PATCH /api/user/profile` | Profile sync. |
| `POST /api/notifications/test` | Stub. |
| `POST /api/notifications/cron/daily-digest` | Cron route; publisher is a stub. |
| `GET / POST /api/mcp` | Model Context Protocol bridge for `getStats / listSongs / getSong / deleteSong`. |

## 7. Multi-platform reality

- The repo is web-only. No iOS / Android / 小程序 / Electron shell
  references anywhere in `src/` or `workers/`.
- Audio capture uses **`navigator.mediaDevices.getUserMedia` +
  `MediaRecorder`** with WebM/Opus. This API is browser-native; iOS Safari
  16+, Android Chrome, and Capacitor WebViews support it. **WeChat
  mini-program cannot run this code** — it would need `wx.getRecorderManager`.
- The melody polisher and YIN engine are pure TypeScript and would survive
  a port to any JS runtime. The Tone.js renderer needs `OfflineAudioContext`,
  which a WeChat mini-program does not expose.
- Implication: a server-side audio + arrangement pipeline is the only path
  that unifies these targets cleanly. See `cross-platform-strategy.md`.

## 8. Open observations the v2 plan should not forget

1. The "MP3-in-Postgres" pattern (§2.7) will block any serious launch.
2. `auth-client` / `server-auth` are stubs that any caller can spoof; no
   payment work is meaningful until this is real.
3. The fixture silent-fallback (§2.2) needs a user-visible "we couldn't
   read your hum, here are options" surface before any audio investment
   pays off.
4. There is no rate limit / quota / abuse-protection on `/api/strummer/edit`
   — anyone with the public route can burn the OpenAI quota.
5. There are no integration tests on the audio pipeline. The verification
   log in [verification.md](../verification.md) is
   manual + UI-only.
6. The Python worker has no deployment story. It is documented as a real
   provider but cannot be reached in production.
7. `currentPattern` is overloaded: for `melody` it stores
   `"60 62 64 …"`; for `chords` it stores `"gen:sunset"`; for `bass / drums`
   it stores pattern-name strings; for `texture` it stores `"tex:rain"`.
   See `assemble-song.ts:90` for the mapping. This double-meaning is the
   root cause of SongDetail's broken fallback playback (§2.7).

These are the surfaces the v2 docs build on.
