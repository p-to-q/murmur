# Audio Pipeline Redesign — Hum → Score → Arrangement

> This document remains the detailed upstream pipeline note. For the broader
> product and correction philosophy, including cloud/device dual execution and
> the `IntentMelody -> CorrectedMelody -> MusicalMelody` model, see
> `docs/humming-engine-v2.md`.

## 1. Goal

The hum → song result currently sounds wrong often enough that the user is
dissatisfied. The user's stated v2 target is:

> 音频上传 → 去噪 → 精准识别音高 → 转化为符合乐理标准的谱子，并限制在
> 特定的乐器范围内。

This document specifies the v2 audio pipeline:

1. **Capture** is platform-native (browser, iOS, Android, 微信 MP).
2. **Denoise** runs before pitch detection, not after.
3. **Pitch detection** is monophonic-first, server-authoritative.
4. **Notes → score** quantizes, snaps to a chosen scale, and **clamps to a
   target instrument's playable range**.
5. **Arrangement** continues to run wherever the host can run it (browser
   today; server tomorrow when 微信 MP needs it).

The pipeline should remain **contract-authoritative** across Web, iOS, Android,
and 微信 MP. In practice, Cloud mode remains the reference implementation, while
Device mode may run a lighter version of the same melody contract when local
performance or privacy calls for it. See `cross-platform-strategy.md` and
`humming-engine-v2.md`.

This doc does **not** redesign the arrangement engines
(rhythm / chord / bass / drum) — those are working and are documented in
`docs/music-engine.md`. It changes everything **upstream** of `assembleSong`.

## 2. Diagnosis (one-paragraph recap)

Current path (see `diagnosis-2026-06.md` §2 for evidence): no denoise → YIN
in the browser, no octave-jump correction → silent fixture fallback when YIN
returns empty → polisher does heavy ear-saving work but cannot recover from
broken raw input → no instrument-range constraint. The Python pYIN worker
is documented but has no deployment story, and the env wiring routes the
client straight to the worker rather than through `/api/transcribe`.

## 3. Target pipeline

```
                ┌─────────────┐
  user voice ───▶  CAPTURE    ──┐  raw audio blob (≤30s, opus/webm/wav/m4a)
                └─────────────┘  │
                                 ▼
                ┌───────────────────────────────┐
                │  SERVER /api/transcribe       │
                │  ─────────────────────────    │
                │  1. decode → mono 22.05kHz    │
                │  2. silence trim (head/tail)  │
                │  3. denoise (DeepFilterNet)   │
                │  4. f0 detection (SwiftF0)    │
                │  5. frames → raw notes        │
                │  6. polish (key/scale/quant)  │
                │  7. range clamp (instrument)  │
                │  8. return ScoredMelody       │
                └───────────────────────────────┘
                                 │
                                 ▼
                ┌─────────────┐
                │  ARRANGE    │  unchanged — Strummer + assemble-song
                └─────────────┘
```

The boundary moves: the **server owns everything up to "a polished, scored
melody."** The client owns capture and arrangement / playback. This is the
single biggest change v1 → v2.

## 4. Component decisions

### 4.1 Capture (client side)

| Surface | Library | Format target |
|---|---|---|
| Web / Capacitor WebView | `MediaRecorder` | `audio/webm;codecs=opus` |
| Capacitor native (fallback) | `@capacitor-community/media` | `aac`/`m4a` |
| 微信 MP | `wx.getRecorderManager` | `mp3` (`format: "mp3"`) |

All three encode to ≤30 s, mono preferred, sample rate ≥16 kHz. **The
server decodes whatever format arrives via `pydub`/`soundfile` and resamples
to 22.05 kHz mono float32.** This already works in
[main.py:decode_audio](/Users/dujiayi/murmur/workers/audio-engine/main.py).

Client must add:

- A simple level meter that means "we heard you." Below a threshold for
  >1 s, surface a copy hint ("再大声一点 / Try a bit louder").
