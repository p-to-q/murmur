# Magenta RT music engine — JAX/CUDA for RunPod / Lambda / EC2 g5+.
# Build on linux/amd64 (GitHub Actions or: docker buildx build --platform linux/amd64 …).
#
# Model weights (~4 GB) download on first boot into /root/Documents/Magenta —
# mount a RunPod network volume there to survive restarts:
#   volumeMountPath: /root/Documents/Magenta

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MAGENTA_BACKEND=jax \
    MAGENTA_MODEL=mrt2_base \
    MUSIC_ENGINE_PRELOAD=1 \
    PORT=8002

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && ln -sf /usr/bin/pip3 /usr/local/bin/pip

RUN pip install --upgrade pip \
  && (pip install "magenta-rt[gpu]" fastapi "uvicorn[standard]" python-multipart \
      || pip install magenta-rt "jax[cuda12]" fastapi "uvicorn[standard]" python-multipart)

WORKDIR /app
COPY main.py .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
