# Cleanup Log 2026-06-17

This note records the local cleanup pass from 2026-06-17 so future agents can
understand what was removed and how to recover anything that turns out to be
useful later.

## Intent

The cleanup focused on files and dependencies with strong evidence of being
unused, stale, generated, or superseded. It did not intentionally change the
main product journey.

The main safety rule was: keep anything still referenced by runtime code,
`public/manifest.json`, `src/app/layout.tsx`, or the active artwork catalog.

## Removed Or Trimmed

- Package dependencies removed from `package.json` and `bun.lock`:
  - `@react-spring/web`
  - `idb`
  - `recharts`
- Next starter/static leftovers:
  - `public/file.svg`
  - `public/globe.svg`
  - `public/next.svg`
  - `public/vercel.svg`
  - `public/window.svg`
- Static SEO files replaced by App Router generators:
  - `public/robots.txt`
  - `public/sitemap.xml`
  - Current sources of truth are `src/app/robots.ts` and `src/app/sitemap.ts`.
- Old brand/source candidates not referenced by the active app manifest/layout:
  - non-rounded `public/brand/murmur-app-icon-*.png`
  - old coral/ink wordmark previews
  - `public/brand/variants/*`
  - `public/brand/app-icon-generator.html`
- Old share card backgrounds superseded by the `*-v2.jpg` assets:
  - `public/images/share-bg.jpg`
  - `public/images/share-esther-bg.jpg`
  - `public/images/share-murmur-bg.jpg`
- Obsolete one-off scripts:
  - `scripts/download-artwork-pool.mjs`
  - `scripts/test-music-gen.ts`
- Legacy transcription/music shims with no source callers:
  - `src/lib/music/stainer.ts`
  - `src/lib/music/providers/fixture.ts`
  - `src/lib/music/strummer-title.ts`
  - `src/modules/stainer/providers/basic-pitch.d.ts`
- Historical artwork integration sample:
  - `docs/artwork-archive/v0.5/app_integration/murmur-artwork-system.ts`
- Artwork originals that were no longer in the active runtime catalog were
  removed only after checking catalog references.

## Kept On Purpose

- Rounded app icons still referenced by `public/manifest.json` and
  `src/app/layout.tsx`.
- `public/brand/murmur-wordmark-source-cropped.png`, which is still used by
  the live Murmur mark/share UI.
- `public/images/share-murmur-bg-v2.jpg` and
  `public/images/share-esther-bg-v2.jpg`, which are still used by the share
  card modal.
- Active artwork and `background_ready` files that are referenced by
  `src/presets/artworks/catalog.ts`.
- Archive docs under `docs/archive/`, unless a file was clearly a stale
  integration dump rather than a useful historical note.

## Restore Guide

If the cleanup is already committed and the whole change should be undone, use
`git revert <cleanup-commit>`.

If only one removed path is needed later, restore it from the commit before the
cleanup:

```bash
git restore --source=<commit-before-cleanup> -- path/to/file
```

For removed dependencies, prefer reinstalling explicitly and letting Bun update
the lockfile:

```bash
bun add @react-spring/web idb recharts
```

For old artwork or brand assets, restore the specific file first, then check
whether any runtime surface must point to it again:

- app icons: `public/manifest.json`, `src/app/layout.tsx`
- artwork covers/backgrounds: `src/presets/artworks/catalog.ts`
- share card art: `src/components/murmur/share-card-modal.tsx`

For legacy music/transcription files, do not restore them just because a doc
mentions the old path. Restore only if a real caller needs them, and prefer the
current replacements:

- transcription path: `src/modules/stainer/transcribe.ts`
- explicit demo fixture: `src/modules/stainer/providers/fixture.ts`
- audio worker path: `workers/audio-engine/`

## Validation Recorded

After the cleanup pass:

- `bun run lint` passed.
- `bun run build` passed.
- `bun test src/modules/music/humming-engine.test.ts` still had one unrelated
  music-engine behavior assertion drift around an interior note duration
  (`0.362951...` versus an expected `<= 0.36`).

Build/cache artifacts such as `.next` and local virtual environments are
rebuildable and should not be treated as source. If they are removed locally,
rerun the normal setup/build commands.
