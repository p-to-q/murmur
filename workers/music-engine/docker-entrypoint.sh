#!/usr/bin/env bash
# Boot script for the GPU image (RunPod Serverless): bridge the network volume,
# fetch model assets once, then run the serverless handler.
set -euo pipefail

MODEL="${MAGENTA_MODEL:-mrt2_base}"
ASSETS_ROOT="${HOME}/Documents/Magenta"
ASSETS_DIR="${ASSETS_ROOT}/magenta-rt-v2"
CHECKPOINT="${ASSETS_DIR}/checkpoints/${MODEL}.safetensors"

# On RunPod Serverless the network volume mounts at /runpod-volume. Bridge the
# model asset dir onto it so the ~4 GB download persists across cold starts and
# workers (fetched once, not per worker). When no volume is attached (e.g. a
# plain `docker run`), fall through to local ephemeral disk.
if [ -d /runpod-volume ]; then
  mkdir -p /runpod-volume/Magenta
  mkdir -p "$(dirname "$ASSETS_ROOT")"
  ln -sfn /runpod-volume/Magenta "$ASSETS_ROOT"
fi

mkdir -p "$ASSETS_ROOT"

if [ ! -f "$CHECKPOINT" ]; then
  echo "[entrypoint] downloading Magenta resources + JAX checkpoint for ${MODEL} (first boot, ~4 GB)…"
  if command -v mrt >/dev/null 2>&1; then
    mrt models init
    mrt checkpoints download "${MODEL}.safetensors" 2>/dev/null || mrt checkpoints download "mrt2_base.safetensors"
  else
    python - <<'PY'
import os
import subprocess
import sys

model = os.environ.get("MAGENTA_MODEL", "mrt2_base")
for cmd in (["mrt", "models", "init"], ["mrt", "checkpoints", "download", model]):
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        break
    except subprocess.CalledProcessError as exc:
        print(f"[entrypoint] {cmd} failed: {exc}", file=sys.stderr)
        if cmd[1] == "checkpoints":
            sys.exit(exc.returncode)
PY
  fi
fi

if [ ! -f "$CHECKPOINT" ]; then
  echo "[entrypoint] checkpoint missing after download: ${CHECKPOINT}" >&2
  exit 1
fi

# Role decides what the (now model-ready) container runs:
#   handler — RunPod Serverless queue handler (default; scale-to-zero endpoint).
#   server  — long-lived FastAPI HTTP worker for a RunPod GPU *pod*, reachable at
#             https://<podId>-<port>.proxy.runpod.net and driven via MUSIC_WORKER_URL.
ROLE="${MUSIC_ENGINE_ROLE:-handler}"
if [ "$ROLE" = "server" ]; then
  PORT="${MUSIC_ENGINE_PORT:-8002}"
  export MUSIC_WORKER_REQUIRE_AUTH="${MUSIC_WORKER_REQUIRE_AUTH:-1}"
  echo "[entrypoint] starting FastAPI server on 0.0.0.0:${PORT} (backend=${MAGENTA_BACKEND:-jax})"
  exec python -u -m uvicorn main:app --host 0.0.0.0 --port "${PORT}"
fi

echo "[entrypoint] starting RunPod serverless handler (backend=${MAGENTA_BACKEND:-jax})"
exec python -u handler.py
