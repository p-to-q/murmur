"""Praat/Parselmouth pitch detector provider for Melo Lab."""

from __future__ import annotations

import time

import numpy as np

from audio_engine.detectors import DetectorConfig, DetectorUnavailable, PitchDetection

PARSELMOUTH_MISSING_MESSAGE = (
    "praat-parselmouth is not installed; install "
    "workers/audio-engine/requirements-lab.txt"
)


def detect_parselmouth(audio: object, config: DetectorConfig) -> PitchDetection:
    """Detect speech-like hum f0 frames with Praat through Parselmouth."""
    try:
        import parselmouth
    except Exception as exc:
        raise DetectorUnavailable(PARSELMOUTH_MISSING_MESSAGE) from exc

    started = time.perf_counter()
    y = np.asarray(audio, dtype=np.float64)
    sound = parselmouth.Sound(y, sampling_frequency=config.sample_rate)
    time_step = config.hop_length / config.sample_rate
    pitch = sound.to_pitch_ac(
        time_step=time_step,
        pitch_floor=config.fmin,
        pitch_ceiling=config.fmax,
    )
    f0 = np.asarray(pitch.selected_array["frequency"], dtype=np.float64)
    frame_count = len(f0)
    voiced = np.isfinite(f0) & (f0 > 0)
    confidence = np.where(voiced, 0.72, 0.0).astype(np.float64)
    timestamps = np.arange(frame_count, dtype=np.float32) * time_step

    return PitchDetection(
        provider="parselmouth",
        timestamps=timestamps,
        f0=f0,
        voiced=voiced,
        confidence=confidence,
        diagnostics={
            "pitchMs": round((time.perf_counter() - started) * 1000),
            "parselmouthFrames": frame_count,
            "parselmouthVoicedFrames": int(np.count_nonzero(voiced)),
        },
        warnings=["melo_lab_parselmouth_baseline"],
        sample_rate=config.sample_rate,
        hop_length=config.hop_length,
    )
