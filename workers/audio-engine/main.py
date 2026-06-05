"""
Murmur Audio Engine.

Current detector: SwiftF0 with pYIN fallback. The worker also exposes an
optional DeepFilterNet denoise seam behind the stable v2 audio-engine contract,
so algorithm changes do not leak into the Next.js /api/transcribe route.
"""

from __future__ import annotations

import io
import logging
import math
import os
import tempfile
import time
from typing import Annotated

import librosa
import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from audio_engine.denoise import (
    DenoiseConfig,
    DenoiseUnavailable,
    configured_denoise_provider,
    denoise_audio,
)
from audio_engine.detectors import (
    DetectorConfig,
    DetectorUnavailable,
    configured_pitch_provider,
    detect_pitch,
)
from audio_engine.frames import pyin_to_notes

logger = logging.getLogger(__name__)

app = FastAPI(title="Murmur Audio Engine", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SR = 22050
FMIN = 75
FMAX = 1050
FRAME_LEN = 2048
HOP_LEN = 512
MIN_NOTE_DUR = 0.08
MIN_CONF = 0.4
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_AUDIO_SECONDS = 30
NOTE_HYPOTHESES = (
    {
        "id": "balanced",
        "min_note_duration": MIN_NOTE_DUR,
        "onset_confirm_frames": 2,
        "pitch_change_confirm_frames": 2,
    },
    {
        "id": "agile",
        "min_note_duration": 0.06,
        "onset_confirm_frames": 1,
        "pitch_change_confirm_frames": 2,
    },
    {
        "id": "steady",
        "min_note_duration": 0.1,
        "onset_confirm_frames": 2,
        "pitch_change_confirm_frames": 3,
    },
)
PYIN_RESCUE_HYPOTHESIS = {
    "id": "rescue",
    "min_note_duration": 0.08,
    "onset_confirm_frames": 1,
    "pitch_change_confirm_frames": 2,
    "min_confidence": 0.01,
}
REPAIR_NOTE_HYPOTHESES = (
    {
        "id": "repair_split",
        "min_note_duration": 0.05,
        "onset_confirm_frames": 1,
        "pitch_change_confirm_frames": 1,
    },
    {
        "id": "repair_guarded",
        "min_note_duration": 0.07,
        "onset_confirm_frames": 1,
        "pitch_change_confirm_frames": 1,
    },
)
PYIN_REPAIR_RESCUE_HYPOTHESIS = {
    "id": "repair_rescue_split",
    "min_note_duration": 0.05,
    "onset_confirm_frames": 1,
    "pitch_change_confirm_frames": 1,
    "min_confidence": 0.01,
}
PROPOSAL_NOTE_HYPOTHESES = {
    "glide": (
        {
            "id": "glide_guarded",
            "min_note_duration": 0.07,
            "onset_confirm_frames": 2,
            "pitch_change_confirm_frames": 3,
        },
    ),
    "wobble": (
        {
            "id": "wobble_guarded",
            "min_note_duration": 0.08,
            "onset_confirm_frames": 2,
            "pitch_change_confirm_frames": 4,
        },
    ),
    "urgent": (
        {
            "id": "urgent_attack",
            "min_note_duration": 0.045,
            "onset_confirm_frames": 1,
            "pitch_change_confirm_frames": 1,
        },
    ),
}


def require_worker_auth(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("AUDIO_WORKER_TOKEN", "").strip()
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


def decode_audio(data: bytes, filename: str) -> np.ndarray:
    """Decode webm/opus/mp4/wav/m4a to 22.05 kHz mono float32."""
    try:
        y, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)
        if sr != SR:
            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        return y.astype(np.float32)
    except Exception:
        pass

    try:
        from pydub import AudioSegment

        ext = os.path.splitext(filename)[-1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        try:
            segment = AudioSegment.from_file(tmp_path)
        finally:
            os.unlink(tmp_path)

        segment = segment.set_frame_rate(SR).set_channels(1).set_sample_width(2)
        samples = (
            np.frombuffer(segment.raw_data, dtype=np.int16).astype(np.float32)
            / 32768.0
        )
        return samples
    except Exception as exc:
        raise ValueError(f"Audio decode failed: {exc}") from exc


def trim_silence(y: np.ndarray) -> np.ndarray:
    """Trim head/tail silence defensively before pitch detection."""
    if y.size == 0:
        return y
    trimmed, _ = librosa.effects.trim(y, top_db=35)
    return trimmed.astype(np.float32)


def estimate_snr(y: np.ndarray) -> float | None:
    """Estimate SNR from frame RMS percentiles; good enough for diagnostics."""
    if y.size < HOP_LEN:
        return None
    rms = librosa.feature.rms(y=y, frame_length=FRAME_LEN, hop_length=HOP_LEN)[0]
    if rms.size == 0:
        return None
    signal = float(np.percentile(rms, 90))
    noise = max(float(np.percentile(rms, 10)), 1e-6)
    return round(20 * math.log10(max(signal, 1e-6) / noise), 2)


def estimate_rms_dbfs(y: np.ndarray) -> float | None:
    """Estimate overall RMS loudness in dBFS."""
    if y.size == 0:
        return None
    rms = float(np.sqrt(np.mean(np.square(y.astype(np.float64)))))
    if rms <= 1e-9:
        return None
    return round(20 * math.log10(rms), 2)


def estimate_peak_dbfs(y: np.ndarray) -> float | None:
    """Estimate true peak in dBFS."""
    if y.size == 0:
        return None
    peak = float(np.max(np.abs(y)))
    if peak <= 1e-9:
        return None
    return round(20 * math.log10(peak), 2)


def estimate_clipping_ratio(y: np.ndarray) -> float:
    """Estimate how much of the signal is close to full-scale clipping."""
    if y.size == 0:
        return 0.0
    clipped = np.count_nonzero(np.abs(y) >= 0.985)
    return round(float(clipped / y.size), 4)


def build_contour_payload(
    *,
    timestamps: object,
    f0: object,
    confidence: object,
    voiced: object,
    sample_rate: int,
    hop_length: int,
) -> dict[str, object]:
    """Normalize detector frames into a JSON-safe contour payload."""
    timestamp_array = np.asarray(timestamps, dtype=np.float64)
    f0_array = np.asarray(f0, dtype=np.float64)
    confidence_array = np.asarray(confidence, dtype=np.float64)
    voiced_array = np.asarray(voiced, dtype=bool)

    frame_count = min(
        len(timestamp_array),
        len(f0_array),
        len(confidence_array),
        len(voiced_array),
    )

    if frame_count <= 0:
        return {
            "timestamps": [],
            "pitchHz": [],
            "confidence": [],
            "voiced": [],
            "hopSeconds": round(hop_length / sample_rate, 6),
        }

    def to_safe_pitch(value: float, is_voiced: bool) -> float | None:
        if not is_voiced or not np.isfinite(value) or value <= 0:
            return None
        return round(float(value), 3)

    return {
        "timestamps": [round(float(ts), 4) for ts in timestamp_array[:frame_count]],
        "pitchHz": [
            to_safe_pitch(float(value), bool(is_voiced))
            for value, is_voiced in zip(f0_array[:frame_count], voiced_array[:frame_count])
        ],
        "confidence": [
            round(float(np.clip(value, 0.0, 1.0)), 4)
            if np.isfinite(value)
            else 0.0
            for value in confidence_array[:frame_count]
        ],
        "voiced": [bool(value) for value in voiced_array[:frame_count]],
        "hopSeconds": round(hop_length / sample_rate, 6),
    }


def collect_input_quality_warnings(
    *,
    rms_dbfs: float | None,
    peak_dbfs: float | None,
    clipping_ratio: float,
    snr: float | None,
) -> list[str]:
    warnings: list[str] = []
    if rms_dbfs is not None and rms_dbfs < -32:
        warnings.append("input_too_quiet")
    if peak_dbfs is not None and peak_dbfs > -1.2:
        warnings.append("input_hot")
    if clipping_ratio >= 0.003:
        warnings.append("input_clipping")
    if snr is not None and snr < 8:
        warnings.append("input_noisy")
    return warnings


def rebuild_note_starts(
    notes: list[dict[str, float | int]],
    durations: np.ndarray,
) -> list[dict[str, float | int]]:
    if not notes:
        return notes
    rebuilt: list[dict[str, float | int]] = []
    cursor = float(notes[0]["start"])
    for note, duration in zip(notes, durations):
        next_note = dict(note)
        next_note["start"] = round(cursor, 3)
        next_note["duration"] = round(float(duration), 3)
        rebuilt.append(next_note)
        cursor += float(duration)
    return rebuilt


def merge_note_group(notes: list[dict[str, float | int]]) -> dict[str, float | int]:
    total_duration = sum(float(note["duration"]) for note in notes)
    if total_duration <= 1e-6:
        total_duration = 1e-6
    weighted_confidence = sum(
        float(note["confidence"]) * float(note["duration"])
        for note in notes
    ) / total_duration
    return {
        "pitch": int(round(sum(int(note["pitch"]) for note in notes) / len(notes))),
        "start": round(float(notes[0]["start"]), 3),
        "duration": round(total_duration, 3),
        "velocity": round(min(1.0, weighted_confidence) * 0.85, 3),
        "confidence": round(weighted_confidence, 3),
    }


def collapse_adjacent_same_pitch(notes: list[dict[str, float | int]]) -> list[dict[str, float | int]]:
    if len(notes) < 2:
        return notes
    collapsed: list[dict[str, float | int]] = []
    for note in notes:
        if not collapsed or int(collapsed[-1]["pitch"]) != int(note["pitch"]):
            collapsed.append(dict(note))
            continue
        previous = collapsed.pop()
        previous_end = float(previous["start"]) + float(previous["duration"])
        gap = max(0.0, float(note["start"]) - previous_end)
        compact_gap = gap <= 0.14
        compact_pair = max(float(previous["duration"]), float(note["duration"])) <= 0.36
        if compact_gap and compact_pair:
            collapsed.append(merge_note_group([previous, note]))
            continue
        collapsed.extend([previous, dict(note)])
    return collapsed


def collapse_short_wobble_detours(notes: list[dict[str, float | int]]) -> list[dict[str, float | int]]:
    if len(notes) < 3:
        return notes

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    median_duration = float(np.median(durations)) if durations.size else 0.0
    if median_duration <= 1e-6:
        return notes

    max_detour_duration = max(0.16, median_duration * 0.62)
    collapsed: list[dict[str, float | int]] = []
    index = 0
    while index < len(notes):
        if index <= len(notes) - 3:
            left = notes[index]
            middle = notes[index + 1]
            right = notes[index + 2]
            same_anchor = int(left["pitch"]) == int(right["pitch"])
            nearby_detour = abs(int(middle["pitch"]) - int(left["pitch"])) <= 1
            short_detour = float(middle["duration"]) <= max_detour_duration
            weaker_detour = float(middle["confidence"]) <= max(
                float(left["confidence"]),
                float(right["confidence"]),
            ) - 0.04
            if same_anchor and nearby_detour and short_detour and weaker_detour:
                collapsed.append(merge_note_group([left, middle, right]))
                index += 3
                continue
        collapsed.append(dict(notes[index]))
        index += 1

    return collapse_adjacent_same_pitch(collapsed)


def redistribute_interior_holds(notes: list[dict[str, float | int]]) -> list[dict[str, float | int]]:
    if len(notes) < 4:
        return notes

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    median_duration = float(np.median(durations)) if durations.size else 0.0
    if median_duration <= 1e-6:
        return notes

    hold_threshold = max(median_duration * 1.55, 0.52)
    target_cap = max(median_duration * 1.32, 0.44)
    overheld_indices = [
        index
        for index in range(1, len(notes) - 1)
        if durations[index] > hold_threshold
    ]
    if not overheld_indices:
        return notes

    adjusted = durations.copy()
    excess = 0.0
    for index in overheld_indices:
        capped = min(adjusted[index], target_cap)
        excess += max(0.0, adjusted[index] - capped)
        adjusted[index] = capped

    if excess <= 1e-6:
        return notes

    receiver_indices = [index for index in range(len(notes)) if index not in overheld_indices]
    receiver_target = max(median_duration * 1.08, 0.36)
    receiver_capacity = np.asarray(
        [max(0.0, receiver_target - adjusted[index]) for index in receiver_indices],
        dtype=np.float64,
    )

    total_capacity = float(np.sum(receiver_capacity))
    if total_capacity > 1e-6:
        allocation = min(excess, total_capacity)
        for offset, index in enumerate(receiver_indices):
            share = allocation * float(receiver_capacity[offset] / total_capacity)
            adjusted[index] += share
        excess -= allocation

    if excess > 1e-6 and receiver_indices:
        even_share = excess / len(receiver_indices)
        for index in receiver_indices:
            adjusted[index] += even_share

    return rebuild_note_starts(notes, adjusted)


def regularize_urgent_phrase(notes: list[dict[str, float | int]]) -> list[dict[str, float | int]]:
    if len(notes) < 4:
        return notes

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    total_duration = float(np.sum(durations))
    median_duration = float(np.median(durations)) if durations.size else 0.0
    if median_duration <= 1e-6 or total_duration > 1.3 or median_duration > 0.22:
        return notes

    short_ratio = float(np.mean(durations <= max(0.16, median_duration * 0.62)))
    if short_ratio < 0.35:
        return notes

    target_floor = max(0.148, median_duration * 0.9)
    adjusted = durations.copy()
    deficit = 0.0
    for index, value in enumerate(adjusted):
        if value >= target_floor:
            continue
        needed = target_floor - value
        adjusted[index] += needed
        deficit += needed

    if deficit <= 1e-6:
        return notes

    donor_threshold = max(target_floor * 1.02, median_duration * 0.92)
    donor_indices = [index for index, value in enumerate(adjusted) if value > donor_threshold]
    donor_capacity = np.asarray(
        [max(0.0, adjusted[index] - donor_threshold) for index in donor_indices],
        dtype=np.float64,
    )
    total_capacity = float(np.sum(donor_capacity))
    if total_capacity + 1e-6 < deficit:
        return notes

    for offset, index in enumerate(donor_indices):
        share = deficit * float(donor_capacity[offset] / total_capacity)
        adjusted[index] -= share

    return rebuild_note_starts(notes, adjusted)


def refine_candidate_notes(
    notes: list[dict[str, float | int]],
    *,
    hypothesis_id: str,
    proposal_profile: str,
) -> list[dict[str, float | int]]:
    refined = collapse_adjacent_same_pitch([dict(note) for note in notes])
    if hypothesis_id.startswith("repair"):
        refined = redistribute_interior_holds(refined)
    if proposal_profile == "wobble" or "wobble" in hypothesis_id:
        refined = collapse_short_wobble_detours(refined)
    if proposal_profile == "urgent" or hypothesis_id.startswith("urgent"):
        refined = regularize_urgent_phrase(refined)
    return refined


def transpose_note_sequence(
    notes: list[dict[str, float | int]],
    semitones: int,
) -> list[dict[str, float | int]]:
    transposed: list[dict[str, float | int]] = []
    for note in notes:
        shifted_pitch = int(note["pitch"]) + semitones
        if shifted_pitch < 0 or shifted_pitch > 127:
            return []
        next_note = dict(note)
        next_note["pitch"] = shifted_pitch
        transposed.append(next_note)
    return transposed


def build_octave_shift_candidates(
    detection,
    hypothesis_id: str,
    notes: list[dict[str, float | int]],
) -> list[tuple[str, list[dict[str, float | int]], float]]:
    if not notes or "octave_" in hypothesis_id:
        return []

    pitches = np.asarray([int(note["pitch"]) for note in notes], dtype=np.int32)
    confidences = np.asarray([float(note["confidence"]) for note in notes], dtype=np.float64)
    voiced = np.asarray(detection.voiced, dtype=bool)
    contour_confidence = np.asarray(detection.confidence, dtype=np.float64)
    voiced_confidence = (
        float(np.mean(contour_confidence[voiced])) if np.count_nonzero(voiced) > 0 else 0.0
    )
    median_pitch = float(np.median(pitches))
    min_pitch = int(np.min(pitches))
    max_pitch = int(np.max(pitches))
    span = max_pitch - min_pitch
    mean_note_confidence = float(np.mean(confidences)) if confidences.size else 0.0

    candidates: list[tuple[str, list[dict[str, float | int]], float]] = []
    if (
        len(notes) >= 8
        and median_pitch <= 58
        and max_pitch <= 67
        and min_pitch <= 54
        and span >= 7
        and mean_note_confidence >= 0.72
        and voiced_confidence >= 0.72
    ):
        octave_up = transpose_note_sequence(notes, 12)
        if octave_up:
            candidates.append((f"{hypothesis_id}_octave_up", octave_up, 0.24))

    if (
        len(notes) >= 8
        and median_pitch >= 78
        and min_pitch >= 66
        and span >= 7
        and mean_note_confidence >= 0.72
        and voiced_confidence >= 0.72
    ):
        octave_down = transpose_note_sequence(notes, -12)
        if octave_down:
            candidates.append((f"{hypothesis_id}_octave_down", octave_down, 0.18))

    return candidates


def calculate_urgent_coherence(durations: np.ndarray, rushed_ratio: float, onset_fragmentation: float) -> float:
    if durations.size < 4 or rushed_ratio < 0.2 or onset_fragmentation > 0.18:
        return 0.0
    mean_duration = float(np.mean(durations))
    if mean_duration <= 1e-6:
        return 0.0
    variation = float(np.std(durations) / mean_duration)
    coherence = max(0.0, 1.0 - variation / 0.34)
    return round(coherence * min(1.0, rushed_ratio / 0.7), 3)


def score_note_acceptance(detection, notes: list[dict[str, float | int]]) -> dict[str, float | int | str]:
    if not notes:
        return {
            "score": 0.0,
            "musicFeelScore": 0.0,
            "rushedRatio": 1.0,
            "ambiguousMidRatio": 0.0,
            "cadenceRatio": 0.0,
            "excessiveHoldRatio": 0.0,
            "interiorHoldRatio": 0.0,
            "onsetFragmentation": 1.0,
            "coverage": 0.0,
            "voicedConfidence": 0.0,
            "noteDensity": 0.0,
            "firstOnsetLag": 1.0,
            "lateStartPenalty": 1.0,
        }

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    confidences = np.asarray([float(note["confidence"]) for note in notes], dtype=np.float64)
    median_duration = float(np.median(durations)) if durations.size else 0.0
    if median_duration <= 1e-6:
        median_duration = 1e-6

    rushed_ratio = float(np.mean(durations <= max(0.16, median_duration * 0.52)))
    ambiguous_mid_ratio = float(
        np.mean((durations >= median_duration * 0.72) & (durations <= median_duration * 1.28))
    )
    cadence_ratio = float(durations[-1] / median_duration)
    excessive_hold_ratio = float(np.mean(durations >= max(median_duration * 1.9, 0.82)))
    if durations.size > 2:
        interior_hold_ratio = float(
            np.mean(durations[1:-1] >= max(median_duration * 1.65, 0.56))
        )
    else:
        interior_hold_ratio = 0.0
    onset_fragmentation = (
        float(np.mean(np.abs(np.diff(durations)) >= max(0.22, median_duration * 0.8)))
        if durations.size > 1
        else 0.0
    )
    urgent_coherence = calculate_urgent_coherence(durations, rushed_ratio, onset_fragmentation)
    effective_rushed_ratio = max(0.0, rushed_ratio - urgent_coherence * 0.72)

    voiced = np.asarray(detection.voiced, dtype=bool)
    confidence = np.asarray(detection.confidence, dtype=np.float64)
    voiced_confidence = (
        float(np.mean(confidence[voiced])) if np.count_nonzero(voiced) > 0 else 0.0
    )
    contour_duration = max(len(voiced) * detection.hop_length / detection.sample_rate, 1e-6)
    coverage = min(1.0, sum(float(note["duration"]) for note in notes) / contour_duration)
    note_density = len(notes) / contour_duration

    voiced_indices = np.flatnonzero(voiced)
    first_voiced_time = (
        float(voiced_indices[0] * detection.hop_length / detection.sample_rate)
        if voiced_indices.size > 0
        else 0.0
    )
    first_onset_lag = max(0.0, float(notes[0]["start"]) - first_voiced_time)
    late_start_penalty = min(1.0, first_onset_lag / 0.22)

    music_feel = (
        0.34 * max(0.0, 1.0 - effective_rushed_ratio)
        + 0.22 * max(0.0, 1.0 - max(0.0, ambiguous_mid_ratio - 0.55))
        + 0.24 * min(1.0, cadence_ratio / 1.6)
        + 0.20 * float(np.mean(confidences))
        + 0.2 * urgent_coherence
        - 0.08 * excessive_hold_ratio
        - 0.16 * interior_hold_ratio
        - 0.1 * onset_fragmentation
    )

    score = (
        music_feel * 0.42
        + coverage * 0.18
        + voiced_confidence * 0.18
        + min(1.0, len(notes) / 6) * 0.12
        + max(0.0, 1.0 - late_start_penalty) * 0.1
        - interior_hold_ratio * 0.08
    )
    return {
        "score": round(score, 3),
        "musicFeelScore": round(music_feel, 3),
        "rushedRatio": round(rushed_ratio, 3),
        "ambiguousMidRatio": round(ambiguous_mid_ratio, 3),
        "cadenceRatio": round(cadence_ratio, 3),
        "excessiveHoldRatio": round(excessive_hold_ratio, 3),
        "interiorHoldRatio": round(interior_hold_ratio, 3),
        "onsetFragmentation": round(onset_fragmentation, 3),
        "coverage": round(coverage, 3),
        "voicedConfidence": round(voiced_confidence, 3),
        "noteDensity": round(note_density, 3),
        "firstOnsetLag": round(first_onset_lag, 3),
        "lateStartPenalty": round(late_start_penalty, 3),
        "urgentCoherence": round(urgent_coherence, 3),
    }


def summarize_contour_motion(detection) -> dict[str, float | str]:
    voiced = np.asarray(detection.voiced, dtype=bool)
    confidence = np.asarray(detection.confidence, dtype=np.float64)
    f0 = np.asarray(detection.f0, dtype=np.float64)
    valid_indices = [
        index
        for index, is_voiced in enumerate(voiced)
        if is_voiced
        and index < len(confidence)
        and confidence[index] >= 0.45
        and index < len(f0)
        and np.isfinite(f0[index])
        and f0[index] > 0
    ]
    if len(valid_indices) < 3:
        return {
            "profile": "balanced",
            "glideRatio": 0.0,
            "wobbleRatio": 0.0,
            "urgentRatio": 0.0,
        }

    signed_deltas: list[float] = []
    for prev_index, index in zip(valid_indices[:-1], valid_indices[1:]):
        if index - prev_index != 1:
            continue
        prev_pitch = float(f0[prev_index])
        pitch = float(f0[index])
        signed_deltas.append(12 * math.log2(pitch / prev_pitch))

    if not signed_deltas:
        return {
            "profile": "balanced",
            "glideRatio": 0.0,
            "wobbleRatio": 0.0,
            "urgentRatio": 0.0,
        }

    glide_frames = 0
    wobble_frames = 0
    urgent_frames = 0

    for index, delta in enumerate(signed_deltas):
        abs_delta = abs(delta)
        if 0.28 <= abs_delta <= 1.6:
            urgent_frames += 1
        if index == 0:
            continue
        prev_delta = signed_deltas[index - 1]
        prev_abs = abs(prev_delta)
        same_direction = delta * prev_delta > 0
        sign_flip = delta * prev_delta < 0
        if same_direction and 0.18 <= abs_delta <= 1.1 and 0.18 <= prev_abs <= 1.1:
            glide_frames += 1
        if sign_flip and 0.12 <= abs_delta <= 0.75 and 0.12 <= prev_abs <= 0.75:
            wobble_frames += 1

    pair_count = max(1, len(signed_deltas))
    glide_ratio = glide_frames / pair_count
    wobble_ratio = wobble_frames / pair_count
    urgent_ratio = urgent_frames / pair_count

    if glide_ratio >= 0.22 and glide_ratio >= wobble_ratio:
        profile = "glide"
    elif wobble_ratio >= 0.18:
        profile = "wobble"
    elif urgent_ratio >= 0.42:
        profile = "urgent"
    else:
        profile = "balanced"

    return {
        "profile": profile,
        "glideRatio": round(glide_ratio, 3),
        "wobbleRatio": round(wobble_ratio, 3),
        "urgentRatio": round(urgent_ratio, 3),
    }


def build_proposal_hypotheses(detection) -> tuple[
    dict[str, float | str],
    list[dict[str, float | int]],
]:
    motion = summarize_contour_motion(detection)
    profile = str(motion["profile"])
    hypotheses: list[dict[str, float | int]] = []
    if profile in PROPOSAL_NOTE_HYPOTHESES:
        hypotheses.extend(PROPOSAL_NOTE_HYPOTHESES[profile])
    return motion, hypotheses


def score_proposal_fit(
    proposal_profile: str,
    hypothesis_id: str,
    notes: list[dict[str, float | int]],
    acceptance: dict[str, float | int | str],
) -> float:
    if proposal_profile == "balanced" or not notes:
        return 0.0

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    if durations.size == 0:
        return 0.0

    median_duration = max(1e-6, float(np.median(durations)))
    short_ratio = float(np.mean(durations <= max(0.16, median_duration * 0.52)))
    interior_hold = float(acceptance.get("interiorHoldRatio", 0.0))
    fragmentation = float(acceptance["onsetFragmentation"])

    if proposal_profile == "glide":
        fit = (
            (0.16 if "glide" in hypothesis_id else 0.0)
            + max(0.0, 0.14 - fragmentation * 0.18)
            + max(0.0, 0.12 - short_ratio * 0.12)
        )
    elif proposal_profile == "wobble":
        fit = (
            (0.16 if "wobble" in hypothesis_id else 0.0)
            + max(0.0, 0.12 - fragmentation * 0.14)
            + max(0.0, 0.1 - interior_hold * 0.08)
        )
    else:
        fit = (
            (0.14 if "urgent" in hypothesis_id else 0.0)
            + min(0.12, short_ratio * 0.14)
            + max(0.0, 0.08 - float(acceptance["firstOnsetLag"]) * 0.6)
        )

    return round(fit, 3)


def build_note_hypotheses(
    detection,
    extra_hypotheses: tuple[dict[str, float | int], ...] | list[dict[str, float | int]] = (),
    *,
    include_base_hypotheses: bool = True,
    allowed_hypothesis_ids: set[str] | None = None,
) -> list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]]:
    candidates: list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]] = []
    hypotheses = list(NOTE_HYPOTHESES) if include_base_hypotheses else []
    if include_base_hypotheses and detection.provider == "pyin":
        hypotheses.append(PYIN_RESCUE_HYPOTHESIS)
    if extra_hypotheses:
        hypotheses.extend(extra_hypotheses)
    proposal_motion = summarize_contour_motion(detection)
    proposal_profile = str(proposal_motion["profile"])

    seen_ids: set[str] = set()

    for hypothesis in hypotheses:
        hypothesis_id = str(hypothesis["id"])
        if allowed_hypothesis_ids is not None and hypothesis_id not in allowed_hypothesis_ids:
            continue
        if hypothesis_id in seen_ids:
            continue
        seen_ids.add(hypothesis_id)
        notes = pyin_to_notes(
            detection.f0,
            detection.voiced,
            detection.confidence,
            hop_length=detection.hop_length,
            sample_rate=detection.sample_rate,
            min_confidence=float(hypothesis.get("min_confidence", MIN_CONF)),
            min_note_duration=float(hypothesis["min_note_duration"]),
            onset_confirm_frames=int(hypothesis["onset_confirm_frames"]),
            pitch_change_confirm_frames=int(hypothesis["pitch_change_confirm_frames"]),
        )
        notes = refine_candidate_notes(
            notes,
            hypothesis_id=hypothesis_id,
            proposal_profile=proposal_profile,
        )
        acceptance = score_note_acceptance(detection, notes)
        detection_score = score_detection_candidate(detection, notes)
        proposal_fit = score_proposal_fit(proposal_profile, hypothesis_id, notes, acceptance)
        total_score = detection_score * 0.55 + float(acceptance["score"]) * 2.4 + proposal_fit
        candidates.append((hypothesis_id, notes, acceptance, round(total_score, 3)))

        # Octave-normalized variants are valuable for the primary hypotheses,
        # but repeating that expansion on repair-only hypotheses mostly burns
        # CPU on alternate candidates we do not select in practice.
        if hypothesis_id.startswith("repair"):
            continue

        for octave_id, octave_notes, register_bonus in build_octave_shift_candidates(
            detection,
            hypothesis_id,
            notes,
        ):
            octave_acceptance = score_note_acceptance(detection, octave_notes)
            octave_detection_score = score_detection_candidate(detection, octave_notes)
            octave_proposal_fit = score_proposal_fit(
                proposal_profile,
                octave_id,
                octave_notes,
                octave_acceptance,
            )
            octave_total = (
                octave_detection_score * 0.55
                + float(octave_acceptance["score"]) * 2.4
                + octave_proposal_fit
                + register_bonus
            )
            candidates.append((octave_id, octave_notes, octave_acceptance, round(octave_total, 3)))

    candidates.sort(key=lambda item: item[3], reverse=True)
    return candidates


