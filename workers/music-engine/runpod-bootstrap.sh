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
curl -fsSL "${BASE}/docker-entrypoint.sh" -o /usr/local/bin/docker-entrypoint.sh
chmod +x /usr/local/bin/docker-entrypoint.sh

cd /app
exec /usr/local/bin/docker-entrypoint.sh
