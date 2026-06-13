# Phase 0 Plan — Pre-flight

Date: 2026-06-03

## User / System Problem

Murmur v2 cannot safely move to the server-authoritative audio pipeline while
core state still hides overloaded fields, dead routes, silent fallback paths,
and untested music output. Phase 0 locks the smallest foundations that later
phases depend on without changing the visible creation flow.

## Real Constraints

- Current runtime is still the root Next.js app under `src/`; the
  `apps/web/` move is Phase 5, not Phase 0.
- `packages/murmur-core/` exists as scaffold only and should not become a
  broad import migration in this phase.
- Studio / Gallery / SongDetail UI rewrites are deferred by
  `docs/execution-roadmap.md`.
- Guest-safe local demo behavior must stay intact until Phase 3 replaces the
  spoofable header auth.

## Stable Behavior

- `Hum -> Vibe -> Studio -> Save -> Gallery -> Song detail` remains usable.
- Existing saved songs with legacy `currentPattern` fields still replay and
  render as before.
- Fixture melody remains available only through existing explicit demo paths;
  Phase 0 does not solve the full silent fallback chain.

## Stops / PRs

1. **Track state preflight.** Add typed `TrackState` fields
   (`melodyPitchSequence`, `chordsTag`, `bassPattern`, `drumsPattern`,
   `texturePreset`) while keeping `currentPattern` for compatibility.
   Update generation and assembly reads to prefer the typed fields.
2. **Dead proxy + store cleanup.** Remove the unused `/api/transcribe`
   proxy route and replace `setSongs` bulk overwrite with a named
   server-sync action so Gallery can hydrate without treating the client
   store as authoritative.
3. **User region foundation.** Add `users.regionId` to the schema with
   default `"intl"` and add the reversible migration pair.
4. **Observability seed.** Add a typed structured log helper and use it
   at the music pipeline entry point that Phase 0 touches.
5. **Smoke test + CI.** Add the first deterministic music smoke test and
   wire `bun test` into local scripts + CI.

## Validation

- `bun test`
- `bun run lint`
- `bun run build`

## Done Checklist

- [x] Phase 0 roadmap acceptance items are either completed here or
      explicitly carried forward.
- [x] Build is clean.
- [x] Smoke test runs in CI.
- [x] Any boundary changes are documented in this file.

## Shipped

- Added typed `TrackState` fields for melody pitches, chord tags, bass,
  drums, and texture while keeping deprecated `currentPattern` reads for
  saved-song compatibility.
- Removed the dead client-store song overwrite path so Gallery fetches are
  treated as server snapshots, not local authority.
- Added `users.region_id` plus a reversible migration pair; Drizzle now points
  at the schema index so unregistered v2 scaffold tables do not migrate early.
- Seeded structured audio/arrangement/song logs and added a deterministic
  music smoke test wired into `bun test` and CI.
- Tightened demo resilience: guest Gallery reads return an empty list when the
  local DB is down, while mutations still fail loudly.
- Added a bounded audio-quality improvement by clamping generated melody notes
  to the selected melody carrier range.

## Validation Evidence

- `bun test` passed.
- `bun run lint` passed.
- `bun run build` passed.
- Local browser smoke covered `/gallery` and `/me` with the DB unavailable;
  Gallery rendered the empty state and emitted `song.list_failed` instead of
  throwing.

## Reflection

- The docs were right about `currentPattern`: it was cheap to add typed fields,
  but useful reads were spread across generation, assembly, and song replay.
- Drizzle's schema-folder behavior was sharper than expected. Pointing
  generation at `src/lib/db/schema/index.ts` is the correct boundary until
  later phases intentionally register purchases, sessions, and ledgers.
- Tailwind/PostCSS under Turbopack was a local-demo risk unrelated to product
  logic. Switching dev to webpack is a temporary stability choice, not a
  product architecture decision.
- Phase 1 should not start with SwiftF0 polish alone. The first useful slice is
  removing silent fixture fallback from real recordings and restoring
  `/api/transcribe` as the server-authoritative boundary; denoise/SwiftF0 can
  then land behind that boundary without another client rewrite.
