"""Transport-independent generation, retry, and quality evidence pipeline."""

from __future__ import annotations

import hashlib
import logging
import os
import time

import engine
from quality_gate import GATE_VERSION, analyze_wav

logger = logging.getLogger("music-engine")

try:
    _configured_quality_attempts = int(os.getenv("MUSIC_QUALITY_MAX_ATTEMPTS", "2"))
except ValueError:
    _configured_quality_attempts = 2

MAX_QUALITY_ATTEMPTS = max(1, min(3, _configured_quality_attempts))


class PipelineError(RuntimeError):
    """Stable transport-neutral failure with bounded diagnostics."""

    def __init__(self, code: str, reason: str, diagnostics: dict):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.diagnostics = diagnostics


def generate_candidates(
    prompt: str,
    duration: float,
    hum_bytes: bytes | None,
    style_mix: float,
    melody: dict | None,
    *,
    request_id: str,
    require_hum: bool,
    require_melody: bool,
) -> dict:
    """Generate until the versioned Gate passes and return bounded evidence."""

    started = time.monotonic()
    if require_hum and not hum_bytes:
        raise PipelineError(
            "conditioning_failed",
            "hum_input_invalid",
            diagnostics([], 0, started, conditioning_error="hum_input_invalid"),
        )
    if require_melody and valid_note_count(melody, duration) == 0:
        raise PipelineError(
            "conditioning_failed",
            "melody_has_no_valid_notes",
            diagnostics(
                [], 0, started, conditioning_error="melody_has_no_valid_notes"
            ),
        )

    candidates = []
    total_generation_ms = 0
    seen_digests: dict[str, int] = {}
    wav_bytes = b""
    meta: dict[str, str] = {}
    quality = None

    for attempt in range(1, MAX_QUALITY_ATTEMPTS + 1):
        temperature, top_k = retry_sampling(attempt)
        try:
            wav_bytes, meta = engine.generate_clip(
                prompt,
                duration,
                hum_bytes,
                style_mix,
                melody,
                temperature=temperature,
                top_k=top_k,
            )
        except engine.ConditioningError as error:
            logger.warning(
                "conditioning_failed request_id=%s code=%s", request_id, error.code
            )
            raise PipelineError(
                "conditioning_failed",
                error.code,
                diagnostics(
                    candidates,
                    total_generation_ms,
                    started,
                    conditioning_error=error.code,
                ),
            ) from error
        except Exception as error:  # noqa: BLE001 - normalize vendor failures
            logger.exception("Generation failed")
            raise PipelineError(
                "generation_failed",
                type(error).__name__,
                diagnostics(candidates, total_generation_ms, started),
            ) from error

        generation_ms = int(meta.get("X-Generation-Ms", "0") or 0)
        total_generation_ms += generation_ms
        quality = analyze_wav(wav_bytes, duration)
        digest = hashlib.sha256(wav_bytes).hexdigest()
        duplicate_of_attempt = seen_digests.get(digest)
        seen_digests.setdefault(digest, attempt)
        candidates.append(
            {
                "candidate_id": hashlib.sha256(
                    f"{request_id}:{attempt}:{digest}".encode("utf-8")
                ).hexdigest()[:24],
                "attempt": attempt,
                "audio_sha256": digest,
                "duplicate_of_attempt": duplicate_of_attempt,
                "generation_ms": generation_ms,
                "sampling": {
                    "temperature": temperature,
                    "top_k": top_k,
                    "seed_control": "library_managed",
                },
                "conditioning": conditioning_evidence(meta),
                "quality": quality,
            }
        )
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
        raise PipelineError(
            "quality_gate_failed",
            "technical_quality_rejected",
            diagnostics(candidates, total_generation_ms, started),
        )

    return {
        "wav_bytes": wav_bytes,
        "meta": meta,
        "quality": quality,
        "diagnostics": diagnostics(candidates, total_generation_ms, started),
    }


def retry_sampling(attempt: int) -> tuple[float, int]:
    """Keep candidate one stable, then make retries deliberately conservative."""

    if attempt <= 1:
        return engine.SAMPLING_TEMPERATURE, engine.SAMPLING_TOP_K
    if attempt == 2:
        return min(engine.SAMPLING_TEMPERATURE, 1.10), min(engine.SAMPLING_TOP_K, 32)
    return min(engine.SAMPLING_TEMPERATURE, 0.95), min(engine.SAMPLING_TOP_K, 24)


def valid_note_count(melody: dict | None, total_duration: float | None = None) -> int:
    if not isinstance(melody, dict):
        return 0
    count = 0
    for note in melody.get("notes") or []:
        try:
            pitch = int(note.get("pitch", -1))
            start = float(note.get("start", 0.0))
            duration = float(note.get("duration", 0.0))
        except (TypeError, ValueError, AttributeError):
            continue
        if (
            0 <= pitch <= 127
            and start >= 0
            and duration > 0
            and (total_duration is None or start < total_duration)
        ):
            count += 1
    return count


def conditioning_evidence(meta: dict[str, str]) -> dict:
    return {
        "style_mix": float(meta.get("X-Style-Mix", "0") or 0),
        "melody_conditioned": meta.get("X-Melody-Conditioned", "0") == "1",
        "melody_segments": int(meta.get("X-Melody-Segments", "0") or 0),
        "melody_onsets": int(meta.get("X-Melody-Onsets", "0") or 0),
        "melody_coverage": float(meta.get("X-Melody-Coverage", "0") or 0),
        "cfg_notes": float(meta.get("X-Cfg-Notes", "0") or 0),
        "pre_normalization_peak": float(
            meta.get("X-Pre-Normalization-Peak", "0") or 0
        ),
        "pre_normalization_rms": float(
            meta.get("X-Pre-Normalization-Rms", "0") or 0
        ),
        "normalization_gain_db": float(
            meta.get("X-Normalization-Gain-Db", "0") or 0
        ),
    }


def diagnostics(
    candidates: list,
    total_generation_ms: int,
    started: float,
    conditioning_error: str | None = None,
) -> dict:
    result = {
        "version": 2,
        "gate_version": GATE_VERSION,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "total_generation_ms": total_generation_ms,
        "worker_wall_ms": int((time.monotonic() - started) * 1000),
        "runtime": engine.runtime_fingerprint(),
    }
    if conditioning_error:
        result["conditioning_error"] = conditioning_error
    return result
