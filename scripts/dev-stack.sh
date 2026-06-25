#!/usr/bin/env bash
# Start Next.js plus the local Python workers for a full Murmur dev stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f ".env.workers.local" ]; then
  # shellcheck disable=SC1091
  set -a
  source ".env.workers.local"
  set +a
fi

export MURMUR_VOICE_INPUT_ENABLED="${MURMUR_VOICE_INPUT_ENABLED:-1}"
export SPEECH_WORKER_URL="${SPEECH_WORKER_URL:-http://127.0.0.1:8003}"

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

if [ ! -x "workers/speech-engine/.venv/bin/uvicorn" ]; then
  echo "Speech worker venv missing. Run: bun run setup:speech" >&2
  exit 1
fi

echo "Starting audio worker on :8001, music worker on :8002, speech worker on :8003, Next.js on :3000..."
bun run dev:audio &
bun run dev:music &
bun run dev:speech &
bun dev &
wait
