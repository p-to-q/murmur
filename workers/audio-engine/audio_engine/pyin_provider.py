"""librosa pYIN pitch detector provider."""

from __future__ import annotations

import time

import librosa
import numpy as np

from audio_engine.detectors import DetectorConfig, PitchDetection


def detect_pyin(audio: object, config: DetectorConfig) -> PitchDetection:
    """Detect monophonic f0 frames with librosa pYIN."""
    started = time.perf_counter()
    f0, voiced_flag, voiced_probs = librosa.pyin(
        audio,
        fmin=config.fmin,
        fmax=config.fmax,
        sr=config.sample_rate,
        frame_length=config.frame_length,
        hop_length=config.hop_length,
        fill_na=float("nan"),
    )
    timestamps = np.arange(len(f0), dtype=np.float32) * (
        config.hop_length / config.sample_rate
    )
    return PitchDetection(
        provider="pyin",
        timestamps=timestamps,
        f0=f0,
        voiced=voiced_flag,
        confidence=voiced_probs,
        diagnostics={
            "pitchMs": round((time.perf_counter() - started) * 1000),
        },
        warnings=["pyin_fallback"],
        sample_rate=config.sample_rate,
        hop_length=config.hop_length,
    )