def should_trigger_acceptance_repair(
    notes: list[dict[str, float | int]],
    acceptance: dict[str, float | int | str],
) -> tuple[bool, str]:
    if not notes:
        return True, "empty_notes"

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    median_duration = float(np.median(durations)) if durations.size else 0.0
    if median_duration <= 1e-6:
        median_duration = 1e-6

    if len(notes) > 2:
        interior_threshold = max(median_duration * 1.65, 0.56)
        interior_hold_ratio = float(
            np.mean(
                np.asarray([float(note["duration"]) for note in notes[1:-1]], dtype=np.float64)
                >= interior_threshold
            )
        )
    else:
        interior_hold_ratio = 0.0

    acceptance_score = float(acceptance["score"])
    music_feel = float(acceptance["musicFeelScore"])
    onset_fragmentation = float(acceptance["onsetFragmentation"])
    first_onset_lag = float(acceptance["firstOnsetLag"])
    rushed_ratio = float(acceptance.get("rushedRatio", 0.0))
    note_density = float(acceptance.get("noteDensity", 0.0))
    urgent_coherence = float(acceptance.get("urgentCoherence", 0.0))

    if acceptance_score < 0.62:
        return True, "acceptance_low"
    if (
        len(notes) >= 4
        and rushed_ratio >= 0.35
        and note_density >= 3.2
        and music_feel < 0.78
        and onset_fragmentation <= 0.12
        and first_onset_lag < 0.08
        and urgent_coherence < 0.3
    ):
        return True, "urgent_coherence"
    if music_feel < 0.68 and onset_fragmentation >= 0.24:
        return True, "fragmented_feel"
    if interior_hold_ratio >= 0.18:
        return True, "interior_hold"
    if first_onset_lag >= 0.1:
        return True, "late_onset"
    return False, "stable"


