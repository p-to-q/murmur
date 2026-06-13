#!/usr/bin/env bash
# Bootstrap Murmur music-engine on the public RunPod PyTorch base image.
# Used when ghcr.io/p-to-q/murmur-music-engine is not pullable without registry auth.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
REF="${MURMUR_GIT_REF:-main}"
BASE="https://raw.githubusercontent.com/p-to-q/murmur/${REF}/workers/music-engine"

echo "[bootstrap] installing system deps…"
apt-get update -qq
apt-get install -y -qq ffmpeg curl

echo "[bootstrap] installing Python deps (magenta-rt + server)…"
pip install -q --upgrade pip
pip install -q "magenta-rt[jax]" "jax[cuda12]" fastapi "uvicorn[standard]" python-multipart

mkdir -p /app
curl -fsSL "${BASE}/main.py" -o /app/main.py

cat > /usr/local/bin/docker-entrypoint.sh << 'ENTRY'
#!/usr/bin/env bash
set -euo pipefail
MODEL="${MAGENTA_MODEL:-mrt2_base}"
ASSETS_ROOT="${HOME}/Documents/Magenta"
ASSETS_DIR="${ASSETS_ROOT}/magenta-rt-v2"
CHECKPOINT="${ASSETS_DIR}/checkpoints/${MODEL}.safetensors"
PORT="${PORT:-8002}"
mkdir -p "$ASSETS_ROOT"
if [ ! -f "$CHECKPOINT" ]; then
  echo "[entrypoint] downloading Magenta resources + JAX checkpoint for ${MODEL} (first boot, ~4 GB)…"
  mrt models init
  mrt checkpoints download "${MODEL}.safetensors" 2>/dev/null || mrt checkpoints download "mrt2_base.safetensors"
fi
if [ ! -f "$CHECKPOINT" ]; then
  echo "[entrypoint] checkpoint missing after download: ${CHECKPOINT}" >&2
  exit 1
fi
echo "[entrypoint] starting uvicorn on 0.0.0.0:${PORT} (backend=${MAGENTA_BACKEND:-jax})"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"
ENTRY
chmod +x /usr/local/bin/docker-entrypoint.sh

cd /app
exec /usr/local/bin/docker-entrypoint.sh
