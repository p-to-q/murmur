# Recovered Files Manifest

Files recovered from git history on 2026-07-10. These were deleted by
orphan-file cleanup passes but contain algorithms, original creative work,
or infrastructure with no current replacement.

This directory is excluded from TypeScript compilation and ESLint to avoid
build noise. Files here are **reference code** — to reactivate one, move it
back to its original path (shown below) and resolve any import drift.

Archived test files use a `.test-archived.ts` suffix instead of `.test.ts`
so `bun test` does not discover and execute them — the archive must stay
inert. Rename back to `.test.ts` when reactivating.

## Inventory

### Visual / Interaction (6 files)

| File | Original path | Why it matters |
|------|--------------|----------------|
| `components/murmur/murmur-wave-gl.tsx` | `src/components/murmur/murmur-wave-gl.tsx` | Sky-inspired star-sea: cluster drift, 3-layer parallax, shooting stars, breathing cycles |
| `components/murmur/murmur-wave-canvas.tsx` | `src/components/murmur/murmur-wave-canvas.tsx` | Foundation star-sea: terrain-following particles, brightness tiers, rhythm pulse |
| `components/screens/VersionCardsOverlay.tsx` | `src/components/screens/VersionCardsOverlay.tsx` | 3-phase cinematic reveal: iris animation, AudioContext shutter, wave clip-path cards |
| `components/song-detail/song-cover-art.tsx` | `src/components/song-detail/song-cover-art.tsx` | Deterministic generative SVG art (FNV-1a + Mulberry32 PRNG) |
| `components/studio/tonearm.tsx` | `src/components/studio/tonearm.tsx` | Dieter Rams SVG tonearm illustration |
| `components/studio/vinyl-disc.tsx` | `src/components/studio/vinyl-disc.tsx` | Vinyl disc with radial-gradient groove texture |

### Audio / Music Engine (5 files)

| File | Original path | Why it matters |
|------|--------------|----------------|
| `lib/music/pitch-engine.ts` | `src/lib/music/pitch-engine.ts` | Browser-side YIN pitch detection, tuned for humming. Needed for pYIN fallback strategy |
| `lib/music/stainer.ts` | `src/lib/music/stainer.ts` | estimateKey / estimateBPM / estimateContour — music theory helpers not found elsewhere |
| `modules/stainer/runtime.ts` | `src/modules/stainer/runtime.ts` | Provider fallback chain architecture (remote → browser-yin → basic-pitch → fixture) |
| `workers/basic-pitch-service/main.py` | `workers/basic-pitch-service/main.py` | FastAPI PYIN worker with humming-tuned params (FMIN=75Hz) |

### Infrastructure / Export (6 files)

| File | Original path | Why it matters |
|------|--------------|----------------|
| `lib/http/deadline.ts` | `src/lib/http/deadline.ts` | withTimeout / deadlineSignal / mergeSignals — production timeout library |
| `lib/http/deadline.test-archived.ts` | `src/lib/http/deadline.test.ts` | Tests for deadline.ts |
| `modules/export/render-poster.ts` | `src/modules/export/render-poster.ts` | 1080x1080 share poster generator (no current replacement) |
| `modules/export/render-share-html.ts` | `src/modules/export/render-share-html.ts` | Self-contained HTML share file with embedded audio + particle animations |
| `scripts/test-music-gen.ts` | `scripts/test-music-gen.ts` | Music engine evaluation suite (7 fixtures, tests musical correctness) |
| `scripts/deploy-music-gpu.ts` | `scripts/deploy-music-gpu.ts` | RunPod GPU deployment with multi-GPU fallback + Vercel env sync |

## Reactivation checklist

1. Move the file back to its original path
2. Rename `.test-archived.ts` back to `.test.ts` if it is a test file
3. Check imports — some `@/` paths may have shifted since deletion
4. Verify any dependencies are still in `package.json`
5. Remove the entry from this manifest
6. Add tests or update existing tests if applicable
