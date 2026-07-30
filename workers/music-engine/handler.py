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
import pipeline
import protocol
from quality_gate import GATE_VERSION

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("music-engine")

MAX_QUALITY_ATTEMPTS = pipeline.MAX_QUALITY_ATTEMPTS
_retry_sampling = pipeline.retry_sampling


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
    receipt = protocol.input_receipt(
        request_id, prompt, duration, style_mix, melody_input, melody, hum_bytes
    )
    try:
        generated = pipeline.generate_candidates(
            prompt,
            duration,
            hum_bytes,
            style_mix,
            melody,
            request_id=request_id,
            require_hum=bool(job_input.get("hum_b64")) and style_mix > 0,
            require_melody=bool(melody_input),
        )
    except pipeline.PipelineError as error:
        if error.code == "conditioning_failed":
            receipt["conditioning_error"] = error.reason
        return {
            "error": error.code,
            "message": _pipeline_error_message(error.code),
            "input_receipt": receipt,
            "diagnostics": error.diagnostics,
        }

    return protocol.success_output(generated, receipt)


def _pipeline_error_message(code: str) -> str:
    if code == "conditioning_failed":
        return "A requested conditioning signal could not be applied"
    if code == "quality_gate_failed":
        return "Generated audio did not pass the technical quality gate"
    return "Music generation failed"


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