- A 250 ms silence head/tail trim **on the client** before upload, so we
  ship less audio. Server will trim again defensively.
- A "couldn't hear you" error path that does not fall through to fixture.
  Fixture moves to an explicit "Try a demo melody" button on HumScreen,
  visually distinct from the recording orb.

### 4.2 Denoise

Pick **one** of:

| Option | Pros | Cons | Pick? |
|---|---|---|---|
| RNNoise (WASM) | mature, ~200 KB, browser-friendly | aging, weak on humming/singing | ❌ |
| **DeepFilterNet family** | open-source, strong on voice incl. singing, runs server (CPU OK), measured 39 ms for a 1 s synthetic noisy tone on local CPU after warmup | new PyTorch/torchaudio stack; model cache required | ✅ |
| Koala / Krisp SDK | strong + cross-platform | commercial, SDK fee | reserve |
| WebRTC NS | shipped in Chromium already | minimal effect, no help on hum | ❌ |

**Decision:** ship DeepFilterNet behind a server worker provider seam for v2.
The upstream `deepfilternet` package currently loads DeepFilterNet3 by default,
so Murmur names this as a provider family rather than pinning product language
to DeepFilterNet2. Add an optional client-side RNNoise hook only if a
measurable cohort of recordings fails the server denoise. This is one of the
two highest-leverage changes.

**Maintenance risk (`@research-2026-06` §4):** DeepFilterNet's last release
was v0.5.6 (Aug 2023) with the most recent upstream commit Oct 2024 — it
is not abandoned but is no longer rapidly improving. Our worker pins
`deepfilternet==0.5.6`, `torch==2.5.1`, `torchaudio==2.5.1` because newer
torchaudio releases dropped the backend path 0.5.6 imports. Mitigation:

- Freeze the worker Docker base image to the working pin set; do not
  bump torchaudio opportunistically.
- If torchaudio 2.6+ adoption becomes unavoidable, evaluate replacements
  (RNNoise via Rust, Krisp SDK on a commercial budget, self-trained
  Demucs-style enhancer) before relying further on a year-old pin.
- License is dual MIT / Apache-2.0 — no rev-share, no commercial
  gating, safe to ship as-is.

### 4.3 Pitch detection

| Algo | Monophonic accuracy | Robust to noise | Size / latency | Notes |
|---|---|---|---|---|
| Hand-rolled YIN (today) | ~baseline | ⛔ | tiny | shipping; failure mode is octave jumps + empty result |
| librosa pYIN (today, worker) | 97.5% (clean) | medium | ~100 MB Python deps | OK fallback; what the worker already runs |
| CREPE | 98.5% (clean) | medium | ~80 MB model, slow | the previous gold standard |
| SPICE | 95.0% (clean) | medium | small | self-supervised |
| Basic Pitch (Spotify) | 23.7% (clean monophonic) | low for solo voice | ~7 MB, polyphonic-strong | wrong tool for solo hum |
| **SwiftF0** (Aug-2025) | **91.8% @ 10 dB SNR**, beats CREPE by 12 pp under noise | high | **95 k params, 42× faster than CREPE** | open source, MIT-style, monophonic |

