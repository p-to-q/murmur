"""Murmur music-engine worker — wraps Magenta RealTime 2 (MLX) behind HTTP.

Mirrors the audio-engine worker's contract style: a small FastAPI app with
bearer-token auth, run locally via uvicorn (see `bun run dev:music`).

POST /generate
    multipart form:
      prompt      (str, required)  — English style prompt for MusicCoCa
      duration    (float, default 10, clamped 2–30 seconds)
      style_mix   (float, default 0.35, clamped 0–0.8) — weight of the hum
                  audio embedding blended into the text style embedding
      hum         (file, optional) — the user's hum recording; when present
                  its MusicCoCa embedding is blended with the text prompt so
                  the generated clip keeps a trace of the hum's character
    → audio/wav (48 kHz stereo PCM16)

GET /health
    → {status, mock, model, loaded, loading, loadError}

Env:
    MAGENTA_MODEL        mrt2_base (default) | mrt2_small
    MUSIC_WORKER_TOKEN   optional bearer token (same scheme as audio-engine)
    MUSIC_ENGINE_MOCK    "1" → serve synthesized placeholder clips, never
                         import magenta (CI / tests / machines without weights)
    MUSIC_ENGINE_PRELOAD "0" → skip loading the model at startup (default on)

The MLX model holds the GPU; generation is serialized with a lock. The model
loads once (~45 s for mrt2_base on an M4 Max) and stays resident — that is
the whole point of this worker existing instead of shelling out to `mrt mlx
generate` per request.
"""

from __future__ import annotations

import asyncio
import functools
import hmac
import io
import logging
import math
import os
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("music-engine")
logging.basicConfig(level=logging.INFO)

MOCK = os.getenv("MUSIC_ENGINE_MOCK", "").strip().lower() in {"1", "true", "yes"}
MODEL_NAME = os.getenv("MAGENTA_MODEL", "mrt2_base").strip() or "mrt2_base"
PRELOAD = os.getenv("MUSIC_ENGINE_PRELOAD", "1").strip().lower() not in {"0", "false", "no"}

SAMPLE_RATE = 48_000
FRAMES_PER_SECOND = 25          # MRT2: 25 codec frames ≈ 1 s of audio
MAX_FRAMES_PER_CALL = 250       # generate ≤10 s per call, then carry state
MIN_DURATION = 2.0
MAX_DURATION = 30.0
MAX_HUM_BYTES = 8 * 1024 * 1024
MAX_PROMPT_CHARS = 300

# MLX binds its GPU stream to the thread that loaded the model, so *every*
# model operation (load, embed, generate) must run on one dedicated thread.
# A single-worker executor both pins the thread and serializes generation.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="magenta")
_load_lock = threading.Lock()
_mrt = None
_loading = False
_load_error: str | None = None


# ── Model lifecycle ────────────────────────────────────────────────────


def _import_system_class():
    """Pick the inference backend.

    MAGENTA_BACKEND=mlx   force Apple-Silicon MLX (errors elsewhere)
    MAGENTA_BACKEND=jax   force JAX (NVIDIA GPU / TPU / CPU servers)
    MAGENTA_BACKEND=auto  (default) MLX when importable, else JAX
    """
    backend = (os.getenv("MAGENTA_BACKEND", "auto").strip().lower() or "auto")
    if backend in ("auto", "mlx"):
        try:
            from magenta_rt import MagentaRT2Mlxfn

            return "mlx", MagentaRT2Mlxfn
        except Exception:
            if backend == "mlx":
                raise
    import magenta_rt

    for name in ("MagentaRT2", "MagentaRT2System"):
        cls = getattr(magenta_rt, name, None)
        if cls is not None:
            return "jax", cls
    raise RuntimeError(
        "magenta_rt exposes neither MagentaRT2 nor MagentaRT2System for the JAX backend"
    )


def _load_model():
    """Idempotently load the model; safe to call from any thread."""
    global _mrt, _loading, _load_error
    if _mrt is not None:
        return _mrt
    with _load_lock:
        if _mrt is not None:
            return _mrt
        _loading = True
        started = time.time()
        try:
            backend, system_cls = _import_system_class()

            logger.info("Loading Magenta RT model '%s' (%s)…", MODEL_NAME, backend)
            model = system_cls(size=MODEL_NAME)
            _mrt = model
            _load_error = None
            logger.info("Model '%s' ready in %.1fs", MODEL_NAME, time.time() - started)
            return _mrt
        except Exception as error:  # noqa: BLE001 — surface anything to /health
            _load_error = f"{type(error).__name__}: {error}"
            logger.exception("Failed to load Magenta RT model '%s'", MODEL_NAME)
            raise
        finally:
            _loading = False


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if not os.getenv("MUSIC_WORKER_TOKEN", "").strip():
        logger.warning(
            "MUSIC_WORKER_TOKEN is not set — all endpoints are UNAUTHENTICATED. "
            "Fine for localhost dev; never expose this process through a public tunnel."
        )

    if not MOCK and PRELOAD:
        def _bg() -> None:
            try:
                _load_model()
            except Exception:  # noqa: BLE001 — already logged; /health reports it
                pass

        _executor.submit(_bg)

    yield


app = FastAPI(title="murmur-music-engine", lifespan=_lifespan)


# ── Helpers ────────────────────────────────────────────────────────────


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