def collect_note_candidates(
    detection,
    *,
    allow_repair_rerun: bool = True,
    allowed_base_hypothesis_ids: set[str] | None = None,
) -> tuple[
    list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]],
    str | None,
]:
    proposal_motion, proposal_hypotheses = build_proposal_hypotheses(detection)
    detection.diagnostics["noteProposalProfile"] = proposal_motion["profile"]
    detection.diagnostics["proposalGlideRatio"] = proposal_motion["glideRatio"]
    detection.diagnostics["proposalWobbleRatio"] = proposal_motion["wobbleRatio"]
    detection.diagnostics["proposalUrgentRatio"] = proposal_motion["urgentRatio"]
    if proposal_hypotheses:
        detection.diagnostics["noteProposalCandidates"] = ",".join(
            str(hypothesis["id"]) for hypothesis in proposal_hypotheses
        )

    base_candidates = build_note_hypotheses(
        detection,
        extra_hypotheses=proposal_hypotheses,
        allowed_hypothesis_ids=allowed_base_hypothesis_ids,
    )
    if not base_candidates:
        return [], None
    base_candidates = rerank_detail_preserving_candidates(
        detection,
        base_candidates,
        proposal_profile=proposal_motion["profile"],
    )

    repair_triggered, repair_reason = should_trigger_acceptance_repair(
        base_candidates[0][1],
        base_candidates[0][2],
    )
    if not repair_triggered:
        return base_candidates, None
    if not allow_repair_rerun:
        return base_candidates, repair_reason

    repair_hypotheses = list(REPAIR_NOTE_HYPOTHESES)
    if detection.provider == "pyin":
        repair_hypotheses.append(PYIN_REPAIR_RESCUE_HYPOTHESIS)
    if repair_reason == "urgent_coherence":
        repair_hypotheses = [*PROPOSAL_NOTE_HYPOTHESES["urgent"], *repair_hypotheses]
    repair_candidates = build_note_hypotheses(
        detection,
        extra_hypotheses=repair_hypotheses,
        include_base_hypotheses=False,
        allowed_hypothesis_ids=None,
    )
    merged_candidates = sorted(
        [*base_candidates, *repair_candidates],
        key=lambda item: item[3],
        reverse=True,
    )
    merged_candidates = rerank_detail_preserving_candidates(
        detection,
        merged_candidates,
        proposal_profile=proposal_motion["profile"],
    )
    return merged_candidates, repair_reason


