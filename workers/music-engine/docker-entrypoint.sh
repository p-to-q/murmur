#!/usr/bin/env bash
# Boot script for the GPU image: fetch model assets once, then serve.
set -euo pipefail

MODEL="${MAGENTA_MODEL:-mrt2_base}"
ASSETS_ROOT="${HOME}/Documents/Magenta"
ASSETS_DIR="${ASSETS_ROOT}/magenta-rt-v2"
CHECKPOINT="${ASSETS_DIR}/checkpoints/${MODEL}.safetensors"
PORT="${PORT:-8002}"

mkdir -p "$ASSETS_ROOT"

if [ ! -f "$CHECKPOINT" ]; then
  echo "[entrypoint] downloading Magenta resources + JAX checkpoint for ${MODEL} (first boot, ~4 GB)…"
  if command -v mrt >/dev/null 2>&1; then
    mrt models init
    mrt checkpoints download "$MODEL" 2>/dev/null || mrt checkpoints download
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

echo "[entrypoint] starting uvicorn on 0.0.0.0:${PORT} (backend=${MAGENTA_BACKEND:-jax})"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"
