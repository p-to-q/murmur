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
    browser-yin.ts               ← browser fallback — zero-deps, offline, instant
    remote-python.ts             ← strongest path — calls PYIN worker
    browser-basic-pitch.ts       ← opt-in — Spotify Basic Pitch, ~7MB CDN model
    fixture.ts                   ← always available, demo-safe fallback
```

## Provider order

Controlled by `NEXT_PUBLIC_TRANSCRIPTION_PROVIDER`:

| Value (client-exposed)   | Order                                                            |
|--------------------------|------------------------------------------------------------------|
| `auto` *(default)*       | remote-python → browser-yin → browser-basic-pitch → fixture      |
| `browser-yin`            | browser-yin → remote-python → browser-basic-pitch → fixture      |
| `remote-python`          | remote-python → browser-yin → browser-basic-pitch → fixture      |
| `browser-basic-pitch`    | browser-basic-pitch → browser-yin → remote-python → fixture      |
| `fixture`                | fixture (demo-only mode)                                         |

When `input.audioBlob` is undefined (e.g. the "Try the example melody" button
on HumScreen) the facade short-circuits to `[fixture]` regardless of config.

`auto` only includes providers that are actually enabled at runtime. If the
remote worker URL is missing, the chain resolves to `browser-yin →
browser-basic-pitch → fixture` or `browser-yin → fixture`, depending on whether
Basic Pitch is enabled. This avoids "paper fallbacks" that look configured but
instantly collapse to fixture.

## Why `auto` first, and why YIN remains the browser default?

For short humming, monophonic F0 tracking is still the right core assumption.
The strongest overall path is therefore:

- **Remote pYIN** first when we actually have the worker, because it is the
  highest-accuracy monophonic tracker in our current architecture.
- **Browser YIN** second because it is offline, instant, and matches the hum
  use case better than a heavier note-transcription model.
- **Browser Basic Pitch** third as an optional recovery path, especially if we
  later broaden input beyond plain humming.

Compared to Basic Pitch:

- **YIN**: zero install, runs offline, ≤200ms latency for a 10s hum, ~46ms per
  frame on commodity hardware.
- **Basic Pitch**: more accurate on polyphonic / instrumental input, but
  downloads a 7MB TensorFlow model and takes 3–8s on first use.

For our case (hum → melody) the YIN result is usually enough for the polish
pipeline (`src/modules/music/melody-polisher.ts`) to snap-to-scale and
quantize. Basic Pitch becomes more compelling if we accept guitar, piano, or
denser audio.

## Audio format

Browser records `audio/webm;codecs=opus`. The Python PYIN worker accepts that
directly (decodes via pydub). The browser-yin engine decodes via
`AudioContext.decodeAudioData` and resamples in JS.

## Environment variables (current)

```env
# Client-safe
NEXT_PUBLIC_TRANSCRIPTION_PROVIDER=auto
NEXT_PUBLIC_ENABLE_BASIC_PITCH_BROWSER=false
NEXT_PUBLIC_REMOTE_PYIN_WORKER_URL=                # preferred
NEXT_PUBLIC_BASIC_PITCH_WORKER_URL=                # legacy alias, still supported

# Server-only
REMOTE_PYIN_WORKER_URL=                              # preferred
BASIC_PITCH_WORKER_URL=                              # legacy alias, still supported
```

## Fixture fallback

`transcribeFixture` is guaranteed to be the last item in every provider list.
It returns one of five hand-picked monophonic melodies (C minor, G major, A
minor, F major, D minor) so a demo never lands on the same vibe twice.

Important: fixture is now reserved for explicit demo mode or true end-of-chain
failure. Real audio routed through `/api/transcribe` no longer receives silent
fixture substitution.
