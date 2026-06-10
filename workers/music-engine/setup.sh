#!/usr/bin/env bash
# One-shot setup for the music-engine worker (Magenta RealTime 2, MLX backend).
#
# Requires: macOS on Apple Silicon, `uv` (https://docs.astral.sh/uv/).
# Downloads ~4 GB of model assets to ~/Documents/Magenta/magenta-rt-v2 on
# first run (override the model with MAGENTA_MODEL=mrt2_small).

set -euo pipefail
cd "$(dirname "$0")"

MODEL="${MAGENTA_MODEL:-mrt2_base}"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required — install with: brew install uv" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  uv venv --python 3.12 .venv
fi

uv pip install --python .venv/bin/python "magenta-rt[mlx]" fastapi "uvicorn[standard]" python-multipart

.venv/bin/mrt models init
.venv/bin/mrt models download "$MODEL"

echo
echo "music-engine ready. Start it with: bun run dev:music"
