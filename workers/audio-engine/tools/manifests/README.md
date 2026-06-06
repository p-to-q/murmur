# Local Audio Eval Manifests

This folder is for local-only dataset manifests that feed Murmur's audio audit
and closure runner.

Examples:

- `humtrans.local.json`
- `vocadito.local.json`
- `murmur-golden.local.json`

Quick bootstrap:

```bash
bun run audit:audio:seed-golden
```

That command seeds the local `murmur-golden` manifest plus matching WAV files
and pitch map so closure is not stuck on an empty optional suite.

These files should normally stay out of Git.

They point at datasets or recordings that already exist on your machine and are
referenced by:

- [audio_eval_closure.example.json](../audio_eval_closure.example.json)
- [audio-dataset-ingestion.md](../../../../docs/audio-dataset-ingestion.md)

Recommended shape:

1. put the raw audio elsewhere on disk;
2. generate the manifest here;
3. keep only shared examples and docs in the repo.
