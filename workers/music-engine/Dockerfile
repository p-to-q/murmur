# Magenta RT music engine — JAX/CUDA for RunPod Serverless (linux/amd64).
# Base: RunPod PyTorch image (Python 3.11 + CUDA 12.4) — magenta-rt requires >=3.11.
#
# Runs the RunPod Serverless handler (handler.py). Model weights (~4 GB) download
# once on first cold start onto the attached network volume (/runpod-volume),
# bridged to ~/Documents/Magenta by docker-entrypoint.sh.

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

RUN pip install --upgrade pip \
  && pip install "magenta-rt[jax]" "jax[cuda12]" runpod

WORKDIR /app
COPY engine.py handler.py main.py ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