def rerank_detail_preserving_candidates(
    detection,
    candidates: list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]],
    *,
    proposal_profile: str,
) -> list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]]:
    if len(candidates) < 2:
        return candidates

    top_id, top_notes, top_acceptance, top_score = candidates[0]
    top_root = str(top_id).replace("_octave_up", "").replace("_octave_down", "")
    if top_root != "steady":
        return candidates

    top_count = len(top_notes)
    if top_count <= 0:
        return candidates

    top_fragmentation = float(top_acceptance.get("onsetFragmentation", 0.0))
    top_first_onset = float(top_acceptance.get("firstOnsetLag", 0.0))
    top_acceptance_score = float(top_acceptance.get("score", 0.0))
    top_music_feel = float(top_acceptance.get("musicFeelScore", 0.0))
    proposal_glide = float(detection.diagnostics.get("proposalGlideRatio", 0.0))
    proposal_urgent = float(detection.diagnostics.get("proposalUrgentRatio", 0.0))

    if proposal_profile == "glide":
        profile_allows_rerank = proposal_glide >= 0.22 or top_first_onset >= 0.14
    elif proposal_profile == "balanced":
        profile_allows_rerank = (
            top_fragmentation >= 0.3
            and (proposal_glide >= 0.1 or proposal_urgent >= 0.1)
        )
    else:
        profile_allows_rerank = False

    if not profile_allows_rerank:
        return candidates

    preferred_roots = (
        {"glide_guarded", "balanced", "agile"}
        if proposal_profile == "glide"
        else {"balanced", "glide_guarded", "agile"}
    )

    replacement_index: int | None = None
    replacement_candidate: tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float] | None = None

    for index, candidate in enumerate(candidates[1:], start=1):
        candidate_id, candidate_notes, candidate_acceptance, candidate_score = candidate
        candidate_root = str(candidate_id).replace("_octave_up", "").replace("_octave_down", "")
        if candidate_root not in preferred_roots:
            continue

        candidate_count = len(candidate_notes)
        if candidate_count < max(top_count + 6, int(math.ceil(top_count * 1.18))):
            continue

        candidate_acceptance_score = float(candidate_acceptance.get("score", 0.0))
        candidate_music_feel = float(candidate_acceptance.get("musicFeelScore", 0.0))
        score_gap = float(top_score) - float(candidate_score)
        if score_gap > 0.38:
            continue
        if candidate_acceptance_score < top_acceptance_score - 0.04:
            continue
        if candidate_music_feel < top_music_feel - 0.08:
            continue

        replacement_index = index
        replacement_candidate = candidate
        break

    if replacement_index is None or replacement_candidate is None:
        return candidates

    promoted_candidate = (
        replacement_candidate[0],
        replacement_candidate[1],
        replacement_candidate[2],
        round(max(float(replacement_candidate[3]), float(top_score) + 0.001), 3),
    )
    demoted_top = (
        candidates[0][0],
        candidates[0][1],
        candidates[0][2],
        round(float(top_score), 3),
    )
    reordered = [promoted_candidate, demoted_top, *candidates[1:replacement_index], *candidates[replacement_index + 1 :]]
    detection.diagnostics["detailPreservingRerank"] = (
        f"{top_id}->{replacement_candidate[0]}:{proposal_profile}"
    )
    return reordered


