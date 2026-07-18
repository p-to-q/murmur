# Composition Labeling Contract

Status: implementation contract<br>
Owner: product data / music systems<br>
Last reviewed: 2026-07-19

Murmur has `composition_events`, provenance ids, and a typed training export.
At present only `song.saved` is written. `song.shared`, `song.exported`, and
`song.feedback` are reserved but not connected to product actions. Treat them
as gaps, not collected data.

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
  "qualityGateVersion": "music-technical-v1"
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

1. Record automatic diagnostics for every generation without raw inputs.
2. Collect creator feedback on selected and rejected versions where identity
   remains available.
3. Write share/export/play outcomes as lifecycle events, not quality labels.
4. Send important samples to a blinded reviewer queue with two ratings and
   adjudication when dimensions differ by more than two points.
5. Build versioned exports excluding deleted users and honoring consent and
   retention policy.

## Dataset release receipt

Every export records dataset name/version, build time, source commit, query
version, fields/event kinds, consent/deletion cutoff, model/prompt/conditioning
and Gate versions, split/deduplication policy, counts by source/Vibe/quality
bucket, coverage gaps, and reviewer agreement.

Raw recordings are sensitive creative data. A product event or saved song is
not by itself permission to train on raw audio.
