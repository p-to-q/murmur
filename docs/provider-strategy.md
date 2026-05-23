# Provider Strategy

## Stainer = single transcription facade

All UI calls `transcribeWithStainer(input)` from `src/modules/stainer/transcribe.ts`.
No screen reaches into a provider module directly. The facade decides which
provider to try, and **always** falls through to `fixture` as a last resort so
the user never sees a dead-end.

```
src/modules/stainer/
  transcribe.ts                  ← public API, the only thing UI imports
  providers/
    browser-yin.ts               ← default — zero-deps, offline, instant
    remote-python.ts             ← optional upgrade — calls PYIN worker
    browser-basic-pitch.ts       ← opt-in — Spotify Basic Pitch, ~7MB CDN model
    fixture.ts                   ← always available, demo-safe fallback
```

## Provider order

Controlled by `NEXT_PUBLIC_TRANSCRIPTION_PROVIDER`:

| Value (client-exposed)   | Order                                                            |
|--------------------------|------------------------------------------------------------------|
| `browser-yin` *(default)*| browser-yin → remote-python → browser-basic-pitch → fixture      |
| `remote-python`          | remote-python → browser-yin → browser-basic-pitch → fixture      |
| `browser-basic-pitch`    | browser-basic-pitch → browser-yin → remote-python → fixture      |
| `fixture`                | fixture (demo-only mode)                                         |

When `input.audioBlob` is undefined (e.g. the "Try the example melody" button
on HumScreen) the facade short-circuits to `[fixture]` regardless of config.

## Why YIN as the default?

Hum recordings are short and monophonic — the case YIN is built for. Compared
to Basic Pitch:

- **YIN**: zero install, runs offline, ≤200ms latency for a 10s hum, ~46ms per
  frame on commodity hardware.
- **Basic Pitch**: more accurate on polyphonic / instrumental input, but
  downloads a 7MB TensorFlow model and takes 3–8s on first use.

For our case (hum → melody) the YIN result is plenty for the polish pipeline
(`src/modules/music/melody-polisher.ts`) to snap-to-scale and quantize. Basic
Pitch becomes the better choice if we ever accept guitar/piano input.

## Audio format

Browser records `audio/webm;codecs=opus`. The Python PYIN worker accepts that
directly (decodes via pydub). The browser-yin engine decodes via
`AudioContext.decodeAudioData` and resamples in JS.

## Environment variables (current)

```env
# Client-safe
NEXT_PUBLIC_TRANSCRIPTION_PROVIDER=browser-yin
NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER=false
NEXT_PUBLIC_BASIC_PITCH_WORKER_URL=                 # optional

# Server-only
BASIC_PITCH_WORKER_URL=                              # used by legacy /api/transcribe
```

## Fixture fallback

`transcribeFixture` is guaranteed to be the last item in every provider list.
It returns one of five hand-picked monophonic melodies (C minor, G major, A
minor, F major, D minor) so a demo never lands on the same vibe twice.