def apply_candidate_selection_diagnostics(
    detection,
    selected_hypothesis: str,
    note_candidates: list[tuple[str, list[dict[str, float | int]], dict[str, float | int | str], float]],
    acceptance: dict[str, float | int | str],
    *,
    repair_reason: str | None = None,
):
    detection.diagnostics["noteHypothesis"] = selected_hypothesis
    detection.diagnostics["acceptanceScore"] = acceptance["score"]
    detection.diagnostics["musicFeelScore"] = acceptance["musicFeelScore"]
    detection.diagnostics["rushedRatio"] = acceptance.get("rushedRatio", 0.0)
    detection.diagnostics["ambiguousMidRatio"] = acceptance.get("ambiguousMidRatio", 0.0)
    detection.diagnostics["cadenceRatio"] = acceptance.get("cadenceRatio", 0.0)
    detection.diagnostics["excessiveHoldRatio"] = acceptance["excessiveHoldRatio"]
    detection.diagnostics["interiorHoldRatio"] = acceptance.get("interiorHoldRatio", 0.0)
    detection.diagnostics["onsetFragmentation"] = acceptance["onsetFragmentation"]
    detection.diagnostics["noteDensity"] = acceptance.get("noteDensity", 0.0)
    detection.diagnostics["firstOnsetLag"] = acceptance["firstOnsetLag"]
    detection.diagnostics["urgentCoherence"] = acceptance.get("urgentCoherence", 0.0)
    detection.diagnostics["hypothesisCandidates"] = ",".join(
        f"{candidate_id}:{candidate_score:.3f}"
        for candidate_id, _notes, _acceptance, candidate_score in note_candidates
    )
    detection.diagnostics["repairTriggered"] = repair_reason is not None
    if repair_reason is not None:
        detection.diagnostics["repairTriggerReason"] = repair_reason
        detection.diagnostics["repairCandidates"] = ",".join(
            candidate_id
            for candidate_id, _notes, _acceptance, _score in note_candidates
            if candidate_id.startswith("repair")
        )
        detection.warnings.insert(0, f"repair_rerun:{repair_reason}")
    if selected_hypothesis != "balanced":
        detection.warnings.insert(0, f"note_hypothesis:{selected_hypothesis}")
    if float(acceptance["score"]) < 0.58:
        detection.warnings.insert(0, f"acceptance_low:{acceptance['score']}")


