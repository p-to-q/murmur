#!/usr/bin/env bash
# Boot script for the GPU image: fetch model assets once, then serve.
set -euo pipefail

MODEL="${MAGENTA_MODEL:-mrt2_base}"
ASSETS_ROOT="${HOME}/Documents/Magenta"
ASSETS_DIR="${ASSETS_ROOT}/magenta-rt-v2"
PORT="${PORT:-8002}"

mkdir -p "$ASSETS_ROOT"

if [ ! -d "$ASSETS_DIR" ] || [ -z "$(ls -A "$ASSETS_DIR" 2>/dev/null || true)" ]; then
  echo "[entrypoint] downloading Magenta assets for ${MODEL} (first boot, ~4 GB)…"
  if command -v mrt >/dev/null 2>&1; then
    mrt models init
    mrt models download "$MODEL"
  else
    python - <<'PY'
import os
from pathlib import Path

model = os.environ.get("MAGENTA_MODEL", "mrt2_base")
assets = Path.home() / "Documents" / "Magenta" / "magenta-rt-v2"
if assets.exists() and any(assets.iterdir()):
    raise SystemExit(0)

backend = os.environ.get("MAGENTA_BACKEND", "jax").strip().lower()
if backend in ("auto", "mlx"):
    try:
        from magenta_rt import MagentaRT2Mlxfn  # noqa: F401
        cls = MagentaRT2Mlxfn
        backend = "mlx"
    except Exception:
        backend = "jax"

import magenta_rt
for name in ("MagentaRT2", "MagentaRT2System", "MagentaRT2Mlxfn"):
    cls = getattr(magenta_rt, name, None)
    if cls is not None:
        print(f"[entrypoint] warming model via {name} ({backend})…")
        cls(model)
        break
else:
    raise RuntimeError("No Magenta RT system class found for asset bootstrap")
PY
  fi
fi

echo "[entrypoint] starting uvicorn on 0.0.0.0:${PORT} (backend=${MAGENTA_BACKEND:-jax})"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"
