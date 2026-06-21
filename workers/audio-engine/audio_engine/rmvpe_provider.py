"""RMVPE pitch detector provider."""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np

from audio_engine.detectors import DetectorConfig, DetectorUnavailable, PitchDetection

RMVPE_SAMPLE_RATE = 16_000
RMVPE_HOP_LENGTH = 160
DEFAULT_CONFIDENCE_THRESHOLD = 0.03

_MODEL_CACHE: dict[tuple[str, str], object] = {}


def detect_rmvpe(audio: object, config: DetectorConfig) -> PitchDetection:
    """Detect vocal f0 frames with RMVPE through ONNX Runtime."""
    try:
        from rmvpe_onnx import RMVPE
    except Exception as exc:
        raise DetectorUnavailable(
            "RMVPE package is not installed; install rmvpe-onnx",
        ) from exc

    started = time.perf_counter()
    model_path = resolve_model_path()
    device = configured_device()
    threshold = configured_confidence_threshold()
    try:
        model = get_model(RMVPE, model_path, device)
    except Exception as exc:
        raise DetectorUnavailable(f"RMVPE model could not be loaded: {exc}") from exc

    try:
        timestamps, f0, confidence, _activation = model.predict(
            audio=np.asarray(audio, dtype=np.float32),
            sr=config.sample_rate,
        )
    except Exception as exc:
        raise DetectorUnavailable(f"RMVPE inference failed: {exc}") from exc
    pitch_ms = round((time.perf_counter() - started) * 1000)

    timestamp_array = np.asarray(timestamps, dtype=np.float32)
    f0_array = np.asarray(f0, dtype=np.float32)
    confidence_array = np.asarray(confidence, dtype=np.float32)
    frame_count = min(len(timestamp_array), len(f0_array), len(confidence_array))
    timestamp_array = timestamp_array[:frame_count]
    f0_array = f0_array[:frame_count]
    confidence_array = np.clip(confidence_array[:frame_count], 0.0, 1.0)

    voiced = (
        np.isfinite(f0_array)
        & (f0_array >= float(config.fmin))
        & (f0_array <= float(config.fmax))
        & (confidence_array >= threshold)
    )
    safe_f0 = np.where(voiced, f0_array, np.nan).astype(np.float32)
    execution_provider = first_execution_provider(model)

    return PitchDetection(
        provider="rmvpe",
        timestamps=timestamp_array,
        f0=safe_f0,
        voiced=voiced,
        confidence=confidence_array,
        diagnostics={
            "pitchMs": pitch_ms,
            "rmvpeFrames": int(frame_count),
            "rmvpeVoicedFrames": int(np.count_nonzero(voiced)),
            "rmvpeHopMs": round((RMVPE_HOP_LENGTH / RMVPE_SAMPLE_RATE) * 1000, 3),
            "rmvpeConfidenceThreshold": threshold,
            "rmvpeDevice": device,
            "rmvpeModel": model_path or "default",
            "rmvpeExecutionProvider": execution_provider,
        },
        warnings=[],
        sample_rate=RMVPE_SAMPLE_RATE,
        hop_length=RMVPE_HOP_LENGTH,
    )


def configured_device() -> str:
    return os.getenv("AUDIO_ENGINE_RMVPE_DEVICE", "cpu").strip().lower() or "cpu"


def configured_confidence_threshold() -> float:
    raw = os.getenv("AUDIO_ENGINE_RMVPE_CONFIDENCE_THRESHOLD", "").strip()
    if not raw:
        return DEFAULT_CONFIDENCE_THRESHOLD
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        return DEFAULT_CONFIDENCE_THRESHOLD


def allow_model_download() -> bool:
    return os.getenv("AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def resolve_model_path() -> str | None:
    """Resolve a model path without hidden network downloads by default."""
    configured = os.getenv("AUDIO_ENGINE_RMVPE_MODEL_PATH", "").strip()
    allow_download = allow_model_download()

    if configured:
        path = Path(configured).expanduser()
        if path.exists() or allow_download:
            return str(path)
        raise DetectorUnavailable(
            "RMVPE model is missing; set AUDIO_ENGINE_RMVPE_MODEL_PATH to an "
            "existing rmvpe.onnx file or set AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD=1",
        )

    try:
        from rmvpe_onnx import default_model_path
    except Exception as exc:
        raise DetectorUnavailable(
            "RMVPE package is not installed; install rmvpe-onnx",
        ) from exc

    default_path = Path(default_model_path()).expanduser()
    if default_path.exists():
        return str(default_path)
    if allow_download:
        return None
    raise DetectorUnavailable(
        "RMVPE model is not installed; set AUDIO_ENGINE_RMVPE_MODEL_PATH or "
        "AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD=1",
    )


def get_model(rmvpe_class: object, model_path: str | None, device: str) -> object:
    """Cache one RMVPE model per model path and device."""
    key = (model_path or "__default__", device)
    if key not in _MODEL_CACHE:
        _MODEL_CACHE[key] = rmvpe_class(model_path=model_path, device=device)
    return _MODEL_CACHE[key]


def first_execution_provider(model: object) -> str | None:
    session = getattr(model, "session", None)
    get_providers = getattr(session, "get_providers", None)
    if not callable(get_providers):
        return None
    providers = get_providers()
    if not providers:
        return None
    return str(providers[0])
