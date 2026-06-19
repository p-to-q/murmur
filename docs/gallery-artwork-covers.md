# Gallery Artwork Covers

Murmur gallery covers can use a curated local artwork pool as the atmospheric
background behind the record, waveform, texture, and title overlay.

This is intentionally not a generic "random famous painting" system. The first
pool is calibrated toward the Co-star-like reference direction discussed during
design: less obvious public-domain art, strong atmosphere, and images that can
act as a background field rather than the whole subject of the card.

## Product Behavior

- New generated versions receive `visualConfig.visualFacets` from the active
  vibe generation path.
- `src/presets/artworks/artwork-matcher.ts` scores those facets against the
  local catalog by genre, mood, energy, scene, and optional bucket.
- The selected artwork is stored inside `visualConfig.artwork`, so saved songs
  reopen with the same cover image.
- Gallery cards render the selected image first, then layer Murmur's generated
  record/waveform cover treatment above it.
- Cover surfaces apply a shared brightness compensation treatment after the
  curated artwork image is blended with Murmur's generated color layer. The
  shared constants live in `src/lib/music/cover-visual-treatment.ts` and are
  used by Gallery, Vibe, Studio, song detail, the share ticket, and video
  export so the same saved song does not get progressively darker across
  surfaces.
- When present, `backgroundImagePath` is preferred over `imagePath` for cover
  rendering. These files are square, softened, and tuned for record / waveform
  overlays; the original `imagePath` remains available for future recrops.
- Old songs and missing/broken image assets fall back to the generated canvas
  cover, keeping the demo path usable.

No Postgres migration is needed for the v0.5 seed pack because `visualConfig`
is already a JSON blob and only stores the selected artwork snapshot. The
curated artwork pool itself is a static catalog plus archived manifests.

## Current Buckets

- `luminist_air` - quiet coast, empty air, low horizon, slow songs.
- `sublime_terrain` - mountains, scale, awe, cinematic lift.
- `tidal_mineral` - rocks, water force, coast geology, surf and dub motion.
- `pastoral_memory` - lakes, fields, dunes, remembered warmth.
- `nocturne_metro` - wet city, night water, smoky beats, rain.
- `printed_signal` - woodblock, album leaves, botanical line, ritual texture.
- `stage_heat` - public rhythm, dance, crowd energy, painterly heat.
- `interior_reverie` - rooms, windows, private lo-fi and lullaby space.
- `hypermodern_void` - early abstraction, optical fields, synth and techno.

## Pool Rules

Use public-domain or CC0 images from open collections such as AIC and the Met.
Prefer works that survive square crop, low contrast, and overlay. Avoid strong
central portraits, war/violence, religious scenes, nudity, meme-famous images,
and images whose rights status is unclear.

## Current Catalog And Archive

The checked-in pool is now based on `murmur_artwork_seed_pack_v0_5.zip`, dated
2026-06-17. The import archive contains 63 source entries. The active app
catalog currently ships 68 entries: 61 active v0.5 entries plus 7 restored
open-collection assets that were already present locally and are now wired into
the runtime catalog, with:

- Active catalog entries in `src/presets/artworks/catalog.ts`.
- Square background-ready images in `public/background_ready/`.
- Original source images in `public/artworks/`.
- Source manifests, taxonomy, candidate list, rejection list, seed summary, and
  download log in `docs/artwork-archive/v0.5/`.

Active catalog note: the v0.5 archive contains 63 source entries. `Cotopaxi`
(`sublime_terrain-commons-church-cotopaxi`) and `Paris Street; Rainy Day`
(`nocturne_metro-commons-caillebotte-paris-street-rainy-day`) are kept in the
archive for provenance but excluded from `src/presets/artworks/catalog.ts` and
`public/` because they read too literal or foreground-heavy for the demo cover
system. Seven previously local-but-unwired assets are now active because they
fit existing buckets and have matching original plus background-ready files:

- `hypermodern_void-aic-65916`
- `interior_reverie-aic-28560`
- `nocturne_metro-aic-56905`
- `printed_signal-aic-33398`
- `printed_signal-met-37193`
- `stage_heat-aic-27992`
- `tidal_mineral-aic-24645`

The archive is intentionally committed as plain files so future agents can audit
source URLs, rights notes, bucket fit, palette, and render treatment without
needing the original ZIP.

## Data-Model Decision

Keep the catalog out of Postgres while the artwork pool is shipped with the app:

- The app needs deterministic bundle-time lookup, not user-specific writes.
- Songs only need the selected `visualConfig.artwork` snapshot for durable
  playback and gallery rendering.
- Static files keep the demo path guest-safe when Postgres is unavailable.
- The archive manifest is a better provenance record than rows copied into a
  local dev database.

A database-backed artwork catalog becomes useful when Murmur needs remote asset
rotation, moderation state, operator editing, A/B weights, per-region catalogs,
or usage analytics that affect matching. At that point, add tables roughly like:

- `artwork_assets`: stable id, bucket, source, source id/url, license, original
  path, background path, width/height, palette, composition, figure presence,
  background fit, status, created/updated timestamps.
- `artwork_asset_weights`: asset id, facet type (`genre`, `mood`, `scene`,
  `instrument`), facet value, weight.
- `artwork_imports`: import id, version, source ZIP/checksum, manifest path,
  imported counts, rejected counts, created timestamp.

Until then, the source of truth is `src/presets/artworks/catalog.ts` and the
archive manifests under `docs/artwork-archive/`.
