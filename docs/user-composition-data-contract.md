# User Composition Data Contract

Status: active design note

Owner: product data / music systems maintainer

Last reviewed: 2026-07-18

Murmur's valuable training and feedback data is the user-linked composition
sequence: account -> recording/transcription -> generated versions -> edits ->
saved song -> playback/share/export/purchase outcomes. This document names the
data that already persists in Postgres and the retrieval shapes future model,
quality, and product analysis should use.

It is a data contract, not permission to export personal data. Any dataset
build must respect account deletion, privacy policy, and the minimum necessary
fields for the analysis task.

## Current durable sources

### `users`

Defined in `src/lib/db/schema/users.ts`.

Stable account index:

- `id`
- `email` when registered
- `accountKind`
- `regionId`
- `planTier`
- `createdAt`
- `promotedAt`
- `deletedAt`

Use `users.id` as the join key for songs, notes ledger, purchases, sessions,
push subscriptions, and referrals. Do not use email as a training identifier.

### `songs`

Defined in `src/lib/db/schema/songs.ts`.

This is the primary composition artifact table. Important fields:

- identity and ownership: `id`, `userId`, `createdAt`, `updatedAt`
- public state: `visibility`, `shareCode`
- lineage: `parentSongId`, `rootSongId`, `lineageDepth`
- musical summary: `title`, `vibe`, `vibeEn`, `bpm`, `keySignature`,
  `scaleType`, `duration`, `tags`
- source/edit state: `sourceMelodyKind`, `editCount`, `editDepth`
- canonical music JSON: `melody`, `arrangementState`, `visualConfig`
- audio artifact: `mp3Url`, `mp3StorageKey`, legacy `mp3DataUrl`
- schema/provenance: `artifactVersion`, `provenance`, `saveFingerprint`

The `melody` JSONB stores the canonical cleaned melody (`CleanMelody`) with
note pitch, start, duration, velocity, and confidence. `arrangementState` stores
the editable six-track arrangement. `visualConfig` stores the selected artwork
and visual facets. `provenance` links a saved song back to the creation flow,
draft, recording operation, and generation batch/clip when the client supplied
those ids.

Index-ready retrieval paths that already exist:

- user shelf: `songs.user_id, songs.created_at DESC`
- song detail: `songs.id`
- owner song detail: `songs.id + songs.user_id`
- public share: `songs.share_code`
- lineage traversal: `parent_song_id`, `root_song_id`, `lineage_depth`

The current schema has `songs_user_created_idx`; if analysis or product surfaces
need frequent lineage traversal, add explicit indexes for `root_song_id` and
`parent_song_id` in a future migration before running broad queries.

### `notes_ledger`

Defined in `src/lib/db/schema/notes-ledger.ts`.

This is the durable economic/action audit trail for notes balance changes.
Important fields:

- `userId`
- signed `delta`
- `reason`
- `externalRef`
- `metadata`
- `createdAt`

Use it to reconstruct paid/free action timing, save spends, generation spends,
refunds, signup grants, purchases, and referral grants. `externalRef` should
point to the product object when available, such as a song id, operation id, or
provider transaction id.

### `purchases`, `events_webhook`, `share_referrals`

These tables connect music behavior to payment, webhook reliability, and invite
attribution:

- `purchases`: top-up provider, product, amount, currency, notes granted,
  status, and raw provider payload.
- `events_webhook`: provider event id, route id, verification/process status,
  and raw payload for payment/webhook replay analysis.
- `share_referrals`: referrer/invitee relationship and settled ledger rows.

## Canonical analysis rows

Prefer exporting narrow, typed rows instead of raw table dumps.

### Composition artifact row

One row per saved song:

```text
song_id
user_id_hash
created_at
artifact_version
source_type
source_melody_kind
capture_quality
flow_id
draft_id
recording_operation_id
generation_batch_id
generation_clip_id
generation_batch_index
parent_song_id
root_song_id
lineage_depth
edit_count
edit_depth
vibe
vibe_en
bpm
key_signature
scale_type
duration
melody_note_count
melody_pitch_sequence
melody_timing_sequence
arrangement_track_summary
visual_bucket
visual_mood
visual_energy
has_audio
audio_storage_driver
visibility
share_created
save_fingerprint
```

### User composition sequence row

One row per user-song edge, ordered by time:

```text
user_id_hash
song_id
created_at
sequence_index
days_since_first_song
parent_song_id
root_song_id
lineage_depth
source_melody_kind
edit_count
edit_depth
notes_spent_near_save
share_state
purchase_state_at_save
```

This row is the default shape for product iteration, retention analysis, and
model-quality feedback. It preserves sequence without exposing email or raw
session identifiers.

## Retrieval guidance

Use Postgres as the system of record:

1. Start from `songs` filtered by `created_at` and `deleted_at`-safe user joins.
2. Join `users` only for account kind, region, plan tier, and deletion state.
3. Join `notes_ledger` by `user_id` plus `external_ref` when reconstructing
   spend/save/generation actions.
4. Join `purchases` only for coarse payment state at or before song creation.
5. Join public/share tables only when studying sharing behavior.

Never use gallery summary queries for dataset builds; they intentionally omit
large music JSON and audio fields. Use full song rows or a dedicated projection.

## Known gaps

The current backend preserves saved-song provenance, but not every pre-save
interaction is durable yet:

- raw uploaded recordings are not retained as a training corpus;
- rejected Vibe versions are only recoverable while the client draft survives;
- Studio edit events are summarized as `editCount` / `editDepth`, not stored as
  a full edit-token event stream;
- playback/export feedback is mostly client-side unless routed through a
  future durable event sink.

Before model training, add an explicit event table or external warehouse sink
for consent-safe interaction events. Use stable operation ids already present in
`SongProvenance` so events can join back to `songs` without relying on brittle
client-local state.

## Privacy and retention

- Hash or pseudonymize `userId` for analysis exports.
- Exclude `email`, `avatarUrl`, raw IPs, user agent strings, and provider raw
  payloads unless the task explicitly requires them.
- Exclude soft-deleted users and honor account-deletion purge semantics.
- Treat raw audio as sensitive creative data. Store derived features and object
  keys only when raw audio is not required.
- Record dataset build time, source commit SHA, SQL/query version, and field
  list next to every export.
