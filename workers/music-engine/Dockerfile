# Magenta RT music engine — JAX/CUDA image for rented GPU servers
# (RunPod, Lambda, EC2 g5/g6, etc.). The Mac/MLX path doesn't use this.
#
# NOTE: authored on a Mac without an NVIDIA GPU, so this image is untested
# here — treat the first remote build as a smoke test. See
# docs/DEPLOY_MUSIC_ENGINE.md for the full walkthrough.
#
# Model weights (~4 GB) download on first boot into /root/Documents/Magenta —
# mount a volume there to survive restarts:
#   docker run --gpus all -p 8002:8002 \
#     -e MUSIC_WORKER_TOKEN=<token> \
#     -v magenta-models:/root/Documents/Magenta murmur-music-engine

FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# magenta-rt's GPU extra when it exists; otherwise the base package plus
# the CUDA-enabled JAX wheel.
RUN pip install --no-cache-dir "magenta-rt[gpu]" fastapi "uvicorn[standard]" python-multipart \
  || pip install --no-cache-dir magenta-rt "jax[cuda12]" fastapi "uvicorn[standard]" python-multipart

WORKDIR /app
COPY main.py .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV MAGENTA_BACKEND=jax \
    MAGENTA_MODEL=mrt2_base \
    MUSIC_ENGINE_PRELOAD=1

EXPOSE 8002
ENTRYPOINT ["docker-entrypoint.sh"]
