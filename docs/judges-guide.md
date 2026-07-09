# Judges Guide

This document is written for two kinds of reviewers:

- `code bot judge`:
  what is structurally interesting, where the robustness lives, and how the
  pipeline is assembled
- `design bot judge`:
  what is intentionally designed in the visible product, what hierarchy and
  tone choices were made, and where those decisions show up in code

## 1. Product Idea In One Sentence

Murmur turns a rough sung idea into a small, shaped song artifact that can be
refined and exported, not just detected and played back.

The point is not pure transcription accuracy alone. The point is to help a
user move from a fragile melodic gesture to something that feels authored.

## 2. User Journey

The intended experience is a five-step arc:

1. `Create / Hum`
   capture an imperfect melody sketch
2. `Vibe`
   branch the same melody into distinct emotional directions
3. `Studio`
   make guided arrangement edits without dropping into a DAW
4. `Gallery`
   keep and revisit saved songs
5. `Song Detail`
   preview, listen, and export as share artifacts

This arc matters to both code and design:

- product-wise, each screen carries one dominant decision
- engineering-wise, each stage hands off a cleaner artifact than the one before

## 3. What Is Deliberately Designed

### 3.1 Not a DAW

We intentionally avoid exposing a dense “music workstation” interface.

Instead of presenting dozens of controls at once, the visible surfaces are:

- one recording action
- one vibe choice moment
- one compact arrangement page
- one export surface

That is a design decision, not a lack of features.

### 3.2 Editorial, Not Gadgety

The front-end leans toward a calmer, more editorial composition:

- warm neutrals instead of neon tool chrome
- serif display moments for song identity
- restrained motion rather than constant spectacle
- grouped actions with emotional hierarchy

This is easiest to see in:

- [src/components/screens/HumScreen.tsx](../src/components/screens/HumScreen.tsx)
- [src/components/screens/StudioScreen.tsx](../src/components/screens/StudioScreen.tsx)
- [src/components/screens/SongDetailScreen.tsx](../src/components/screens/SongDetailScreen.tsx)

### 3.3 Guided Creativity

Instead of treating music generation as a single black-box prompt, the product
lets the user intervene at meaningful but bounded layers:

- vibe choice
- mood scene changes
- compact track balancing
- natural-language “Auris” edit prompts

This gives the user agency without asking them to understand production jargon.

## 4. What Is Deliberately Engineered

### 4.1 Raw Hum Is Not Trusted As Final Music

The pipeline assumes humming is noisy, unstable, and expressive.

That means the system does not stop at “pitch detection succeeded”.
It continues through:

- note filtering
- pitch drift correction
- tonal inference
- cadence stabilization
- arrangement generation

See:

- [docs/music-engine.md](./music-engine.md)
- [src/modules/music/melody-polisher.ts](../src/modules/music/melody-polisher.ts)

### 4.2 Shared Musical Core

One of the main architectural choices is that the app tries to keep preview,
save, and export aligned rather than letting each surface drift into its own
implementation.

The same song logic feeds:

- live preview
- saved audio render
- visual export metadata
- video export

This reduces “what I heard is not what I got” failure modes.

### 4.3 Runtime Fallbacks

The transcription side is built with explicit runtime awareness and fallbacks.

The hierarchy is:

- best available real provider first
- backup provider next
- fixture only as last resort

See:

- [docs/provider-strategy.md](./provider-strategy.md)
- [src/app/api/transcribe/route.ts](../src/app/api/transcribe/route.ts)
- [src/modules/stainer/transcribe.ts](../src/modules/stainer/transcribe.ts)

### 4.4 Export Is Treated As Product Surface

Export is not just file download plumbing. It is one of the visible outputs of
the system, so it has its own design/engineering layer:

- audio export
- share ticket image export
- real shareable video export with the existing audio embedded

See:

- [src/components/murmur/share-card-modal.tsx](../src/components/murmur/share-card-modal.tsx)
- [src/components/song-detail/ShareTicketCard.tsx](../src/components/song-detail/ShareTicketCard.tsx)
- [src/modules/export/export-video.ts](../src/modules/export/export-video.ts)

## 5. Granularity We Want Reviewers To Notice

The project’s thinking is intentionally spread across several levels of
granularity:

### Level A: Flow granularity

Each screen has a single dominant job.

- `Hum`: capture and reassure
- `Vibe`: compare directions
- `Studio`: refine arrangement
- `Song Detail`: consume and export

### Level B: Interaction granularity

Within a screen, controls are grouped by user intent rather than by raw data
type.

Examples:

- `Studio` groups “mix”, “mood”, and “AI edit”
- `Song Detail` groups playback, live visual preview, and export

### Level C: Music granularity

The melody is not treated as one opaque blob. We separately reason about:

- pitch
- rhythm
- key / scale
- phrase boundaries
- cadence
- arrangement state per track

### Level D: Export granularity

A saved song is not a single flat asset. It can produce:

- playable audio
- HTML share page
- poster card
- audio-backed video

### Level E: Failure granularity

The system distinguishes between:

- microphone failure
- transcription provider unavailability
- render failure
- audio missing during export
- browser capability missing for preferred video container

That separation is important because it lets the app degrade instead of simply
collapsing.

## 6. Suggested Review Path

If you only have a few minutes, read in this order:

1. [README.md](../README.md)
2. [docs/judges-guide.md](./judges-guide.md)
3. [docs/music-engine.md](./music-engine.md)
4. [src/components/screens/HumScreen.tsx](../src/components/screens/HumScreen.tsx)
5. [src/components/screens/StudioScreen.tsx](../src/components/screens/StudioScreen.tsx)
6. [src/components/screens/SongDetailScreen.tsx](../src/components/screens/SongDetailScreen.tsx)
7. [src/modules/export/export-video.ts](../src/modules/export/export-video.ts)

## 7. Short Summary

If there is one thing to notice, it is this:

Murmur is not only trying to generate music. It is trying to shape an
end-to-end creative artifact with product judgment at every visible layer:
capture, interpretation, arrangement, identity, and export.
