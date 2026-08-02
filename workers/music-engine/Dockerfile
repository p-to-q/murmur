# Magenta RT music engine — JAX/CUDA for RunPod (linux/amd64).
# Base: RunPod PyTorch image (Python 3.11 + CUDA 12.4) — magenta-rt requires >=3.11.
#
# One image, two roles (MUSIC_ENGINE_ROLE, see docker-entrypoint.sh):
#   handler (default) — RunPod Serverless queue handler (handler.py).
#   server            — FastAPI HTTP worker (main.py via uvicorn :8002) for a
#                       long-lived RunPod GPU pod.
# Model weights (~4 GB) download once onto the attached network volume
# (/runpod-volume), bridged to ~/Documents/Magenta by docker-entrypoint.sh.

FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MAGENTA_BACKEND=jax \
    MAGENTA_MODEL=mrt2_base \
    MUSIC_ENGINE_PRELOAD=1

ARG MURMUR_MUSIC_ENGINE_REVISION=unknown
ENV MURMUR_MUSIC_ENGINE_REVISION=${MURMUR_MUSIC_ENGINE_REVISION}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

# runpod → serverless handler · fastapi/uvicorn/python-multipart → "server" role.
#
# magenta-rt is pinned. It was previously unpinned, so every rebuild silently
# adopted whatever was newest on PyPI: the 2026-07-30 release of 2.0.3 landed
# between two rebuilds and broke generation (every job returned zero candidates
# in ~340 ms with no usable reason). A release image must be reproducible, so
# the provider version is now part of the source of truth and moves only in a
# reviewed commit.
ARG MAGENTA_RT_VERSION=2.0.2
RUN pip install --upgrade pip \
  && pip install "numpy>=1.26,<3" "magenta-rt[jax]==${MAGENTA_RT_VERSION}" \
     "jax[cuda12]" runpod fastapi "uvicorn[standard]" python-multipart \
  && pip freeze > /app-requirements.lock.txt

WORKDIR /app
COPY engine.py handler.py main.py pipeline.py protocol.py quality_gate.py ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Build-time import smoke catches missing copied modules without loading weights.
RUN MUSIC_ENGINE_MOCK=1 MUSIC_ENGINE_PRELOAD=0 python -c \
  "import handler, main; assert handler.GATE_VERSION == 'music-technical-v2'"

# Pod role serves HTTP here; RunPod maps it to https://<podId>-8002.proxy.runpod.net.
EXPOSE 8002

ENTRYPOINT ["docker-entrypoint.sh"]
