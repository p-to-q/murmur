"""SwiftF0 pitch detector provider."""

from __future__ import annotations

import time

import numpy as np

from audio_engine.detectors import DetectorConfig, DetectorUnavailable, PitchDetection


def detect_swiftf0(audio: object, config: DetectorConfig) -> PitchDetection:
    """Detect monophonic f0 frames with SwiftF0."""
    try:
        from swift_f0 import SwiftF0
    except Exception as exc:
        raise DetectorUnavailable(
            "SwiftF0 package is not installed; install swift-f0",
        ) from exc

    started = time.perf_counter()
    model = get_model(config)
    result = model.detect_from_array(np.asarray(audio, dtype=np.float32), config.sample_rate)
    pitch_ms = round((time.perf_counter() - started) * 1000)
    hop_length = infer_hop_length(result.timestamps, config.sample_rate, config.hop_length)

    return PitchDetection(
        provider="swiftf0",
        f0=result.pitch_hz,
        voiced=result.voicing,
        confidence=result.confidence,
        diagnostics={
            "pitchMs": pitch_ms,
            "swiftFrames": int(len(result.pitch_hz)),
            "swiftVoicedFrames": int(np.count_nonzero(result.voicing)),
            "swiftHopMs": round((hop_length / config.sample_rate) * 1000, 3),
        },
        warnings=[],
        sample_rate=config.sample_rate,
        hop_length=hop_length,
    )


_MODEL_CACHE: dict[tuple[int, int], object] = {}


def get_model(config: DetectorConfig) -> object:
    """Cache one SwiftF0 model per fmin/fmax range."""
    key = (config.fmin, config.fmax)
    if key not in _MODEL_CACHE:
        from swift_f0 import SwiftF0

        _MODEL_CACHE[key] = SwiftF0(fmin=config.fmin, fmax=config.fmax)
    return _MODEL_CACHE[key]


def infer_hop_length(timestamps: object, sample_rate: int, fallback: int) -> int:
    """Infer SwiftF0's frame hop from returned timestamps."""
    timestamp_array = np.asarray(timestamps, dtype=np.float64)
    if timestamp_array.size < 2:
        return fallback
    diffs = np.diff(timestamp_array)
    median_seconds = float(np.median(diffs))
    if median_seconds <= 0:
        return fallback
    return max(1, round(median_seconds * sample_rate))
