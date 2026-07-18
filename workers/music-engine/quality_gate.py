"""Cheap technical quality checks for generated PCM WAV clips.

This gate catches transport corruption, silence, severe clipping, DC-heavy
output, and mostly-empty clips. It deliberately does not pretend to judge
musical taste; dataset and human ratings own that higher bar.
"""

from __future__ import annotations

import io
import math
import struct
import wave

GATE_VERSION = "music-technical-v1"


def analyze_wav(blob: bytes, expected_duration: float) -> dict:
    failures: list[str] = []
    try:
        with wave.open(io.BytesIO(blob), "rb") as reader:
            channels = reader.getnchannels()
            sample_rate = reader.getframerate()
            sample_width = reader.getsampwidth()
            frame_count = reader.getnframes()
            frames = reader.readframes(frame_count)
    except (EOFError, wave.Error) as error:
        return _failed("invalid_wav", detail=str(error))

    duration = frame_count / sample_rate if sample_rate > 0 else 0.0
    if channels not in (1, 2):
        failures.append("unsupported_channels")
    if sample_width != 2:
        failures.append("unsupported_sample_width")
    if sample_rate < 16_000 or sample_rate > 96_000:
        failures.append("invalid_sample_rate")
    if abs(duration - expected_duration) > max(0.35, expected_duration * 0.08):
        failures.append("duration_mismatch")
    if not frames or sample_width != 2:
        failures.append("empty_audio")
        return _result(failures, duration, channels, sample_rate, frame_count)

    sample_count = len(frames) // 2
    values = struct.iter_unpack("<h", frames[: sample_count * 2])
    sum_squares = 0.0
    sum_values = 0.0
    peak = 0
    clipped = 0
    active = 0
    for (sample,) in values:
        absolute = abs(sample)
        peak = max(peak, absolute)
        sum_values += sample
        sum_squares += sample * sample
        clipped += int(absolute >= 32_440)
        active += int(absolute >= 164)  # roughly -46 dBFS

    rms = math.sqrt(sum_squares / sample_count) / 32768.0
    peak_ratio = peak / 32768.0
    clipping_ratio = clipped / sample_count
    active_ratio = active / sample_count
    dc_offset = abs(sum_values / sample_count) / 32768.0

    if rms < 0.003:
        failures.append("near_silence")
    if active_ratio < 0.12:
        failures.append("mostly_silent")
    if clipping_ratio > 0.02:
        failures.append("severe_clipping")
    if dc_offset > 0.08:
        failures.append("dc_offset")

    return _result(
        failures,
        duration,
        channels,
        sample_rate,
        frame_count,
        rms=round(rms, 6),
        peak=round(peak_ratio, 6),
        clipping_ratio=round(clipping_ratio, 6),
        active_ratio=round(active_ratio, 6),
        dc_offset=round(dc_offset, 6),
    )


def _failed(code: str, detail: str = "") -> dict:
    result = _result([code], 0.0, 0, 0, 0)
    if detail:
        result["detail"] = detail[:200]
    return result


def _result(failures, duration, channels, sample_rate, frame_count, **metrics) -> dict:
    return {
        "version": GATE_VERSION,
        "passed": not failures,
        "failures": failures,
        "metrics": {
            "duration_seconds": round(duration, 3),
            "channels": channels,
            "sample_rate": sample_rate,
            "frame_count": frame_count,
            **metrics,
        },
    }