def choose_ensemble_candidate(
    candidates: list[tuple[object, str, list[dict[str, float | int]], dict[str, float | int | str], float]],
) -> tuple[
    tuple[object, str, list[dict[str, float | int]], dict[str, float | int | str], float],
    list[tuple[object, str, list[dict[str, float | int]], dict[str, float | int | str], float]],
    str,
]:
    ranked = sorted(candidates, key=lambda item: item[4], reverse=True)
    best = ranked[0]
    best_swift = next((item for item in ranked if item[0].provider == "swiftf0"), None)
    best_pyin = next((item for item in ranked if item[0].provider == "pyin"), None)

    if not best_swift or not best_pyin:
        return best, ranked, "highest_score"

    if best[0].provider == "pyin":
        swift_acceptance = float(best_swift[3]["score"])
        pyin_acceptance = float(best_pyin[3]["score"])
        swift_first_onset = float(best_swift[3]["firstOnsetLag"])
        pyin_first_onset = float(best_pyin[3]["firstOnsetLag"])
        swift_music_feel = float(best_swift[3]["musicFeelScore"])
        pyin_music_feel = float(best_pyin[3]["musicFeelScore"])
        pyin_interior_hold = float(best_pyin[3].get("interiorHoldRatio", 0.0))
        pyin_fragmentation = float(best_pyin[3]["onsetFragmentation"])
        swift_note_count = len(best_swift[2])
        pyin_note_count = len(best_pyin[2])
        score_gap = best_pyin[4] - best_swift[4]

        if (
            score_gap <= 0.35
            and swift_note_count >= pyin_note_count
            and swift_acceptance >= pyin_acceptance - 0.05
            and swift_first_onset <= pyin_first_onset + 0.08
        ):
            return best_swift, ranked, "fidelity_tiebreak"

        if (
            score_gap <= 0.68
            and swift_note_count >= pyin_note_count
            and pyin_interior_hold >= 0.34
            and pyin_fragmentation >= 0.45
            and swift_acceptance >= pyin_acceptance - 0.16
            and swift_music_feel >= pyin_music_feel - 0.08
        ):
            return best_swift, ranked, "repair_penalty_tiebreak"

    return best, ranked, "highest_score"


def should_use_swiftf0_fast_path(
    detection,
    acceptance: dict[str, float | int | str],
    candidate_score: float,
) -> bool:
    if detection.provider != "swiftf0":
        return False

    acceptance_score = float(acceptance["score"])
    music_feel = float(acceptance["musicFeelScore"])
    first_onset_lag = float(acceptance["firstOnsetLag"])
    onset_fragmentation = float(acceptance["onsetFragmentation"])
    interior_hold = float(acceptance.get("interiorHoldRatio", 0.0))

    return (
        candidate_score >= 3.32
        and acceptance_score >= 0.82
        and music_feel >= 0.74
        and first_onset_lag <= 0.12
        and onset_fragmentation <= 0.32
        and interior_hold <= 0.24
    )


def should_use_swiftf0_long_take_fast_path(
    detection,
    acceptance: dict[str, float | int | str],
    candidate_score: float,
) -> bool:
    if detection.provider != "swiftf0":
        return False

    contour_duration = (
        (len(detection.f0) * detection.hop_length) / detection.sample_rate
        if len(detection.f0)
        else 0.0
    )
    voiced_ratio = (
        float(np.count_nonzero(detection.voiced)) / len(detection.voiced)
        if len(detection.voiced)
        else float(detection.diagnostics.get("voicedRatio", 0.0) or 0.0)
    )
    acceptance_score = float(acceptance["score"])
    music_feel = float(acceptance["musicFeelScore"])
    first_onset_lag = float(acceptance["firstOnsetLag"])
    onset_fragmentation = float(acceptance["onsetFragmentation"])
    interior_hold = float(acceptance.get("interiorHoldRatio", 0.0))
    excessive_hold = float(acceptance.get("excessiveHoldRatio", 0.0))

    return (
        contour_duration >= 8.0
        and candidate_score >= 3.45
        and acceptance_score >= 0.78
        and music_feel >= 0.68
        and first_onset_lag <= 0.04
        and onset_fragmentation <= 0.24
        and interior_hold <= 0.14
        and excessive_hold <= 0.08
        and voiced_ratio >= 0.64
    )


def should_use_light_alternate_review(
    detection,
    acceptance: dict[str, float | int | str],
    candidate_score: float,
) -> bool:
    if detection.provider != "swiftf0":
        return False

    contour_duration = (
        (len(detection.f0) * detection.hop_length) / detection.sample_rate
        if len(detection.f0)
        else 0.0
    )
    voiced_ratio = (
        float(np.count_nonzero(detection.voiced)) / len(detection.voiced)
        if len(detection.voiced)
        else 0.0
    )
    acceptance_score = float(acceptance["score"])
    music_feel = float(acceptance["musicFeelScore"])
    first_onset_lag = float(acceptance["firstOnsetLag"])

    return (
        contour_duration >= 24.0
        and candidate_score >= 2.75
        and acceptance_score >= 0.7
        and music_feel >= 0.68
        and first_onset_lag <= 0.1
        and voiced_ratio >= 0.45
    )


def alternate_review_mode(
    detection,
    acceptance: dict[str, float | int | str],
    candidate_score: float,
) -> str | None:
    if detection.provider != "swiftf0":
        return None

    contour_duration = (
        (len(detection.f0) * detection.hop_length) / detection.sample_rate
        if len(detection.f0)
        else 0.0
    )
    acceptance_score = float(acceptance["score"])
    music_feel = float(acceptance["musicFeelScore"])
    first_onset_lag = float(acceptance["firstOnsetLag"])
    onset_fragmentation = float(acceptance["onsetFragmentation"])
    rushed_ratio = float(acceptance.get("rushedRatio", 0.0))
    interior_hold = float(acceptance.get("interiorHoldRatio", 0.0))
    excessive_hold = float(acceptance.get("excessiveHoldRatio", 0.0))
    proposal_urgent = float(detection.diagnostics.get("proposalUrgentRatio", 0.0))
    voiced_ratio = (
        float(np.count_nonzero(detection.voiced)) / len(detection.voiced)
        if len(detection.voiced)
        else 0.0
    )

    if (
        contour_duration >= 24.0
        and candidate_score >= 3.12
        and acceptance_score >= 0.82
        and music_feel >= 0.76
        and first_onset_lag <= 0.04
        and onset_fragmentation <= 0.56
        and rushed_ratio <= 0.34
        and interior_hold >= 0.18
        and excessive_hold >= 0.1
        and voiced_ratio >= 0.76
    ):
        return "light_no_repair_hold"

    if (
        contour_duration >= 18.0
        and candidate_score >= 2.72
        and acceptance_score >= 0.8
        and music_feel >= 0.76
        and first_onset_lag <= 0.08
        and onset_fragmentation <= 0.18
        and 0.28 <= rushed_ratio <= 0.52
        and interior_hold <= 0.05
        and excessive_hold <= 0.03
        and proposal_urgent <= 0.18
        and voiced_ratio >= 0.72
    ):
        return "light_no_repair_general"

    if (
        contour_duration >= 12.0
        and candidate_score >= 3.0
        and acceptance_score >= 0.79
        and music_feel >= 0.71
        and first_onset_lag <= 0.05
        and onset_fragmentation <= 0.27
        and rushed_ratio <= 0.5
        and interior_hold <= 0.05
        and excessive_hold <= 0.03
        and voiced_ratio >= 0.58
    ):
        return "light_no_repair_compact"

    if should_use_light_alternate_review(detection, acceptance, candidate_score):
        return "light_no_repair"

    return None


