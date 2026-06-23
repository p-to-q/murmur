"""Murmur music-engine worker — FastAPI frontend for local dev.

Wraps the backend-agnostic core in `engine.py` behind a small HTTP API with
bearer-token auth, run locally via uvicorn (see `bun run dev:music`). Mirrors
the audio-engine worker's contract style.

In production the same `engine.py` core is driven by `handler.py` on RunPod
Serverless instead — this server is the dev/local path.

POST /generate
    multipart form:
      prompt      (str, required)  — English style prompt for MusicCoCa
      duration    (float, default 10, clamped 2–30 seconds)
      style_mix   (float, default 0.35, clamped 0–0.8) — weight of the hum
                  audio embedding blended into the text style embedding
      melody      (str, optional)  — JSON {notes:[{pitch,start,duration}…]}
      hum         (file, optional) — the user's hum recording; when present
                  its MusicCoCa embedding is blended with the text prompt
    → audio/wav (48 kHz stereo PCM16)

GET /health
    → {status, mock, model, loaded, loading, loadError}

Env: see engine.py (MAGENTA_MODEL / MAGENTA_BACKEND / MUSIC_ENGINE_MOCK /
MUSIC_ENGINE_PRELOAD) plus MUSIC_WORKER_TOKEN (required outside local dev).

The model loads once and stays resident; generation is serialized on a single
dedicated thread (MLX binds its GPU stream to the loading thread).
"""

from __future__ import annotations

import asyncio
import functools
import hmac
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

import engine
# Re-exported for tests and backwards compatibility (tests import `main.*`).
from engine import (  # noqa: F401
    MAX_DURATION,
    MIN_DURATION,
    MOCK,
    MODEL_NAME,
    PRELOAD,
    SAMPLE_RATE,
    blend_style_embeddings,
    decode_hum_waveform,
    mock_clip,
    pcm16_wav_bytes,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("music-engine")

MAX_HUM_BYTES = engine.MAX_HUM_BYTES
MAX_PROMPT_CHARS = engine.MAX_PROMPT_CHARS
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", ""}

# MLX binds its GPU stream to the thread that loaded the model, so *every*
# model operation (load, embed, generate) must run on one dedicated thread.
# A single-worker executor both pins the thread and serializes generation.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="magenta")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    require_worker_token()

    if not engine.MOCK and engine.PRELOAD:
        def _bg() -> None:
            try:
                engine.load_model()
            except Exception:  # noqa: BLE001 — already logged; /health reports it
                pass

        _executor.submit(_bg)

    yield


app = FastAPI(title="murmur-music-engine", lifespan=_lifespan)


def _truthy_env(name: str) -> bool:
    value = os.getenv(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _runtime_env() -> str:
    for name in ("MURMUR_ENV", "APP_ENV", "NODE_ENV", "ENV"):
        value = os.getenv(name, "").strip().lower()
        if value:
            return value
    return ""


def _bind_host() -> str:
    for name in ("MUSIC_ENGINE_HOST", "MURMUR_WORKER_BIND_HOST", "UVICORN_HOST", "HOST"):
        value = os.getenv(name, "").strip().lower()
        if value:
            return value
    return ""


def worker_auth_required() -> bool:
    host = _bind_host()
    return (
        _truthy_env("MUSIC_WORKER_REQUIRE_AUTH")
        or _truthy_env("WORKER_REQUIRE_AUTH")
        or _runtime_env() == "production"
        or (host not in LOOPBACK_HOSTS)
    )


def require_worker_token() -> None:
    if os.getenv("MUSIC_WORKER_TOKEN", "").strip():
        return
    if worker_auth_required():
        raise RuntimeError(
            "MUSIC_WORKER_TOKEN is required when the music worker is production "
            "or bound outside loopback."
        )
    logger.warning(
        "MUSIC_WORKER_TOKEN is not set — /generate is UNAUTHENTICATED. "
        "Allowed only for loopback local dev."
    )


def _verify_auth(request: Request) -> None:
    expected = os.getenv("MUSIC_WORKER_TOKEN", "").strip()
    if not expected:
        return
    provided = request.headers.get("authorization", "")
    # Compare as bytes: str compare_digest raises TypeError (→ 500) on
    # non-ASCII input, and header values arrive latin-1 decoded.
    if not hmac.compare_digest(
        provided.encode("utf-8"), f"Bearer {expected}".encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "degraded" if engine.model_load_error() else "ok",
        "mock": engine.MOCK,
        "model": engine.MODEL_NAME,
        "loaded": engine.model_loaded(),
        "loading": engine.model_loading(),
        "loadError": engine.model_load_error(),
    }


@app.post("/generate")
async def generate(
    request: Request,
    prompt: str = Form(...),
    duration: float = Form(10.0),
    style_mix: float = Form(0.35),
    melody: str = Form(""),
    hum: UploadFile | None = File(None),
) -> Response:
    _verify_auth(request)

    prompt = prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail={"error": "prompt_required"})
    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS]
    duration = max(engine.MIN_DURATION, min(engine.MAX_DURATION, float(duration)))
    style_mix = max(0.0, min(0.8, float(style_mix)))

    melody_obj: dict | None = None
    if melody.strip():
        try:
            melody_obj = json.loads(melody)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail={"error": "invalid_melody_json"})

    hum_bytes: bytes | None = None
    if hum is not None:
        hum_bytes = await hum.read()
        if len(hum_bytes) > MAX_HUM_BYTES:
            raise HTTPException(status_code=413, detail={"error": "hum_too_large"})
        if len(hum_bytes) == 0:
            hum_bytes = None

    try:
        body, meta = await asyncio.get_running_loop().run_in_executor(
            _executor,
            functools.partial(
                engine.generate_clip, prompt, duration, hum_bytes, style_mix, melody_obj
            ),
        )
    except HTTPException:
        raise
    except Exception as error:  # noqa: BLE001 — map to a stable error contract
        logger.exception("Generation failed")
        raise HTTPException(
            status_code=500,
            detail={"error": "generation_failed", "message": str(error)},
        ) from error

    return Response(content=body, media_type="audio/wav", headers=meta)
