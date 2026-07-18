"""RunPod Serverless handler for the Murmur music-engine (production).

Drives the same backend-agnostic core as the dev FastAPI server (`engine.py`),
but speaks RunPod's queue/handler protocol instead of HTTP:

    POST https://api.runpod.ai/v2/{endpoint_id}/run
      { "input": { prompt, duration, style_mix, melody, hum_b64 } }
    → job → GET /status/{id}
      { "output": { audio_b64, model, generation_ms, style_mix,
                    melody_conditioned, cfg_notes, sample_rate } }

Serverless I/O is JSON, so the hum arrives base64-encoded and the WAV goes back
base64-encoded (a ≤20 s 48 kHz stereo PCM16 clip is ~5 MB base64 — well under
RunPod's 10 MB /run output cap). RunPod's gateway authenticates the caller, so
there is no worker-side token check (unlike the dev HTTP server).

The model loads once per worker and stays resident across jobs (workers idle
for `idleTimeout` before scaling to zero). Weights live on the network volume
mounted at /runpod-volume (see docker-entrypoint.sh), so a cold worker reuses
the cached ~4 GB download instead of re-fetching it.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import platform
import time

import engine
from quality_gate import GATE_VERSION, analyze_wav

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("music-engine")

try:
    configured_quality_attempts = int(os.getenv("MUSIC_QUALITY_MAX_ATTEMPTS", "2"))
except ValueError:
    configured_quality_attempts = 2

MAX_QUALITY_ATTEMPTS = max(1, min(3, configured_quality_attempts))


def _clamp_prompt(value: object) -> str:
    prompt = (value if isinstance(value, str) else "").strip()
    return prompt[: engine.MAX_PROMPT_CHARS]


def _clamp_float(value: object, default: float, lo: float, hi: float) -> float:
    try:
        num = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        num = default
    if num != num:  # NaN
        num = default
    return max(lo, min(hi, num))


def _decode_hum(value: object) -> bytes | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        raw = base64.b64decode(value, validate=False)
    except (ValueError, TypeError):
        return None
    if not raw or len(raw) > engine.MAX_HUM_BYTES:
        return None
    return raw


def _coerce_melody(value: object) -> dict | None:
    """Accept either a melody object or its JSON string form."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        import json

        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def handler(job: dict) -> dict:
    """Generate one clip. Returns the job output dict (or {error, message})."""
    job_input = job.get("input") or {}

    prompt = _clamp_prompt(job_input.get("prompt"))
    if not prompt:
        return {"error": "prompt_required", "message": "prompt is required"}

    duration = _clamp_float(
        job_input.get("duration", 10.0), 10.0, engine.MIN_DURATION, engine.MAX_DURATION
    )
    style_mix = _clamp_float(job_input.get("style_mix", 0.0), 0.0, 0.0, 0.8)
    hum_bytes = _decode_hum(job_input.get("hum_b64"))
    melody_input = job_input.get("melody")
    melody = _coerce_melody(melody_input)

    request_id = str(job_input.get("request_id") or "")[:128]
    receipt = _input_receipt(
        request_id, prompt, duration, style_mix, melody_input, melody, hum_bytes
    )
    candidates = []
    total_generation_ms = 0
    started = time.monotonic()
    wav_bytes = b""
    meta = {}
    quality = None

    for attempt in range(1, MAX_QUALITY_ATTEMPTS + 1):
        try:
            wav_bytes, meta = engine.generate_clip(
                prompt, duration, hum_bytes, style_mix, melody
            )
        except Exception as error:  # noqa: BLE001 — stable error contract
            logger.exception("Generation failed")
            return {
                "error": "generation_failed",
                "message": str(error),
                "input_receipt": receipt,
                "diagnostics": _diagnostics(candidates, total_generation_ms, started),
            }

        generation_ms = int(meta.get("X-Generation-Ms", "0") or 0)
        total_generation_ms += generation_ms
        quality = analyze_wav(wav_bytes, duration)
        candidates.append({
            "attempt": attempt,
            "generation_ms": generation_ms,
            "quality": quality,
        })
        logger.info(
            "quality_gate request_id=%s attempt=%d passed=%s failures=%s",
            request_id,
            attempt,
            quality["passed"],
            quality["failures"],
        )
        if quality["passed"]:
            break

    if not quality or not quality["passed"]:
        return {
            "error": "quality_gate_failed",
            "message": "Generated audio did not pass the technical quality gate",
            "input_receipt": receipt,
            "diagnostics": _diagnostics(candidates, total_generation_ms, started),
        }

    return {
        "audio_b64": base64.b64encode(wav_bytes).decode("ascii"),
        "model": meta.get("X-Model", engine.MODEL_NAME),
        "generation_ms": int(meta.get("X-Generation-Ms", "0") or 0),
        "style_mix": meta.get("X-Style-Mix", "0.00"),
        "melody_conditioned": meta.get("X-Melody-Conditioned", "0"),
        "cfg_notes": meta.get("X-Cfg-Notes", "0"),
        "sample_rate": engine.SAMPLE_RATE,
        "input_receipt": receipt,
        "quality": quality,
        "diagnostics": _diagnostics(candidates, total_generation_ms, started),
    }


def _input_receipt(
    request_id, prompt, duration, style_mix, melody_input, melody, hum_bytes
):
    if isinstance(melody_input, str):
        melody_json = melody_input
    elif melody_input:
        melody_json = json.dumps(
            melody_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
    else:
        melody_json = ""
    return {
        "version": 1,
        "request_id": request_id,
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "duration": duration,
        "style_mix": style_mix,
        "melody_sha256": hashlib.sha256(melody_json.encode("utf-8")).hexdigest() if melody_json else None,
        "melody_accepted": melody is not None if melody_json else False,
        "hum_sha256": hashlib.sha256(hum_bytes).hexdigest() if hum_bytes else None,
    }


def _diagnostics(candidates, total_generation_ms, started):
    return {
        "version": 1,
        "gate_version": GATE_VERSION,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "total_generation_ms": total_generation_ms,
        "worker_wall_ms": int((time.monotonic() - started) * 1000),
        "runtime": {
            "model": engine.MODEL_NAME,
            "python": platform.python_version(),
            "backend": os.getenv("MAGENTA_BACKEND", "auto"),
        },
    }


# Warm the model at import so the first job after a cold start doesn't pay the
# full ~45 s load on top of container spin-up (skipped in mock / when disabled).
if not engine.MOCK and engine.PRELOAD:
    try:
        engine.load_model()
    except Exception:  # noqa: BLE001 — first job will retry and surface the error
        logger.exception("Preload failed; the first job will retry the model load")


if __name__ == "__main__":
    # Imported lazily so the module stays unit-testable without the RunPod SDK
    # (the production container has it; local tests call handler() directly).
    import runpod

    runpod.serverless.start({"handler": handler})