def alternate_base_hypothesis_ids(mode: str | None, provider: str) -> set[str] | None:
    if provider != "pyin":
        return None
    if mode == "light_no_repair_hold":
        return {"steady", "balanced"}
    if mode == "light_no_repair_general":
        return {"steady", "balanced"}
    if mode == "light_no_repair_compact":
        return {"steady", "balanced", "rescue"}
    return None


def detect_with_optional_ensemble(y: np.ndarray, configured_provider: str):
    """Run the detector path, optionally comparing SwiftF0 and pYIN in auto mode."""
    if configured_provider != "auto":
        detection = detect_pitch(
            y,
            DetectorConfig(
                provider=configured_provider,
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )
        note_candidates, repair_reason = collect_note_candidates(detection)
        if not note_candidates:
            return detection, []
        selected_hypothesis, notes, acceptance, score = note_candidates[0]
        if configured_provider == "swiftf0" and should_use_swiftf0_fast_path(
            detection,
            acceptance,
            score,
        ):
            detection.diagnostics["providerRerouted"] = False
            detection.diagnostics["ensembleDecision"] = "configured_fast_path"
            detection.diagnostics["ensembleCandidates"] = ",".join(
                f"{configured_provider}/{candidate_id}:{candidate_score:.3f}"
                for candidate_id, _candidate_notes, _candidate_acceptance, candidate_score in note_candidates
            )
            detection.diagnostics["ensembleSelected"] = f"{configured_provider}/{selected_hypothesis}"
            detection.diagnostics["providerPitchMs"] = detection.diagnostics.get("pitchMs")
            apply_candidate_selection_diagnostics(
                detection,
                selected_hypothesis,
                note_candidates,
                acceptance,
                repair_reason=repair_reason,
            )
            return detection, notes

        alternate_provider = "pyin" if configured_provider == "swiftf0" else "swiftf0"
        reroute_decision = "configured_provider"
        alternate_mode = (
            alternate_review_mode(detection, acceptance, score)
            if alternate_provider == "pyin"
            else None
        )
        light_alternate_review = alternate_mode is not None
        alternate_hypothesis_ids = alternate_base_hypothesis_ids(
            alternate_mode,
            alternate_provider,
        )
        if alternate_hypothesis_ids is not None:
            detection.diagnostics["alternateReviewHypotheses"] = ",".join(
                sorted(alternate_hypothesis_ids)
            )
        try:
            alt_detection = detect_pitch(
                y,
                DetectorConfig(
                    provider=alternate_provider,
                    sample_rate=SR,
                    fmin=FMIN,
                    fmax=FMAX,
                    frame_length=FRAME_LEN,
                    hop_length=HOP_LEN,
                ),
            )
            alt_candidates, alt_repair_reason = collect_note_candidates(
                alt_detection,
                allow_repair_rerun=not light_alternate_review,
                allowed_base_hypothesis_ids=alternate_hypothesis_ids,
            )
            if alt_candidates:
                pool = [
                    (detection, candidate_id, candidate_notes, candidate_acceptance, candidate_score)
                    for candidate_id, candidate_notes, candidate_acceptance, candidate_score in note_candidates
                ]
                pool.extend(
                    (alt_detection, candidate_id, candidate_notes, candidate_acceptance, candidate_score)
                    for candidate_id, candidate_notes, candidate_acceptance, candidate_score in alt_candidates
                )
                selected, ranked_candidates, reroute_decision = choose_ensemble_candidate(pool)
                detection, selected_hypothesis, notes, acceptance, score = selected
                repair_reason = (
                    repair_reason if detection.provider == configured_provider else alt_repair_reason
                )
                note_candidates = [
                    (candidate_id, candidate_notes, candidate_acceptance, candidate_score)
                    for candidate, candidate_id, candidate_notes, candidate_acceptance, candidate_score in ranked_candidates
                    if candidate.provider == detection.provider
                ]
                detection.diagnostics["ensembleScore"] = round(score, 3)
                detection.diagnostics["ensembleDecision"] = f"explicit_{reroute_decision}"
                detection.diagnostics["ensembleCandidates"] = ",".join(
                    f"{candidate.provider}/{candidate_id}:{candidate_score:.3f}"
                    for candidate, candidate_id, _notes, _acceptance, candidate_score in ranked_candidates
                )
                detection.diagnostics["ensembleSelected"] = f"{detection.provider}/{selected_hypothesis}"
                detection.diagnostics["providerRerouted"] = detection.provider != configured_provider
                if alternate_mode is not None:
                    detection.diagnostics["alternateReviewMode"] = alternate_mode
                if detection.provider != configured_provider:
                    detection.warnings.insert(
                        0,
                        f"provider_reroute:{configured_provider}->{detection.provider}:{reroute_decision}",
                    )
        except DetectorUnavailable:
            pass

        apply_candidate_selection_diagnostics(
            detection,
            selected_hypothesis,
            note_candidates,
            acceptance,
            repair_reason=repair_reason,
        )
        return detection, notes

    total_started = time.perf_counter()
    candidates: list[tuple[object, str, list[dict[str, float | int]], dict[str, float | int | str], float]] = []
    alternate_mode: str | None = None
    for provider in ("swiftf0", "pyin"):
        try:
            detection = detect_pitch(
                y,
                DetectorConfig(
                    provider=provider,
                    sample_rate=SR,
                    fmin=FMIN,
                    fmax=FMAX,
                    frame_length=FRAME_LEN,
                    hop_length=HOP_LEN,
                ),
            )
        except DetectorUnavailable:
            continue

        note_candidates, repair_reason = collect_note_candidates(
            detection,
            allow_repair_rerun=not (provider == "pyin" and alternate_mode is not None),
            allowed_base_hypothesis_ids=alternate_base_hypothesis_ids(
                alternate_mode,
                provider,
            ),
        )
        detection.diagnostics["repairTriggered"] = repair_reason is not None
        if repair_reason is not None:
            detection.diagnostics["repairTriggerReason"] = repair_reason
        if provider == "swiftf0" and note_candidates:
            selected_hypothesis, notes, acceptance, score = note_candidates[0]
            if should_use_swiftf0_fast_path(detection, acceptance, score):
                detection.diagnostics["providerRerouted"] = False
                detection.diagnostics["ensembleDecision"] = "swift_fast_path"
                detection.diagnostics["ensembleCandidates"] = ",".join(
                    f"swiftf0/{candidate_id}:{candidate_score:.3f}"
                    for candidate_id, _candidate_notes, _candidate_acceptance, candidate_score in note_candidates
                )
                detection.diagnostics["ensembleSelected"] = f"swiftf0/{selected_hypothesis}"
                detection.diagnostics["providerPitchMs"] = detection.diagnostics.get("pitchMs")
                detection.diagnostics["pitchMs"] = round((time.perf_counter() - total_started) * 1000)
                apply_candidate_selection_diagnostics(
                    detection,
                    selected_hypothesis,
                    note_candidates,
                    acceptance,
                    repair_reason=detection.diagnostics.get("repairTriggerReason"),
                )
                return detection, notes
            if should_use_swiftf0_long_take_fast_path(detection, acceptance, score):
                detection.diagnostics["providerRerouted"] = False
                detection.diagnostics["ensembleDecision"] = "swift_long_take_fast_path"
                detection.diagnostics["ensembleCandidates"] = ",".join(
                    f"swiftf0/{candidate_id}:{candidate_score:.3f}"
                    for candidate_id, _candidate_notes, _candidate_acceptance, candidate_score in note_candidates
                )
                detection.diagnostics["ensembleSelected"] = f"swiftf0/{selected_hypothesis}"
                detection.diagnostics["providerPitchMs"] = detection.diagnostics.get("pitchMs")
                detection.diagnostics["pitchMs"] = round((time.perf_counter() - total_started) * 1000)
                apply_candidate_selection_diagnostics(
                    detection,
                    selected_hypothesis,
                    note_candidates,
                    acceptance,
                    repair_reason=detection.diagnostics.get("repairTriggerReason"),
                )
                return detection, notes
            alternate_mode = alternate_review_mode(
                detection,
                acceptance,
                score,
            )
            alternate_hypothesis_ids = alternate_base_hypothesis_ids(
                alternate_mode,
                "pyin",
            )
            if alternate_hypothesis_ids is not None:
                detection.diagnostics["alternateReviewHypotheses"] = ",".join(
                    sorted(alternate_hypothesis_ids)
                )
        for hypothesis_id, notes, acceptance, note_score in note_candidates:
            candidates.append((detection, hypothesis_id, notes, acceptance, note_score))

    if not candidates:
        raise DetectorUnavailable("No pitch detector is available")

    selected, ranked_candidates, decision = choose_ensemble_candidate(candidates)
    detection, selected_hypothesis, notes, acceptance, score = selected
    comparison = [
        f"{candidate.provider}/{hypothesis_id}:{candidate_score:.3f}"
        for candidate, hypothesis_id, _notes, _acceptance, candidate_score in ranked_candidates
    ]
    detection.diagnostics["providerPitchMs"] = detection.diagnostics.get("pitchMs")
    detection.diagnostics["pitchMs"] = round((time.perf_counter() - total_started) * 1000)
    detection.diagnostics["ensembleScore"] = round(score, 3)
    detection.diagnostics["ensembleDecision"] = decision
    detection.diagnostics["ensembleCandidates"] = ",".join(comparison)
    detection.diagnostics["ensembleSelected"] = f"{detection.provider}/{selected_hypothesis}"
    if alternate_mode is not None:
        detection.diagnostics["alternateReviewMode"] = alternate_mode
    if len(candidates) > 1:
        detection.warnings.insert(
            0,
            f"ensemble_pick:{detection.provider}/{selected_hypothesis}:{score:.3f}:{decision}",
        )
    apply_candidate_selection_diagnostics(
        detection,
        selected_hypothesis,
        [
            (candidate_id, candidate_notes, candidate_acceptance, candidate_score)
            for candidate, candidate_id, candidate_notes, candidate_acceptance, candidate_score in ranked_candidates
            if candidate.provider == detection.provider
        ],
        acceptance,
        repair_reason=detection.diagnostics.get("repairTriggerReason"),
    )
    return detection, notes


def score_detection_candidate(detection, notes: list[dict[str, float | int]]) -> float:
    voiced = np.asarray(detection.voiced, dtype=bool)
    confidence = np.asarray(detection.confidence, dtype=np.float64)
    contour_duration = max(len(voiced) * detection.hop_length / detection.sample_rate, 1e-6)
    voiced_ratio = float(np.count_nonzero(voiced)) / len(voiced) if len(voiced) else 0.0
    voiced_confidence = (
        float(np.mean(confidence[voiced])) if np.count_nonzero(voiced) > 0 else 0.0
    )
    short_ratio = (
        sum(1 for note in notes if float(note["duration"]) <= 0.16) / len(notes)
        if notes
        else 1.0
    )
    melodic_coverage = (
        sum(float(note["duration"]) for note in notes) / contour_duration
        if notes
        else 0.0
    )
    note_density = (len(notes) / contour_duration) if notes else 0.0
    dense_note_penalty = max(0.0, note_density - 4.4)
    oversegmented_long_penalty = 0.0
    if notes and contour_duration >= 2.4:
        oversegmented_long_penalty = (
            max(0.0, note_density - 3.6) * 0.22
            + max(0.0, short_ratio - 0.22) * 0.38
            + max(0.0, len(notes) - contour_duration * 6.8) * 0.018
        )
    if notes and contour_duration >= 3.2:
        oversegmented_long_penalty += max(0.0, len(notes) - 32) * 0.028
    sparse_note_penalty = max(0.0, 1.0 - note_density)
    count_reward = min(1.0, len(notes) / 8) if notes else 0.0
    return (
        count_reward * 0.65
        + voiced_ratio * 0.9
        + voiced_confidence * 1.1
        + min(0.8, melodic_coverage) * 0.8
        - short_ratio * 0.45
        - dense_note_penalty * 0.28
        - oversegmented_long_penalty
        - sparse_note_penalty * 0.12
    )


@app.post("/transcribe", dependencies=[Depends(require_worker_auth)])
async def transcribe(
    audio: Annotated[UploadFile, File(...)],
    targetInstrument: Annotated[str, Form()] = "piano",
):
    started = time.perf_counter()
    decode_ms = 0
    trim_ms = 0

    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="empty audio file")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio file too large")

        phase = time.perf_counter()
        y = decode_audio(data, audio.filename or "hum.webm")
        decode_ms = round((time.perf_counter() - phase) * 1000)
        if y.size == 0:
            raise HTTPException(status_code=422, detail="audio decoded empty")

        duration = len(y) / SR
        if duration > MAX_AUDIO_SECONDS:
            raise HTTPException(status_code=413, detail="audio duration too long")

        phase = time.perf_counter()
        y = trim_silence(y)
        trim_ms = round((time.perf_counter() - phase) * 1000)

        denoise_result = denoise_audio(
            y,
            DenoiseConfig(
                provider=configured_denoise_provider(),
                sample_rate=SR,
            ),
        )
        y = np.asarray(denoise_result.audio, dtype=np.float32)
        rms_dbfs = estimate_rms_dbfs(y)
        peak_dbfs = estimate_peak_dbfs(y)
        clipping_ratio = estimate_clipping_ratio(y)

        configured_provider = configured_pitch_provider()
        detection, notes = detect_with_optional_ensemble(y, configured_provider)

        voiced_ratio = (
            float(np.count_nonzero(detection.voiced)) / len(detection.voiced)
            if len(detection.voiced)
            else 0.0
        )
        diagnostics = {
            "duration": round(len(y) / SR, 3),
            "snr": estimate_snr(y),
            "rmsDbfs": rms_dbfs,
            "peakDbfs": peak_dbfs,
            "clippingRatio": clipping_ratio,
            "voicedRatio": round(voiced_ratio, 3),
            "frameCount": int(len(detection.f0)),
            "decodeMs": decode_ms,
            "trimMs": trim_ms,
            **denoise_result.diagnostics,
            "pitchMs": detection.diagnostics.get("pitchMs", 0),
            "polishMs": 0,
            "totalMs": round((time.perf_counter() - started) * 1000),
            **detection.diagnostics,
        }

        if not notes:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "no_voiced_frames",
                    "diagnostics": diagnostics,
                },
            )

        logger.info(
            "%s detected %s notes from %s frames for target %s",
            detection.provider,
            len(notes),
            len(detection.f0),
            targetInstrument,
        )
        return {
            "provider": detection.provider,
            "rawNotes": notes,
            "contour": build_contour_payload(
                timestamps=detection.timestamps,
                f0=detection.f0,
                confidence=detection.confidence,
                voiced=detection.voiced,
                sample_rate=detection.sample_rate,
                hop_length=detection.hop_length,
            ),
            "warnings": [
                *collect_input_quality_warnings(
                    rms_dbfs=rms_dbfs,
                    peak_dbfs=peak_dbfs,
                    clipping_ratio=clipping_ratio,
                    snr=diagnostics["snr"],
                ),
                *denoise_result.warnings,
                *detection.warnings,
            ],
            "diagnostics": diagnostics,
        }
    except HTTPException:
        raise
    except DetectorUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "detector_unavailable", "message": str(exc)},
        ) from exc
    except DenoiseUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "denoise_unavailable", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.exception("transcription error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "murmur-audio-engine",
        "provider": configured_pitch_provider(),
        "denoiseProvider": configured_denoise_provider(),
    }


@app.get("/")
def root():
    return {
        "service": "Murmur Audio Engine",
        "endpoints": ["/transcribe", "/health"],
    }
