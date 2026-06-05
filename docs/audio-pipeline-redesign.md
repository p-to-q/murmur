# Audio Pipeline Redesign

This is the stable landing page for Murmur's v2 audio-pipeline references.
Several planning docs point here as the canonical hum-to-score redesign spec.

## Out of scope

This page does not restate every detailed audio research note. It exists to
keep the repo's document graph valid and to point readers at the current source
of truth.

## Current status

The full redesign has not been checked in as a single standalone spec file in
this branch. Today, the closest active sources are:

- [diagnosis-2026-06.md](diagnosis-2026-06.md) for the factual current-state
  audio pipeline
- [research-2026-06.md](research-2026-06.md) for external research and
  implementation borrowing notes
- [cross-platform-strategy.md](cross-platform-strategy.md) for shell and
  backend split decisions
- [execution-roadmap.md](execution-roadmap.md) for phase sequencing
- [phase-plans/phase-1-server-transcribe.md](phase-plans/phase-1-server-transcribe.md)
  for the first server-authoritative transcription cut
- [phase-plans/phase-1-hum-surface.md](phase-plans/phase-1-hum-surface.md) for
  hum-surface UX and fallback handling

## Working contract

Until a fuller redesign doc is restored, read the audio plan as:

1. Current product and pipeline reality:
   [diagnosis-2026-06.md](diagnosis-2026-06.md)
2. Research and borrowing directions:
   [research-2026-06.md](research-2026-06.md)
3. Concrete implementation phases:
   [execution-roadmap.md](execution-roadmap.md) and the phase plans

## Next durable upgrade

When Murmur's audio redesign is restated in one doc again, replace this bridge
page with the full spec rather than creating another filename.
