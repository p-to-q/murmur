# Pitch Map Conventions

Optional pitch maps let Murmur compare expected melodic sketches against audio
files when building dataset manifests.

Recommended local files:

- `humtrans.local.json`
- `vocadito.local.json`
- `murmur-golden.local.json`

The quickest way to create the Murmur golden-set pair is:

```bash
bun run audit:audio:seed-golden
```

That command writes both the local manifest and the matching pitch map.

Keys may be:

- a relative audio path from the dataset root, or
- a file stem

Values must be MIDI pitch arrays.

Example:

```json
{
  "hooks/two-tigers.wav": [60, 62, 64, 60, 60, 62, 64, 60],
  "night-sky-hook": [67, 67, 69, 67, 64, 62]
}
```
