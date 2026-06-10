#!/usr/bin/env bash
# Boot script for the GPU image: fetch model assets once, then serve.
set -euo pipefail

MODEL="${MAGENTA_MODEL:-mrt2_base}"
ASSETS_DIR="${HOME}/Documents/Magenta/magenta-rt-v2"

if [ ! -d "$ASSETS_DIR" ]; then
  echo "[entrypoint] downloading Magenta assets for ${MODEL} (first boot, ~4 GB)…"
  mrt models init
  mrt models download "$MODEL"
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8002}"
