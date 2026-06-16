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
- Old songs and missing/broken image assets fall back to the generated canvas
  cover, keeping the demo path usable.

No database migration is needed because `visualConfig` is already a JSON blob.

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

The initial checked-in pool is deliberately small and hand-curated. Expand it by
adding catalog entries with source IDs, image paths, crop hints, tags, genre
weights, mood weights, and energy ranges.
