# Murmur audio-engine (transcription worker) container.
# Lightweight CPU image: FastAPI + librosa + swift-f0. The optional torch/
# deepfilternet denoise stack (requirements-denoise.txt) is intentionally NOT
# installed — the worker degrades to its pure-numpy path (denoiseProvider
# "auto"), which is exactly how production has been running.
FROM python:3.11-slim

# ffmpeg: decode webm/m4a uploads → wav. libsndfile1: soundfile backend.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first so the layer caches across code-only changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# App code. .dockerignore keeps out .venv, tests, tools, __pycache__.
COPY . .

EXPOSE 8001

# Capture-to-disk defaults on but is disabled via fly.toml env (ephemeral FS).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
