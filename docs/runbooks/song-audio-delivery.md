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
6. If deletion logs `song.audio_cleanup_failed`, reconcile the key manually.
   Cleanup is best effort after DB deletion today; a retryable storage-cleanup
   outbox remains follow-up work before claiming automatic lifecycle closure.

## Release Evidence

- targeted route tests for auth, Range, HEAD, download, revoke, and missing
  objects;
- full lint, test, typecheck, build, and schema checks;
- production release smoke with `--require-audio`;
- one real-browser save/play/download/share/revoke check;
- confirmation that the object-store lifecycle and bucket access match the
  current rollout phase.
- after private cutover, evidence that direct `songs/master/*` access is denied.
