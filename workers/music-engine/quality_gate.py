"""Cheap technical quality checks for generated PCM WAV clips.

This gate catches transport corruption, silence, severe clipping, DC-heavy
output, and mostly-empty clips. It deliberately does not pretend to judge
musical taste; dataset and human ratings own that higher bar.
"""

from __future__ import annotations

import math
import struct

import numpy as np

GATE_VERSION = "music-technical-v2"

WINDOW_MILLISECONDS = 100
QUIET_WINDOW_DBFS = -42.0
MIN_RMS_DBFS = -34.0
MAX_CREST_FACTOR_DB = 26.0
MAX_QUIET_WINDOW_RATIO = 0.55
MAX_QUIET_RUN_RATIO = 0.35
MIN_LONG_QUIET_RUN_SECONDS = 1.0
MIN_DROPOUT_SECONDS = 0.4
DBFS_FLOOR = -120.0


def _parse_wav_header(blob: bytes) -> dict[str, int]:
    offset = 12
    header = {
        "audio_format": 0,
        "channels": 0,
        "sample_rate": 0,
        "byte_rate": 0,
        "block_align": 0,
        "bits_per_sample": 0,
        "data_offset": -1,
        "data_size": 0,
    }
    while offset + 8 <= len(blob):
        chunk_id = blob[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", blob, offset + 4)[0]
        body = offset + 8
        if body + chunk_size > len(blob):
            break
        if chunk_id == b"fmt " and chunk_size >= 16:
            (
                header["audio_format"],
                header["channels"],
                header["sample_rate"],
                header["byte_rate"],
                header["block_align"],
                header["bits_per_sample"],
            ) = struct.unpack_from("<HHIIHH", blob, body)
        elif chunk_id == b"data":
            header["data_offset"] = body
            header["data_size"] = chunk_size
            break
        offset = body + chunk_size + chunk_size % 2
    return header


def analyze_wav(blob: bytes, expected_duration: float) -> dict:
    failures: list[str] = []
    if len(blob) < 44 or blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        return _result(["invalid_wav"], {})

    header = _parse_wav_header(blob)
    audio_format = header["audio_format"]
    channels = header["channels"]
    sample_rate = header["sample_rate"]
    byte_rate = header["byte_rate"]
    block_align = header["block_align"]
    bits_per_sample = header["bits_per_sample"]
    data_offset = header["data_offset"]
    data_size = header["data_size"]

    if audio_format != 1 or bits_per_sample != 16 or channels not in (1, 2):
        failures.append("unsupported_pcm_format")
    declared_riff_bytes = struct.unpack_from("<I", blob, 4)[0] + 8
    data_end = data_offset + data_size if data_offset >= 0 else 0
    expected_block_align = channels * 2
    if (
        declared_riff_bytes > len(blob)
        or (data_end > 0 and declared_riff_bytes < data_end)
        or block_align != expected_block_align
        or byte_rate != sample_rate * expected_block_align
        or (block_align > 0 and data_size % block_align != 0)
    ):
        failures.append("invalid_wav_structure")
    if sample_rate < 16_000 or sample_rate > 96_000 or data_offset < 0 or data_size < 2:
        failures.append("invalid_audio_data")
        return _result(failures, {"channels": channels, "sample_rate": sample_rate})
    if failures:
        return _result(failures, {"channels": channels, "sample_rate": sample_rate})

    frames = blob[data_offset : data_offset + data_size]
    sample_count = data_size // 2
    frame_count = sample_count // channels
    duration = frame_count / sample_rate
    samples = np.frombuffer(frames, dtype="<i2")
    float_samples = samples.astype(np.float64)
    absolute_samples = np.abs(samples.astype(np.int32))
    sum_squares = float(np.sum(float_samples * float_samples, dtype=np.float64))
    sum_values = float(np.sum(float_samples, dtype=np.float64))
    peak = int(np.max(absolute_samples))
    clipped = int(np.count_nonzero(absolute_samples >= 32_440))
    active = int(np.count_nonzero(absolute_samples >= 164))  # roughly -46 dBFS

    rms = math.sqrt(sum_squares / sample_count) / 32768.0
    peak_ratio = peak / 32768.0
    clipping_ratio = clipped / sample_count
    active_ratio = active / sample_count
    dc_offset = abs(sum_values / sample_count) / 32768.0
    rms_dbfs = _dbfs(rms)
    peak_dbfs = _dbfs(peak_ratio)
    crest_factor_db = max(0.0, peak_dbfs - rms_dbfs) if peak else 0.0
    window_metrics = _analyze_windows(samples, channels, sample_rate)

    if abs(duration - expected_duration) > max(0.35, expected_duration * 0.08):
        failures.append("duration_mismatch")
    if rms < 0.003:
        failures.append("near_silence")
    if active_ratio < 0.12:
        failures.append("mostly_silent")
    if clipping_ratio > 0.02:
        failures.append("severe_clipping")
    if dc_offset > 0.08:
        failures.append("dc_offset")
    if rms_dbfs < MIN_RMS_DBFS:
        failures.append("low_average_level")
    if crest_factor_db > MAX_CREST_FACTOR_DB:
        failures.append("excessive_crest_factor")
    if window_metrics["quiet_window_ratio"] > MAX_QUIET_WINDOW_RATIO:
        failures.append("excessive_quiet_windows")
    if window_metrics["longest_quiet_run_seconds"] > max(
        MIN_LONG_QUIET_RUN_SECONDS,
        duration * MAX_QUIET_RUN_RATIO,
    ):
        failures.append("prolonged_silence")
    # Repeated quiet gaps remain shadow evidence: short rests and staccato can
    # look identical to dropouts without model-aware context.

    return _result(failures, {
        "duration_seconds": round(duration, 6),
        "channels": channels,
        "sample_rate": sample_rate,
        "frame_count": frame_count,
        "rms": round(rms, 6),
        "peak": round(peak_ratio, 6),
        "clipping_ratio": round(clipping_ratio, 6),
        "active_ratio": round(active_ratio, 6),
        "dc_offset": round(dc_offset, 6),
        "rms_dbfs": round(rms_dbfs, 3),
        "peak_dbfs": round(peak_dbfs, 3),
        "crest_factor_db": round(crest_factor_db, 3),
        **window_metrics,
    })


def _analyze_windows(samples: np.ndarray, channels: int, sample_rate: int) -> dict:
    window_frames = max(1, sample_rate * WINDOW_MILLISECONDS // 1000)
    window_samples = window_frames * channels
    starts = np.arange(0, samples.size, window_samples, dtype=np.int64)
    lengths = np.diff(np.append(starts, samples.size))
    float_samples = samples.astype(np.float64)
    squares = float_samples * float_samples
    sum_squares = np.add.reduceat(squares, starts)
    rms_values = np.sqrt(sum_squares / lengths) / 32768.0
    dbfs_values = np.full(rms_values.shape, DBFS_FLOOR, dtype=np.float64)
    active_windows = rms_values > 0
    dbfs_values[active_windows] = 20.0 * np.log10(rms_values[active_windows])
    quiet = dbfs_values <= QUIET_WINDOW_DBFS
    frame_lengths = lengths // channels

    quiet_windows = int(np.count_nonzero(quiet))
    longest_quiet_frames = 0
    interior_dropout_count = 0
    run_start = 0

    while run_start < quiet.size:
        if not quiet[run_start]:
            run_start += 1
            continue

        run_end = run_start
        run_frames = 0
        while run_end < quiet.size and quiet[run_end]:
            run_frames += int(frame_lengths[run_end])
            run_end += 1

        longest_quiet_frames = max(longest_quiet_frames, run_frames)
        bounded_by_audio = run_start > 0 and run_end < quiet.size
        if bounded_by_audio and run_frames / sample_rate >= MIN_DROPOUT_SECONDS:
            interior_dropout_count += 1
        run_start = run_end

    return {
        "quiet_window_ratio": round(quiet_windows / quiet.size, 6),
        "longest_quiet_run_seconds": round(longest_quiet_frames / sample_rate, 3),
        "interior_dropout_count": interior_dropout_count,
    }


def _dbfs(amplitude: float) -> float:
    return 20.0 * math.log10(amplitude) if amplitude > 0 else DBFS_FLOOR


def _result(failures: list[str], metrics: dict) -> dict:
    return {
        "version": GATE_VERSION,
        "passed": not failures,
        "failures": failures,
        "metrics": metrics,
    }
