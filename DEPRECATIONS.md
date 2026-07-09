# Deprecations

Surfaces marked for removal in the v2 cutover. Every entry has a
replacement, a `@deprecated since v2; use X. Removed v3.` JSDoc tag in
code, and an ESLint rule that warns on new uses.

When a surface is removed, the entry moves to "Removed" with the SHA of
the removal commit.

## Pending removal (slated for v3)

| Surface | Reason | Replacement | Linked doc |
|---|---|---|---|
| `apps/web/src/modules/stainer/providers/browser-basic-pitch.ts` | Basic Pitch monophonic accuracy is too low for solo hum | server SwiftF0 | `docs/audio-pipeline-redesign.md` §4.3 |
| `apps/web/src/modules/stainer/providers/remote-python.ts` | Superseded by the proxied `/api/transcribe` route | server-side audio worker | `docs/audio-pipeline-redesign.md` §6 |
| `apps/web/src/lib/db/schema/songs.ts` column `mp3DataUrl` | Storing MP3 as base64 inside Postgres does not scale | `mp3Url` (object storage) | `docs/data-model.md` §3.6 |
| `NEXT_PUBLIC_TRANSCRIPTION_PROVIDER` env var | Build-time provider switch is gone; the server picks per-request | n/a | `docs/audio-pipeline-redesign.md` §9 |
| `NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER` env var | Same as above; Basic Pitch is dropped | n/a | `docs/audio-pipeline-redesign.md` §6 |
| `getRequestUser(request)` reading `x-murmur-user-id` header | Header-based identity is spoofable; v2 uses sessions | `authenticate(req)` resolver | `docs/user-model.md` §4 |
| `resolveUserId(request)` direct calls in API routes | Same | `authenticate(req).user.id` | `docs/api-conventions.md` §5 |
| Free-form `console.log` in `apps/web/src/app/api/` | Replaced by typed event taxonomy | `log("<event>", ext)` | `docs/observability.md` §2 |
| Single `src/lib/store/murmur-store.ts` | One mega-store; v2 splits per concern | per-concern zustand stores | `docs/engineering-standards.md` §5 |
| `apps/web/src/app/api/transcribe/route.ts` proxy-only shape | Replaced by full pipeline + diagnostics | new route per `docs/audio-pipeline-redesign.md` §5 | same |
| Silent fixture fallback in the Stainer chain | Hidden failure mode; the most dangerous v1 bug | explicit "Try a demo melody" button + 422 error path | `docs/audio-pipeline-redesign.md` §6 |
| `arrangementState.melody.currentPattern.split(" ").map(Number)` playback reconstruction in SongDetail | Loses BPM + rhythm | `song.melody` JSON column | `docs/data-model.md` §3.6 |
| `MeScreen` runtime provider chain debug strings | Engineering-internal copy in user space | `/me/debug?debug=1` overlay | `docs/page-contracts.md` §7 |

## Reserved removals (v3+)

- `apps/web/src/lib/auth/index.ts` (re-export shim) — once all callers
  import from `@/lib/platform/server-auth` directly.
- `src/modules/` term — folded into `packages/murmur-core` in Phase 5.

## Removed

| Surface | Reason | Replacement | Removal note |
|---|---|---|---|
| `src/lib/music/stainer.ts` | Legacy facade no longer had source callers | `src/modules/stainer/transcribe.ts` | Removed in local cleanup; route still uses the server-side audio pipeline. |
| `src/lib/music/providers/*` | Browser-side provider shim no longer participated in transcription | `src/modules/stainer/providers/fixture.ts` for explicit demo fixture | Removed in local cleanup. |
| `src/modules/stainer/providers/basic-pitch.d.ts` | Orphan type shim for the deleted browser Basic Pitch provider | server SwiftF0 / audio worker | Removed in local cleanup. |
| `src/lib/http/deadline.ts` | Built-out timeout library with zero production consumers; misled audits into thinking external calls had timeout wiring | per-call `AbortSignal.timeout` at the call sites | Removed in optimization pass (2026-07-09). |
| `src/modules/export/render-poster.ts`, `render-share-html.ts` | Superseded share pipeline; live paths are `ShareTicketCard.tsx` + `export-video.ts` | `src/components/song-detail/ShareTicketCard.tsx` | Removed in optimization pass (2026-07-09). |
| `requireAuth` / `resolveUserId` (legacy header-auth exports) | Guest-returning auth beside `resolveRequestAuth` was a footgun; zero callers | `resolveRequestAuth(req)` | Removed in optimization pass (2026-07-09); `getRequestUser` stays internal to the resolver. |
| `upsertGoogleUser` + `GoogleProfileInput` | Deprecated shim over the provider-agnostic upsert | `upsertOAuthUser` | Removed in optimization pass (2026-07-09). |
| `deleteUser` (hard delete) | Product policy is soft-delete only; a hard-delete helper beside it was an invariant hazard | `requestAccountDeletion` | Removed in optimization pass (2026-07-09). |
| `getCloudBalance` / `hasEnoughBalance` | Deprecated client balance fetch | `hasLocalNotes` (guests) / server ledger via `/api/auth/me` | Removed in optimization pass (2026-07-09). |
| `rateLimitOrThrow` | No route callers; routes use `checkApiRateLimit` + `rateLimitedResponse` | `checkApiRateLimit` | Removed in optimization pass (2026-07-09). |
| `buildSavedSongVibeVersions` | Superseded by the Magenta remix path | `buildSavedSongRemixVersions` | Removed in optimization pass (2026-07-09). |
| Store `isPlaying`/`playingSongId`/`setPlaying`, `radioStationId`, `VibeVersion.previewAudioUrl` | Retired gallery-playback design; `setPlaying` had zero call sites so the flags were permanently false | component-local playback state + `auditioningVersionId` | Removed in optimization pass (2026-07-09). |

## Process

- New uses of any pending-removal surface fail PR lint (`no-deprecated`).
- The deprecation tag includes a date and a link to the replacement
  doc.
- Removal happens in a single PR titled `chore(deprecation): remove <X>`.