**Decision:** make SwiftF0 the primary detector
([lars76/swift-f0](https://github.com/lars76/swift-f0/),
[arXiv 2508.18440](https://arxiv.org/abs/2508.18440)). Keep librosa pYIN as
fallback for inputs SwiftF0 rejects (empty / very long / non-vocal). Drop
in-browser YIN once the server pipeline is live; it stays as a
"capture-only" pre-flight signal for the level meter.

Implementation note: `workers/audio-engine/audio_engine/detectors.py` exposes
`AUDIO_ENGINE_PITCH_PROVIDER=auto`, which uses SwiftF0 first and pYIN fallback.

**Why not CREPE:** size + speed + noise robustness all favor SwiftF0 for our
use case (short hum, real-world acoustic environments). Benchmark per
[lars76/pitch-benchmark](https://github.com/lars76/pitch-benchmark).

**Why not Basic Pitch:** built for polyphonic instrument transcription; its
documented monophonic accuracy is far below SwiftF0/pYIN/CREPE on solo
voice. The browser path stays disabled by default.

**v3 architecture option (`@research-2026-06` §4):** SwiftF0 ships with
an official ONNX / WASM browser path
([swift-f0.github.io demo](https://swift-f0.github.io)). Once Phase 1
stabilises, prototyping pitch detection on the client (Capacitor +
PWA + 微信 MP all support it) would:

- shed the per-request worker call for the most expensive step;
- enable an "offline-takeable" demo on Capacitor when the device is
  briefly offline;
- keep the server worker responsible only for denoise + polish +
  range-clamp (the parts that benefit from authoritative state).

License (MIT) and 95 k-parameter footprint make the WASM ship feasible.
Not a v2 priority — flagged here so the eventual v3 phase reviewer
sees the option without rediscovering it.

### 4.4 Frames → notes

The Python worker's `pyin_to_notes`
([frames.py](/Users/dujiayi/murmur/workers/audio-engine/audio_engine/frames.py))
is a reasonable shape: walk frames, segment by pitch change, flush on
silence. Two upgrades:

1. **Octave-jump guard.** Across two adjacent voiced frames, if `|Δsemitone|
   ∈ [10, 14]` and the next frame returns to within ±2 of the original, the
   middle frame is treated as the same note (this is a YIN-class octave
   blip, not a real jump).
2. **Confidence-weighted onset.** Right now we segment whenever
   `midi ≠ note_midi`. With SwiftF0 we have a stronger per-frame
   confidence; require two consecutive frames at >0.5 confidence to commit
   a new note onset. Reduces "ghost" notes around vibrato.

These are the layers `polishMelody`'s `compactNoiseBursts` /
`removePitchOutliers` cannot do, because they operate *after* notes have
already been segmented.

### 4.5 Polish layer

Keep [melody-polisher.ts](/Users/dujiayi/murmur/src/modules/music/melody-polisher.ts).
It works when raw input is reasonable; the broken cases were upstream.

Port it from `src/modules/music/` to the Python worker (or rewrite as a
small Rust crate shared between server + Capacitor) **only if** we need
identical determinism in the 微信 MP path. v2 phase 1: keep it in
TypeScript on the server (run via Bun on the API edge), reuse the existing
implementation byte-for-byte.

### 4.6 Instrument-range clamp (new)

The product brief explicitly asks for this. After `polishMelody`, before
returning the score, apply:

```ts
function clampToInstrument(melody: CleanMelody, instrument: InstrumentRange): CleanMelody {
  // Each note: if pitch < instrument.lowMidi, transpose up by octaves
  //            if pitch > instrument.highMidi, transpose down by octaves
  // Preserve relative contour: if the whole melody shifts > 6 semitones,
  // shift again across all notes uniformly so the contour stays musical.
}
```

Per-instrument ranges (MIDI):

| Instrument | low | high | Notes |
|---|---|---|---|
| `piano` | 21 | 108 | basically no clamp |
| `bell / glockenspiel` | 67 | 96 | hummed bass would fall here |
| `acoustic_guitar` | 40 | 76 | typical |
| `marimba` | 45 | 84 | |
| `synth_lead` | 48 | 96 | configurable |
| `cello_pad` | 36 | 72 | warm |
| `upright_bass` | 28 | 55 | bass only — never melody target |

Range table lives in a new `src/lib/music/instrument-ranges.ts`. Each
ensemble in `generate-versions.ts` declares which instrument is the
**melody carrier**, and that instrument's range is fed to the clamp.

This is the literal answer to "限制在特定的乐器范围内."

## 5. New server route

Replace the proxy-only `/api/transcribe` with a real pipeline route that
returns a `ScoredMelody`, not raw notes. Shape:

```ts
// POST /api/transcribe
// Content-Type: multipart/form-data
// Fields:
//   audio: File (webm/mp3/m4a/wav, ≤30s)
//   targetInstrument?: string (e.g. "piano"; default "piano")
//   userId: from auth (when real auth lands)
// Response 200:
type ScoredMelodyResponse = {
  provider: "swiftf0" | "pyin" | "fixture";
  rawNotes: MelodyNote[];
  cleanMelody: CleanMelody;      // already snapped to scale + clamped to range
  warnings: string[];            // e.g. "low signal", "octave correction"
  diagnostics: {
    duration: number;
    snr: number | null;           // estimated SNR after denoise
    voicedRatio: number | null;   // fraction of frames marked voiced
    denoiseProvider?: "off" | "deepfilternet";
    denoiseModel?: string | null;
    denoiseMs?: number;
    pitchMs?: number;
    polishMs?: number;
  };
};
// Response 422 (we tried, audio is unusable):
//   { error: "no voiced frames" | "too short" | "format unsupported" }
```

422 is **never silently swapped for fixture**. The client gets a real error
and surfaces it.

`/api/transcribe` lives in Next.js API route (today's
[route.ts](/Users/dujiayi/murmur/src/app/api/transcribe/route.ts) is the
right file), but the audio crunching itself runs in a separate **Python
worker** under `workers/audio-engine/`. The Next.js route is the trust /
auth / quota gate; the worker is the algorithm.

## 6. What happens to existing browser providers

| Today | v2 plan |
|---|---|
| `browser-yin` | becomes a **pre-flight level / signal check** during capture (decides whether to allow Save), not a transcription result. Optional. |
| `remote-python` | superseded by `/api/transcribe`. Delete. |
| `browser-basic-pitch` | delete. Wrong tool for solo voice. |
| `fixture` | move to an **explicit "Try a demo melody" button**, not a silent fallback. Stainer facade no longer auto-falls-through. |

This removes the most dangerous failure mode of v1 (a real user recording
silently produces a fixture song).

## 7. Worker deployment

Currently a localhost-only FastAPI app. v2 requires real hosting:

1. Containerize: `Dockerfile` in `workers/audio-engine/` with `python:3.11-slim`,
   librosa, soundfile, pydub, ffmpeg, and `swift-f0`. Install
   `requirements-denoise.txt` only for denoise-enabled deployments; it pins
   `deepfilternet==0.5.6`, `torch==2.5.1`, and `torchaudio==2.5.1` because
   newer torchaudio releases no longer expose the backend import path used by
   DeepFilterNet 0.5.6.
2. Deploy target: **Fly.io** or **腾讯云 CVM** (recommended for 微信 MP
   latency to China users). Choose by primary user geography; the doc can
   stay agnostic and the execution agent picks per
   `cross-platform-strategy.md`.
3. Cold-start: warm SwiftF0 and, when enabled, DeepFilterNet at boot. Health
   check at `GET /health` exposes both `provider` and `denoiseProvider`.
4. Config in env:
   - `AUDIO_WORKER_URL` (server-only, **not** `NEXT_PUBLIC_*`)
   - `AUDIO_WORKER_TOKEN` (shared HMAC for Next.js → worker)
   - `AUDIO_ENGINE_PITCH_PROVIDER=auto`
   - `AUDIO_ENGINE_DENOISE_PROVIDER=auto|off|deepfilternet`
5. Add OpenTelemetry / structured logs around: format detected, denoise
   ms, pitch ms, polish ms, total ms, note count, warnings. Used to
   debug "音频结果不对" complaints downstream.

## 8. Quotas + abuse

Pair this work with `payment-topup-feature.md` quota model:

- `/api/transcribe` rate limit: 10 req / min / user, 60 req / day / user
  for free tier.
- Audio length limit enforced server-side at decode (≤30 s).
- Audio size limit at ingress (≤2 MB).
- Anonymous (guest) users get a stricter limit (3 / day) once real auth
  lands; until then, fingerprint-based throttling on the route.

## 9. Acceptance criteria

A downstream agent ships this when:

- [ ] A real recording of a hum produces a `ScoredMelody` whose `provider`
      field is `"swiftf0"` or `"pyin"` for >95% of test inputs.
- [ ] When the recording is genuinely unusable (silence, noise-only), the
      route returns 422 and HumScreen shows a "we couldn't hear that —
      try again or pick a demo" surface. Fixture is never invoked
      silently.
- [ ] `ScoredMelody.cleanMelody.notes` all fall inside the target
      instrument's MIDI range.
- [ ] Same audio in twice → same `cleanMelody` out (algorithm
      determinism; denoise is deterministic given fixed model).
- [ ] Worker `/health` is green on the deploy target; Next.js → worker
      latency p95 < 3 s for a 15 s recording.
- [ ] Build-time env var `NEXT_PUBLIC_TRANSCRIPTION_PROVIDER` is gone.
- [ ] Diagnostics surface includes `snr` and `voicedRatio` so we can
      track regressions.

## 10. Out of scope

- Polyphonic input (guitar chords, piano improv). v2 stays monophonic.
- User-uploaded MIDI / DAW round-trip.
- Realtime streaming pitch (we keep the post-record batch model).
- Singing-voice synthesis / lyrics. Pure instrumental arrangement only.

## 11. File touch list

New:

- `workers/audio-engine/Dockerfile`
- `workers/audio-engine/swift_f0_provider.py`
- `workers/audio-engine/denoise.py` (DeepFilterNet provider wrapper)
- `workers/audio-engine/api.py` (combines decode + denoise + pitch +
  polish + clamp; replaces today's `main.py`)
- `src/lib/music/instrument-ranges.ts` (range table + `clampToInstrument`)

Modified:

- `src/modules/stainer/transcribe.ts` — collapse to a single server call
- `src/modules/stainer/runtime.ts` — delete provider chain config
- `src/modules/stainer/providers/*.ts` — delete all except `fixture.ts`
  (which becomes an explicit demo helper, not a fallback)
- `src/components/screens/HumScreen.tsx` — add level meter + explicit
  "Try demo" button + "couldn't hear that" error path
- `src/app/api/transcribe/route.ts` — auth + quota + worker proxy +
  diagnostics
- `src/modules/music/melody-polisher.ts` — accept optional target
  instrument; call `clampToInstrument` at the end
- `src/modules/strummer/generate-versions.ts` — declare `melodyCarrier`
  per ensemble so the range clamp knows what to clamp to

Removed:

- `src/lib/music/providers/remote-basic-pitch.ts` (legacy alias)
- `src/modules/stainer/providers/browser-basic-pitch.ts`
- `src/modules/stainer/providers/remote-python.ts`
- `workers/basic-pitch-service/` (rename → audio-engine)

## 12. Open questions for downstream

1. Do we ship denoise on the client at all? Recommended **no** until
   metrics show server denoise is insufficient for a meaningful cohort.
2. Storage for raw user recordings — do we keep them for model
   improvement? If yes, opt-in privacy flow needed.
3. ~~SwiftF0 license check — README is Apache-2.0-leaning; verify before
   embedding.~~ Resolved per `@research-2026-06` §4: SwiftF0 is **MIT-licensed**
   (PyPI metadata + GitHub LICENSE), safe to embed in commercial product.
4. When 微信 MP ships, does it upload `mp3` directly or does it convert
   to `wav` client-side first? The worker supports both; decision is
   about mini-program package size, not algorithm.

Sibling docs: `cross-platform-strategy.md` (where this runs),
`payment-topup-feature.md` (how we meter it).