def blend_style_embeddings(
    text_emb: np.ndarray, audio_emb: np.ndarray, mix: float
) -> np.ndarray:
    """Weighted blend of MusicCoCa embeddings, renormalized to unit length.

    MusicCoCa embeddings live in a contrastive joint space, so a convex
    combination followed by L2 renormalization is the standard way to mix
    styles. Falls back to the text embedding when shapes disagree.
    """
    a = np.asarray(text_emb, dtype=np.float32)
    b = np.asarray(audio_emb, dtype=np.float32)
    if a.shape != b.shape:
        return a
    out = (1.0 - mix) * a + mix * b
    norm = float(np.linalg.norm(out))
    if norm > 1e-6:
        out = out / norm
    return out


def pcm16_wav_bytes(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Encode float32 [nsamp, nch] samples as a PCM16 WAV blob (stdlib only)."""
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as writer:
        writer.setnchannels(pcm.shape[1])
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm.tobytes())
    return buf.getvalue()


def mock_clip(prompt: str, duration: float) -> bytes:
    """Deterministic pleasant placeholder so the app is testable without weights."""
    rng = np.random.default_rng(abs(hash(prompt)) % (2**32))
    n = int(duration * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    root = float(rng.choice([220.0, 246.94, 261.63, 293.66, 329.63]))
    chord = [root, root * 5 / 4, root * 3 / 2]
    left = np.zeros(n, dtype=np.float32)
    right = np.zeros(n, dtype=np.float32)
    for i, freq in enumerate(chord):
        env = 0.5 + 0.5 * np.sin(2 * math.pi * (0.25 + 0.1 * i) * t + i)
        tone = np.sin(2 * math.pi * freq * t).astype(np.float32) * env.astype(np.float32)
        left += tone * (0.18 if i % 2 == 0 else 0.12)
        right += tone * (0.12 if i % 2 == 0 else 0.18)
    fade = np.minimum(1.0, np.minimum(t / 0.05, (duration - t) / 0.25)).astype(np.float32)
    return pcm16_wav_bytes(np.stack([left * fade, right * fade], axis=1))


def _generate_on_model_thread(
    prompt: str, duration: float, hum_bytes: bytes | None, style_mix: float
) -> tuple[bytes, dict[str, str]]:
    """Run one full clip generation. Must execute on the `_executor` thread."""
    mrt = _load_model()
    started = time.time()

    style = mrt.embed_style(prompt, use_mapper=True)
    mixed = 0.0
    if hum_bytes and style_mix > 0:
        try:
            from magenta_rt.audio import Waveform

            hum = Waveform.from_file(io.BytesIO(hum_bytes))
            hum_emb = mrt.embed_style(hum)
            style = blend_style_embeddings(style, hum_emb, style_mix)
            mixed = style_mix
        except Exception as error:  # noqa: BLE001 — hum styling is best-effort
            logger.warning("Hum style embedding failed, using text only: %s", error)

    total_frames = int(round(duration * FRAMES_PER_SECOND))
    chunks = []
    state = None
    remaining = total_frames
    while remaining > 0:
        frames = min(MAX_FRAMES_PER_CALL, remaining)
        wav, state = mrt.generate(style=style, frames=frames, state=state)
        chunks.append(wav)
        remaining -= frames

    if len(chunks) == 1:
        full = chunks[0]
    else:
        from magenta_rt import audio as audio_lib

        full = audio_lib.concatenate(chunks)
    full = full.as_stereo().peak_normalize(0.95)
    samples = np.asarray(full.samples, dtype=np.float32)

    elapsed_ms = int((time.time() - started) * 1000)
    meta = {
        "X-Model": MODEL_NAME,
        "X-Generation-Ms": str(elapsed_ms),
        "X-Style-Mix": f"{mixed:.2f}",
    }
    logger.info(
        "Generated %.1fs clip in %dms (prompt=%r, style_mix=%.2f)",
        duration, elapsed_ms, prompt[:80], mixed,
    )
    return pcm16_wav_bytes(samples, full.sample_rate), meta


# ── Routes ─────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "degraded" if _load_error else "ok",
        "mock": MOCK,
        "model": MODEL_NAME,
        "loaded": MOCK or _mrt is not None,
        "loading": _loading,
        "loadError": _load_error,
    }


@app.post("/generate")
async def generate(
    request: Request,
    prompt: str = Form(...),
    duration: float = Form(10.0),
    style_mix: float = Form(0.35),
    hum: UploadFile | None = File(None),
) -> Response:
    _verify_auth(request)

    prompt = prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail={"error": "prompt_required"})
    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS]
    duration = max(MIN_DURATION, min(MAX_DURATION, float(duration)))
    style_mix = max(0.0, min(0.8, float(style_mix)))

    hum_bytes: bytes | None = None
    if hum is not None:
        hum_bytes = await hum.read()
        if len(hum_bytes) > MAX_HUM_BYTES:
            raise HTTPException(status_code=413, detail={"error": "hum_too_large"})
        if len(hum_bytes) == 0:
            hum_bytes = None

    if MOCK:
        body = await run_in_threadpool(mock_clip, prompt, duration)
        return Response(
            content=body,
            media_type="audio/wav",
            headers={"X-Model": "mock", "X-Generation-Ms": "0", "X-Style-Mix": "0.00"},
        )

    try:
        body, meta = await asyncio.get_running_loop().run_in_executor(
            _executor,
            functools.partial(
                _generate_on_model_thread, prompt, duration, hum_bytes, style_mix
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
