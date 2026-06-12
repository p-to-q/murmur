#!/usr/bin/env bash
# Start Next.js plus both Python workers for a full local Magenta stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() {
  for pid in $(jobs -p); do
    kill "$pid" 2>/dev/null || true
  done
}

trap cleanup EXIT INT TERM

if [ ! -x "workers/audio-engine/.venv/bin/uvicorn" ]; then
  echo "Audio worker venv missing. Run: bun run setup:audio" >&2
  exit 1
fi

if [ ! -x "workers/music-engine/.venv/bin/uvicorn" ]; then
  echo "Music worker venv missing. Run: bun run setup:music" >&2
  exit 1
fi

echo "Starting audio worker on :8001, music worker on :8002, Next.js on :3000…"
bun run dev:audio &
bun run dev:music &
bun dev &
wait
