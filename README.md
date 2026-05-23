# Murmur

Murmur is a humming-to-song studio built on Eazo: a user hums a sketch, the
system transcribes and polishes it into a melody, generates several vibe-led
arrangements, then lets the user refine, preview, save, and export the result
as audio, visuals, share HTML, and a real audio+video WebM.

## For Judges

If you are reviewing this repo with a code bot judge or a design bot judge,
start here:

- Product + design + engineering overview:
  [docs/judges-guide.md](/Users/dujiayi/murmur/docs/judges-guide.md)
- Melody, arrangement, and render pipeline:
  [docs/music-engine.md](/Users/dujiayi/murmur/docs/music-engine.md)
- Provider and transcription fallback strategy:
  [docs/provider-strategy.md](/Users/dujiayi/murmur/docs/provider-strategy.md)
- Verification notes:
  [docs/verification.md](/Users/dujiayi/murmur/docs/verification.md)

## What We Tried To Make Deliberately

- A creation flow with a clear emotional arc:
  `Hum -> Vibe -> Studio -> Gallery -> Song detail`
- A UI tone that feels editorial and restrained rather than tool-heavy:
  fewer knobs, stronger hierarchy, more guided choices
- A melody pipeline that treats raw humming as imperfect input:
  denoise, pitch correction, tonal inference, cadence stabilization
- A “what you hear is what you save” architecture:
  live preview, saved audio, and export all share the same arrangement logic
- Export that is not just static sharing:
  reusable visual presets, downloadable HTML, poster PNG, and audio-backed WebM

## Key Visible Files

- Entry flow shell:
  [src/app/page.tsx](/Users/dujiayi/murmur/src/app/page.tsx)
- Capture / transcription handoff:
  [src/components/screens/HumScreen.tsx](/Users/dujiayi/murmur/src/components/screens/HumScreen.tsx)
- Arrangement editing surface:
  [src/components/screens/StudioScreen.tsx](/Users/dujiayi/murmur/src/components/screens/StudioScreen.tsx)
- Saved song playback + export surface:
  [src/components/screens/SongDetailScreen.tsx](/Users/dujiayi/murmur/src/components/screens/SongDetailScreen.tsx)
- Real audio+video export:
  [src/modules/export/export-webm.ts](/Users/dujiayi/murmur/src/modules/export/export-webm.ts)

## Getting Started

Install dependencies with Bun:

```bash
bun install
```

If dependency installation stalls on this machine during `sharp` setup, use:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 bun install
```

Start the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `EAZO_PRIVATE_KEY` | Eazo private key used server-side for session decryption and protected platform capabilities. |

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Bun
- Eazo SDK
- Web Audio / Tone-based render pipeline

## Learn More

- [Eazo Documentation](https://docs.eazo.ai)
- [Next.js Documentation](https://nextjs.org/docs)
