# Song Audio Delivery

Status: active rollout runbook<br>
Owner: product engineering / on-call maintainer<br>
Last verified: 2026-07-30

Use this runbook when saved songs cannot play, download, export, or share from
Gallery even though Studio preview worked.

## Contract

`songs.mp3_storage_key` is the durable coordinate. Clients receive a same-origin
`audioUrl`; storage credentials, keys, and raw private URLs do not leave the
server response. Owner and public routes re-authorize every request and support
`HEAD`, one byte `Range`, inline playback, and `?download=1` attachments.

The resolver is deliberately strict:

- a present storage key wins over legacy fields;
- a missing keyed object returns `410 audio_missing` and is not hidden by a
  stale data URL;
- historical data URLs and recognized legacy object URLs remain readable;
- share publication checks that the artifact is currently readable;
- share metadata and media are `no-store`, so revocation is immediate.

## Durable Object Lifecycle

The `song_audio_objects` table is the object-store outbox and ownership record:

- save reserves `pending` before uploading bytes;
- the song insert and transition to `committed` share one DB transaction;
- song deletion removes the row and transitions the object to
  `delete_pending` in one DB transaction;
- `/api/storage/cron/song-audio` claims stale `pending` uploads and
  `delete_pending` objects with leases, then retries deletion with bounded
  exponential backoff;
- `deleted` is written only after the storage adapter confirms deletion.

This ordering deliberately prefers a reclaimable object over a song row that
points at missing bytes. A process crash or failed DB write after upload leaves
a `pending` receipt for the cron to reclaim. A failed object deletion leaves a
`delete_pending` receipt and does not report lifecycle completion.

The production scheduler must send `Authorization: Bearer $CRON_SECRET` every
15 minutes. Alert when the route returns `5xx`, when a `207` persists for two
runs, or when the oldest due row is more than 30 minutes old. Never delete
`committed` rows from an operator script.

## Runtime Ownership And Fallbacks

| Surface | Device/browser | Murmur service | Fallback policy |
| --- | --- | --- | --- |
| Recording and draft editing | Temporary media, draft state, IndexedDB recovery | No canonical copy until upload/save | Device recovery may resume an interrupted UI flow |
| Saved song metadata | Cached response/UI state only | Postgres is canonical | Local/demo song store only when DB fallback is explicitly enabled |
| Saved song master | Blob used during current render/export | Object storage is canonical; Postgres stores its key and lifecycle | Data URLs are legacy/local-demo compatibility only and are rejected as a production persistence fallback |
| Playback/download/share | Same-origin authenticated or capability URL | API re-authorizes and streams validated bytes | Historical data URLs and recognized legacy URLs remain readable; a missing durable key is `410`, never silently replaced |
| Static UI/WASM/artwork | App bundle, service-worker/browser caches | Versioned deployment/CDN origin | Cached assets may keep the shell usable; they do not become canonical user data |

Production must configure Postgres, `CRON_SECRET`, and an S3-compatible storage
adapter. Local development defaults to local filesystem storage and may opt
into explicit demo/auth fallbacks; those modes are not production failover.

## Two-Phase Rollout

1. Deploy the controlled audio routes, response contract, and compatible UI
   with `MURMUR_PRIVATE_SONG_AUDIO_DELIVERY` unset/false.
2. Configure a dedicated long-lived public smoke fixture via the GitHub
   `MURMUR_SMOKE_SHARE_CODE` variable. Optionally configure owner smoke with
   `MURMUR_SMOKE_SONG_ID` plus the `MURMUR_SMOKE_SESSION_TOKEN` secret.
3. Confirm production smoke proves `HEAD 200`, `Range 206`, recognizable audio
   bytes, and attachment disposition on the exact release SHA.
4. Exercise Save -> Gallery -> Detail -> Download -> Share in a real browser,
   then revoke the share and confirm metadata/audio return `404`.
5. Treat that Web release as the new rollback baseline. Only then set
   `MURMUR_PRIVATE_SONG_AUDIO_DELIVERY=1`, deny anonymous CDN/bucket access to
   `songs/master/*`, and release again. Keep genuinely public poster/share
   prefixes separate.

Do not enable private writes before step 5. Rolling back to an older Web build
would otherwise remove the only authorized route for newly private masters.
The adapter's `scope: private` is intent metadata, not an S3 ACL. The rollout is
not private until an anonymous request to the old direct object URL returns
`403` or `404` while both controlled routes still pass.

## Incident Triage

1. Start from song id and request id. Check `song.audio_delivery_failed`,
   `song.audio_missing`, `public_song.audio_delivery_failed`, and
   `public_song.audio_missing`.
2. Confirm the row has the expected `mp3_storage_key`; never paste raw audio or
   storage credentials into logs or tickets.
3. Run authenticated `HEAD` and `Range` requests against the owner route.
4. For a share incident, confirm visibility/share code in Postgres and test the
   public route without cookies. Revoked links must be `404`, not stale `200`.
5. If save accepted no audio, inspect `song.audio_payload_rejected` and
   `song.audio_upload_failed`. Mislabeled or corrupt MP3/WAV bytes are rejected.
6. If deletion logs `song.audio_cleanup_failed`, inspect the corresponding
   `song_audio_objects` row. Leave it in `delete_pending`, correct the storage
   dependency, and let the cron retry. Manual deletion is safe only when the
   same row is subsequently marked `deleted` through the normal helper.
7. For cleanup lag, compare `next_attempt_at`, `lease_until`, and `attempts`.
   An expired lease is claimable; a future retry time is intentional backoff.

## Release Evidence

- targeted route tests for auth, Range, HEAD, download, revoke, and missing
  objects;
- full lint, test, typecheck, build, and schema checks;
- production release smoke with `--require-audio`;
- one real-browser save/play/download/share/revoke check;
- confirmation that the object-store lifecycle and bucket access match the
  current rollout phase.
- after private cutover, evidence that direct `songs/master/*` access is denied.
- evidence that one forced deletion failure remains `delete_pending` and a
  later cron run reaches `deleted` without a dangling song row.
