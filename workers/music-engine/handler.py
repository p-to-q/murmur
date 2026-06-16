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
import logging

import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("music-engine")


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
    melody = _coerce_melody(job_input.get("melody"))

    try:
        wav_bytes, meta = engine.generate_clip(
            prompt, duration, hum_bytes, style_mix, melody
        )
    except Exception as error:  # noqa: BLE001 — surface a stable error to the caller
        logger.exception("Generation failed")
        return {"error": "generation_failed", "message": str(error)}

    return {
        "audio_b64": base64.b64encode(wav_bytes).decode("ascii"),
        "model": meta.get("X-Model", engine.MODEL_NAME),
        "generation_ms": int(meta.get("X-Generation-Ms", "0") or 0),
        "style_mix": meta.get("X-Style-Mix", "0.00"),
        "melody_conditioned": meta.get("X-Melody-Conditioned", "0"),
        "cfg_notes": meta.get("X-Cfg-Notes", "0"),
        "sample_rate": engine.SAMPLE_RATE,
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
