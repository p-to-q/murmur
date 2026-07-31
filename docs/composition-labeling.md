# Composition Labeling Contract

Status: implementation contract<br>
Owner: product data / music systems<br>
Last reviewed: 2026-07-31

Murmur has `composition_events`, provenance ids, and a typed training export.
`generation.completed` records bounded technical evidence before synchronous
audio is delivered or a durable job reaches `succeeded`; `song.saved` records
the durable artifact link. Evidence failure keeps delivery fail-closed.
`song.shared`, `song.exported`, and `song.feedback` are reserved but not
connected to product actions. Treat them as gaps, not collected data.

## Label unit

The default unit is one generated clip or saved song version. Join labels using
`songId`, `generationBatchId`, and `generationClipId`; never join by title,
email, prompt text, or timestamps alone.

Explicit quality feedback uses `song.feedback` with a bounded payload:

```json
{
  "schemaVersion": 1,
  "origin": "listener | creator | reviewer | automatic_gate",
  "overall": 1,
  "melodyMatch": 1,
  "musicality": 1,
  "arrangementCoherence": 1,
  "audioArtifacts": "none | minor | major",
  "reasonCodes": ["melody_drift"],
  "model": "mrt2_base",
  "qualityGateVersion": "music-technical-v2"
}
```

Scores are integers from 1 to 5. Omitted dimensions mean “not rated.” Initial
reason codes are `melody_drift`, `timing_drift`, `wrong_harmony`,
`poor_structure`, `harsh_timbre`, `noise_or_artifact`, `too_sparse`,
`too_busy`, `good_match`, and `good_musicality`.

Automatic Gate outcomes must not masquerade as human ratings. Store them with
`origin=automatic_gate`, no 1-5 score, and explicit failure codes. Keep free
text out of training exports unless separately consented and reviewed.

## Collection sequence

1. Record automatic diagnostics for every successful generation without raw
   inputs or prompt text. The event is keyed by generation batch/clip id and
   carries the exact output SHA-256, Worker input receipt hashes, quality
   metrics, candidate evidence, runtime labels, and bounded cost/timing fields.
2. Collect creator feedback on selected and rejected versions where identity
   remains available.
3. Write share/export/play outcomes as lifecycle events, not quality labels.

Training export links pre-save generation evidence to a saved artifact only when
user, generation batch id, generation clip id, and exact output SHA-256 all
match. Reusing a clip id during recovery cannot attach evidence from different
audio bytes; saving the same exact generated clip more than once remains valid.
The song save API verifies this tuple against server-authored evidence before it
persists generation provenance. Incomplete, forged, or temporarily unverifiable
generation identity is removed while ordinary flow/draft provenance and the
user's save remain available.
4. Send important samples to a blinded reviewer queue with two ratings and
   adjudication when dimensions differ by more than two points.
5. Build versioned exports excluding deleted users and honoring consent and
   retention policy.

`listCompositionTrainingExamples` requires an explicit `consentedUserIds`
allowlist from a separately reviewed consent source and rechecks deletion before
returning. An empty allowlist exports nothing. Do not derive this allowlist from
save, play, share, export, billing, or account activity.

The export marks a linked generation as
`generationLinkTrust: "user_asserted_server_verified"`: the event and digest
exist as server evidence, while the user's choice to associate that generation
with a song remains user-asserted. Never use this association alone as a
quality label; quality training requires explicit feedback or reviewer labels.

## Dataset release receipt

Every export records dataset name/version, build time, source commit, query
version, fields/event kinds, consent/deletion cutoff, model/prompt/conditioning
and Gate versions, split/deduplication policy, counts by source/Vibe/quality
bucket, coverage gaps, and reviewer agreement.

Raw recordings are sensitive creative data. A product event or saved song is
not by itself permission to train on raw audio.
