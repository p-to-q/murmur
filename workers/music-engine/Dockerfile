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

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

# runpod → serverless handler · fastapi/uvicorn/python-multipart → "server" role.
RUN pip install --upgrade pip \
  && pip install "magenta-rt[jax]" "jax[cuda12]" runpod \
     fastapi "uvicorn[standard]" python-multipart

WORKDIR /app
COPY engine.py handler.py main.py ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Pod role serves HTTP here; RunPod maps it to https://<podId>-8002.proxy.runpod.net.
EXPOSE 8002

ENTRYPOINT ["docker-entrypoint.sh"]
