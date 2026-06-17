"""librosa YIN pitch detector provider for Melo Lab."""

from __future__ import annotations

import time

import librosa
import numpy as np

from audio_engine.detectors import DetectorConfig, PitchDetection


def detect_yin(audio: object, config: DetectorConfig) -> PitchDetection:
    """Detect monophonic f0 frames with classic YIN.

    YIN does not estimate voicing probability directly, so this adapter derives
    a simple confidence curve from frame RMS and treats low-energy frames as
    unvoiced. It is intended as a light local baseline, not as production truth.
    """
    started = time.perf_counter()
    y = np.asarray(audio, dtype=np.float32)
    f0 = librosa.yin(
        y,
        fmin=config.fmin,
        fmax=config.fmax,
        sr=config.sample_rate,
        frame_length=config.frame_length,
        hop_length=config.hop_length,
    )
    rms = librosa.feature.rms(
        y=y,
        frame_length=config.frame_length,
        hop_length=config.hop_length,
    )[0]
    frame_count = min(len(f0), len(rms))
    f0 = np.asarray(f0[:frame_count], dtype=np.float64)
    rms = np.asarray(rms[:frame_count], dtype=np.float64)
    confidence = rms_to_confidence(rms)
    voiced = np.isfinite(f0) & (f0 > 0) & (confidence >= 0.18)
    timestamps = np.arange(frame_count, dtype=np.float32) * (
        config.hop_length / config.sample_rate
    )

    return PitchDetection(
        provider="yin",
        timestamps=timestamps,
        f0=f0,
        voiced=voiced,
        confidence=confidence,
        diagnostics={
            "pitchMs": round((time.perf_counter() - started) * 1000),
            "yinFrames": int(frame_count),
            "yinVoicedFrames": int(np.count_nonzero(voiced)),
        },
        warnings=["melo_lab_yin_baseline"],
        sample_rate=config.sample_rate,
        hop_length=config.hop_length,
    )


def rms_to_confidence(rms: np.ndarray) -> np.ndarray:
    if rms.size == 0:
        return rms
    floor = float(np.percentile(rms, 15))
    peak = float(np.percentile(rms, 92))
    spread = max(peak - floor, 1e-8)
    confidence = np.clip((rms - floor) / spread, 0.0, 1.0)
    return confidence.astype(np.float64)
