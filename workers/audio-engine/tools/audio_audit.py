from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

WORKER_ROOT = Path(__file__).resolve().parents[1]
EXPECTATIONS_PATH = Path(__file__).with_name("audio_audit_expectations.json")
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from audio_engine.detectors import DetectorUnavailable
from main import (
    SR,
    collect_input_quality_warnings,
    detect_with_optional_ensemble,
    estimate_clipping_ratio,
    estimate_peak_dbfs,
    estimate_rms_dbfs,
    estimate_snr,
    trim_silence,
)


@dataclass
class AuditCase:
    name: str
    signal: np.ndarray
    expected_min_notes: int
    expected_pitches: list[int] | None = None
    expected_pitch_sets: list[dict[str, object]] | None = None
    expect_warning: str | None = None
    tags: list[str] | None = None
    family: str = "synthetic"
    source: str = "synthetic"
    pitch_match_min: float | None = None
    music_feel_min: float | None = None


def synth_case(
    *,
    notes_hz: list[float],
    note_duration: float = 0.42,
    silence: float = 0.16,
    amplitude: float = 0.35,
    noise_std: float = 0.0,
    clip: bool = False,
    rushed: bool = False,
) -> np.ndarray:
    chunks: list[np.ndarray] = [np.zeros(int(silence * SR), dtype=np.float32)]
    phase = 0.0
    for frequency in notes_hz:
        duration = note_duration * (0.45 if rushed else 1.0)
        t = np.arange(int(duration * SR), dtype=np.float32)
        tone = amplitude * np.sin(phase + 2 * np.pi * frequency * t / SR)
        phase = float((phase + 2 * np.pi * frequency * len(t) / SR) % (2 * np.pi))
        chunks.append(tone.astype(np.float32))
        gap = silence * (0.18 if rushed else 1.0)
        chunks.append(np.zeros(int(gap * SR), dtype=np.float32))
    signal = np.concatenate(chunks)
    if noise_std > 0:
        signal = signal + np.random.default_rng(7).normal(0, noise_std, signal.shape).astype(np.float32)
    if clip:
        signal = np.clip(signal * 2.8, -1.0, 1.0)
    return signal.astype(np.float32)


def synth_timed_case(
    *,
    notes_hz: list[float],
    durations: list[float],
    gaps: list[float] | None = None,
    amplitude: float = 0.35,
    noise_std: float = 0.0,
    clip: bool = False,
    drift_cents: list[float] | None = None,
) -> np.ndarray:
    if len(notes_hz) != len(durations):
        raise ValueError("notes_hz and durations must be the same length")

    resolved_gaps = gaps if gaps is not None else [0.1] * len(notes_hz)
    if len(resolved_gaps) != len(notes_hz):
        raise ValueError("gaps must be the same length as notes_hz")

    resolved_drift = drift_cents if drift_cents is not None else [0.0] * len(notes_hz)
    if len(resolved_drift) != len(notes_hz):
        raise ValueError("drift_cents must be the same length as notes_hz")

    chunks: list[np.ndarray] = [np.zeros(int(0.08 * SR), dtype=np.float32)]
    phase = 0.0
    for frequency, duration, gap, cents in zip(notes_hz, durations, resolved_gaps, resolved_drift):
        adjusted_frequency = float(frequency * (2 ** (cents / 1200)))
        t = np.arange(int(duration * SR), dtype=np.float32)
        tone = amplitude * np.sin(phase + 2 * np.pi * adjusted_frequency * t / SR)
        phase = float((phase + 2 * np.pi * adjusted_frequency * len(t) / SR) % (2 * np.pi))
        chunks.append(tone.astype(np.float32))
        chunks.append(np.zeros(int(gap * SR), dtype=np.float32))

    signal = np.concatenate(chunks)
    if noise_std > 0:
        signal = signal + np.random.default_rng(11).normal(0, noise_std, signal.shape).astype(np.float32)
    if clip:
        signal = np.clip(signal * 2.6, -1.0, 1.0)
    return signal.astype(np.float32)


def synth_modulated_case(
    *,
    base_notes_hz: list[float],
    durations: list[float],
    gaps: list[float] | None = None,
    glide_cents: list[float] | None = None,
    vibrato_cents: list[float] | None = None,
    vibrato_hz: float = 5.0,
    amplitude: float = 0.32,
) -> np.ndarray:
    if len(base_notes_hz) != len(durations):
        raise ValueError("base_notes_hz and durations must be the same length")

    resolved_gaps = gaps if gaps is not None else [0.08] * len(base_notes_hz)
    resolved_glide = glide_cents if glide_cents is not None else [0.0] * len(base_notes_hz)
    resolved_vibrato = vibrato_cents if vibrato_cents is not None else [0.0] * len(base_notes_hz)
    if len(resolved_gaps) != len(base_notes_hz):
        raise ValueError("gaps must be the same length as base_notes_hz")
    if len(resolved_glide) != len(base_notes_hz):
        raise ValueError("glide_cents must be the same length as base_notes_hz")
    if len(resolved_vibrato) != len(base_notes_hz):
        raise ValueError("vibrato_cents must be the same length as base_notes_hz")

    chunks: list[np.ndarray] = [np.zeros(int(0.08 * SR), dtype=np.float32)]
    phase = 0.0
    for base_frequency, duration, gap, glide, vibrato in zip(
        base_notes_hz,
        durations,
        resolved_gaps,
        resolved_glide,
        resolved_vibrato,
    ):
        t = np.arange(int(duration * SR), dtype=np.float32) / SR
        cents_curve = np.linspace(0, glide, len(t), dtype=np.float32)
        if vibrato:
            cents_curve = cents_curve + vibrato * np.sin(2 * np.pi * vibrato_hz * t)
        frequency_curve = base_frequency * np.power(2.0, cents_curve / 1200.0)
        phase_curve = phase + np.cumsum(2 * np.pi * frequency_curve / SR, dtype=np.float64)
        tone = amplitude * np.sin(phase_curve)
        phase = float(phase_curve[-1] % (2 * np.pi)) if len(phase_curve) else phase
        chunks.append(tone.astype(np.float32))
        chunks.append(np.zeros(int(gap * SR), dtype=np.float32))

    return np.concatenate(chunks).astype(np.float32)


def build_cases() -> list[AuditCase]:
    return [
        AuditCase(
            name="clean_scale",
            signal=synth_case(notes_hz=[261.63, 293.66, 329.63]),
            expected_min_notes=2,
            expected_pitches=[60, 62, 64],
            tags=["synthetic", "baseline"],
        ),
        AuditCase(
            name="noisy_scale",
            signal=synth_case(notes_hz=[261.63, 293.66, 329.63], amplitude=0.2, noise_std=0.09),
            expected_min_notes=2,
            expected_pitches=[60, 62, 64],
            expect_warning="input_noisy",
            tags=["synthetic", "noise"],
        ),
        AuditCase(
            name="quiet_scale",
            signal=synth_case(notes_hz=[261.63, 293.66, 329.63], amplitude=0.015),
            expected_min_notes=1,
            expected_pitches=[60, 62, 64],
            expect_warning="input_too_quiet",
            tags=["synthetic", "quiet"],
        ),
        AuditCase(
            name="clipped_scale",
            signal=synth_case(notes_hz=[261.63, 293.66, 329.63], amplitude=0.45, clip=True),
            expected_min_notes=1,
            expected_pitches=[60, 62, 64],
            expect_warning="input_clipping",
            tags=["synthetic", "clipping"],
        ),
        AuditCase(
            name="rushed_phrase",
            signal=synth_case(notes_hz=[261.63, 293.66, 329.63, 349.23], rushed=True),
            expected_min_notes=2,
            expected_pitches=[60, 62, 64, 65],
            tags=["synthetic", "urgent"],
        ),
        AuditCase(
            name="two_tigers_phrase",
            signal=synth_case(
                notes_hz=[261.63, 293.66, 329.63, 261.63, 261.63, 293.66, 329.63, 261.63],
                note_duration=0.32,
                silence=0.08,
            ),
            expected_min_notes=6,
            expected_pitches=[60, 62, 64, 60, 60, 62, 64, 60],
            tags=["synthetic", "familiar"],
        ),
        AuditCase(
            name="brightest_star_hook",
            signal=synth_case(
                notes_hz=[392.0, 392.0, 440.0, 392.0, 329.63, 293.66],
                note_duration=0.34,
                silence=0.09,
            ),
            expected_min_notes=5,
            expected_pitches=[67, 67, 69, 67, 64, 62],
            tags=["synthetic", "familiar"],
        ),
        AuditCase(
            name="overheld_middle_phrase",
            signal=synth_timed_case(
                notes_hz=[261.63, 293.66, 329.63, 349.23],
                durations=[0.26, 0.74, 0.24, 0.24],
                gaps=[0.08, 0.06, 0.08, 0.1],
            ),
            expected_min_notes=4,
            expected_pitches=[60, 62, 64, 65],
            tags=["synthetic", "repair"],
        ),
        AuditCase(
            name="pitch_weak_stable_phrase",
            signal=synth_timed_case(
                notes_hz=[261.63, 293.66, 329.63, 392.0],
                durations=[0.34, 0.34, 0.34, 0.4],
                gaps=[0.1, 0.1, 0.1, 0.12],
                drift_cents=[-38, -24, -31, 27],
                amplitude=0.28,
            ),
            expected_min_notes=4,
            expected_pitches=[60, 62, 64, 67],
            tags=["synthetic", "pitch_weak"],
        ),
        AuditCase(
            name="urgent_hook_fragment",
            signal=synth_timed_case(
                notes_hz=[392.0, 440.0, 392.0, 329.63, 293.66],
                durations=[0.16, 0.18, 0.17, 0.16, 0.19],
                gaps=[0.028, 0.032, 0.028, 0.034, 0.04],
                amplitude=0.31,
                noise_std=0.012,
            ),
            expected_min_notes=5,
            expected_pitches=[67, 69, 67, 64, 62],
            tags=["synthetic", "urgent", "repair"],
        ),
        AuditCase(
            name="glide_phrase",
            signal=synth_modulated_case(
                base_notes_hz=[261.63, 293.66, 329.63, 349.23],
                durations=[0.28, 0.28, 0.3, 0.34],
                gaps=[0.05, 0.05, 0.06, 0.1],
                glide_cents=[45, 55, -35, 0],
            ),
            expected_min_notes=4,
            expected_pitches=[60, 62, 64, 65],
            tags=["synthetic", "glide"],
        ),
        AuditCase(
            name="vibrato_phrase",
            signal=synth_modulated_case(
                base_notes_hz=[392.0, 392.0, 440.0, 392.0],
                durations=[0.36, 0.34, 0.32, 0.42],
                gaps=[0.05, 0.05, 0.06, 0.1],
                vibrato_cents=[22, 28, 18, 16],
            ),
            expected_min_notes=3,
            expected_pitches=[67, 69, 67],
            tags=["synthetic", "wobble"],
        ),
    ]


def load_manifest_cases(
    manifest_path: Path,
    *,
    manifest_root: Path | None = None,
    case_limit: int | None = None,
) -> list[AuditCase]:
    payload = json.loads(manifest_path.read_text())
    if not isinstance(payload, list):
        raise ValueError("dataset manifest must be a JSON array")

    root = manifest_root if manifest_root is not None else manifest_path.parent
    cases: list[AuditCase] = []

    items = payload[:case_limit] if isinstance(case_limit, int) and case_limit > 0 else payload

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"manifest item {index} must be an object")
        name = str(item.get("name") or f"manifest_case_{index}")
        relative_path = item.get("path")
        if not isinstance(relative_path, str) or not relative_path.strip():
            raise ValueError(f"{name}: path is required")
        audio_path = (root / relative_path).resolve()
        if not audio_path.exists():
            raise FileNotFoundError(f"{name}: audio file not found at {audio_path}")

        signal, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=False)
        if isinstance(signal, np.ndarray) and signal.ndim > 1:
            signal = signal.mean(axis=1)
        if sample_rate != SR:
            import librosa

            signal = librosa.resample(np.asarray(signal, dtype=np.float32), orig_sr=sample_rate, target_sr=SR)

        expected_min_notes = int(item.get("expected_min_notes", 1))
        expected_pitches_raw = item.get("expected_pitches")
        expected_pitches = (
            [int(value) for value in expected_pitches_raw]
            if isinstance(expected_pitches_raw, list)
            else None
        )
        expected_pitch_sets_raw = item.get("expected_pitch_sets")
        expected_pitch_sets: list[dict[str, object]] | None = None
        if isinstance(expected_pitch_sets_raw, list):
            parsed_sets: list[dict[str, object]] = []
            for set_item in expected_pitch_sets_raw:
                if not isinstance(set_item, dict):
                    continue
                pitches_raw = set_item.get("pitches")
                if not isinstance(pitches_raw, list):
                    continue
                parsed_sets.append(
                    {
                        "label": str(set_item.get("label") or f"reference_{len(parsed_sets) + 1}"),
                        "pitches": [int(value) for value in pitches_raw],
                    }
                )
            if parsed_sets:
                expected_pitch_sets = parsed_sets
        tags_raw = item.get("tags")
        tags = [str(tag) for tag in tags_raw] if isinstance(tags_raw, list) else None
        expect_warning = (
            str(item["expect_warning"]) if isinstance(item.get("expect_warning"), str) else None
        )
        family_raw = item.get("family")
        family = str(family_raw).strip() if isinstance(family_raw, str) and family_raw.strip() else "external"
        source_raw = item.get("source")
        source = str(source_raw).strip() if isinstance(source_raw, str) and source_raw.strip() else "manifest"
        pitch_match_min_raw = item.get("pitch_match_min")
        pitch_match_min = (
            float(pitch_match_min_raw)
            if isinstance(pitch_match_min_raw, (int, float))
            else None
        )
        music_feel_min_raw = item.get("music_feel_min")
        music_feel_min = (
            float(music_feel_min_raw)
            if isinstance(music_feel_min_raw, (int, float))
            else None
        )
        cases.append(
            AuditCase(
                name=name,
                signal=np.asarray(signal, dtype=np.float32),
                expected_min_notes=expected_min_notes,
                expected_pitches=expected_pitches,
                expected_pitch_sets=expected_pitch_sets,
                expect_warning=expect_warning,
                tags=tags,
                family=family,
                source=source,
                pitch_match_min=pitch_match_min,
                music_feel_min=music_feel_min,
            )
        )

    return cases


def pitch_match_score(expected_pitches: list[int] | None, notes: list[dict[str, float | int]]) -> float | None:
    if not expected_pitches or not notes:
        return None
    detected = [int(note["pitch"]) for note in notes]
    if not detected:
        return 0.0

    expected_len = len(expected_pitches)
    detected_len = len(detected)
    dp = [[0] * (detected_len + 1) for _ in range(expected_len + 1)]
    for expected_index in range(expected_len):
        expected_pitch = expected_pitches[expected_index]
        row = dp[expected_index]
        next_row = dp[expected_index + 1]
        for detected_index in range(detected_len):
            actual_pitch = detected[detected_index]
            if abs(expected_pitch - actual_pitch) <= 1:
                next_row[detected_index + 1] = row[detected_index] + 1
            else:
                next_row[detected_index + 1] = max(next_row[detected_index], row[detected_index + 1])

    matches = dp[expected_len][detected_len]
    precision = matches / detected_len if detected_len else 0.0
    recall = matches / expected_len if expected_len else 0.0
    if precision + recall <= 1e-9:
        return 0.0
    return round((2 * precision * recall) / (precision + recall), 3)


def select_pitch_match_score(
    expected_pitches: list[int] | None,
    expected_pitch_sets: list[dict[str, object]] | None,
    notes: list[dict[str, float | int]],
) -> tuple[float | None, str | None]:
    candidates: list[tuple[str | None, list[int]]] = []
    if expected_pitches:
        candidates.append(("primary", expected_pitches))
    if expected_pitch_sets:
        for item in expected_pitch_sets:
            pitches = item.get("pitches")
            if isinstance(pitches, list) and pitches:
                candidates.append((str(item.get("label") or "reference"), [int(value) for value in pitches]))

    best_score: float | None = None
    best_label: str | None = None
    for label, pitches in candidates:
        score = pitch_match_score(pitches, notes)
        if score is None:
            continue
        if best_score is None or score > best_score:
            best_score = score
            best_label = label
    return best_score, best_label


def urgent_coherence_score(durations: np.ndarray, rushed_ratio: float, onset_fragmentation: float) -> float:
    if durations.size < 4 or rushed_ratio < 0.2 or onset_fragmentation > 0.18:
        return 0.0
    mean_duration = float(np.mean(durations))
    if mean_duration <= 1e-6:
        return 0.0
    variation = float(np.std(durations) / mean_duration)
    coherence = max(0.0, 1.0 - variation / 0.34)
    return round(coherence * min(1.0, rushed_ratio / 0.7), 3)


def music_feel_score(notes: list[dict[str, float | int]]) -> dict[str, float] | None:
    if not notes:
        return None

    durations = np.asarray([float(note["duration"]) for note in notes], dtype=np.float64)
    confidences = np.asarray([float(note["confidence"]) for note in notes], dtype=np.float64)

    if durations.size == 0:
        return None

    median_duration = float(np.median(durations))
    if median_duration <= 1e-6:
        median_duration = 1e-6

    rushed_ratio = float(np.mean(durations <= max(0.16, median_duration * 0.52)))
    ambiguous_mid_ratio = float(
        np.mean((durations >= median_duration * 0.72) & (durations <= median_duration * 1.28))
    )
    cadence_ratio = float(durations[-1] / median_duration)
    excessive_hold_ratio = float(np.mean(durations >= max(median_duration * 1.9, 0.82)))
    onset_fragmentation = float(np.mean(np.abs(np.diff(durations)) >= max(0.22, median_duration * 0.8))) if durations.size > 1 else 0.0
    confidence_mean = float(np.mean(confidences))
    urgent_coherence = urgent_coherence_score(durations, rushed_ratio, onset_fragmentation)

    score = (
        0.34 * max(0.0, 1.0 - rushed_ratio)
        + 0.22 * max(0.0, 1.0 - max(0.0, ambiguous_mid_ratio - 0.55))
        + 0.24 * min(1.0, cadence_ratio / 1.6)
        + 0.20 * confidence_mean
        + 0.2 * urgent_coherence
        - 0.08 * excessive_hold_ratio
        - 0.08 * onset_fragmentation
    )
    return {
        "score": round(score, 3),
        "rushedRatio": round(rushed_ratio, 3),
        "ambiguousMidRatio": round(ambiguous_mid_ratio, 3),
        "cadenceRatio": round(cadence_ratio, 3),
        "excessiveHoldRatio": round(excessive_hold_ratio, 3),
        "onsetFragmentation": round(onset_fragmentation, 3),
        "confidenceMean": round(confidence_mean, 3),
        "urgentCoherence": round(urgent_coherence, 3),
    }


def music_feel_from_diagnostics(
    diagnostics: dict[str, object],
    notes: list[dict[str, float | int]],
) -> dict[str, float] | None:
    score = diagnostics.get("musicFeelScore")
    if not isinstance(score, (int, float)):
        return None

    confidence_values = [
        float(note.get("confidence", 0.0))
        for note in notes
        if isinstance(note.get("confidence"), (int, float))
    ]
    confidence_mean = float(np.mean(confidence_values)) if confidence_values else 0.0

    def metric(name: str) -> float:
        value = diagnostics.get(name)
        return round(float(value), 3) if isinstance(value, (int, float)) else 0.0

    return {
        "score": round(float(score), 3),
        "rushedRatio": metric("rushedRatio"),
        "ambiguousMidRatio": metric("ambiguousMidRatio"),
        "cadenceRatio": metric("cadenceRatio"),
        "excessiveHoldRatio": metric("excessiveHoldRatio"),
        "onsetFragmentation": metric("onsetFragmentation"),
        "confidenceMean": round(confidence_mean, 3),
        "urgentCoherence": metric("urgentCoherence"),
    }


def run_case(provider: str, case: AuditCase) -> dict[str, object]:
    trimmed = trim_silence(case.signal)
    detection, notes = detect_with_optional_ensemble(trimmed, provider)
    rms_dbfs = estimate_rms_dbfs(trimmed)
    peak_dbfs = estimate_peak_dbfs(trimmed)
    clipping_ratio = estimate_clipping_ratio(trimmed)
    snr = estimate_snr(trimmed)
    warnings = [
        *collect_input_quality_warnings(
            rms_dbfs=rms_dbfs,
            peak_dbfs=peak_dbfs,
            clipping_ratio=clipping_ratio,
            snr=snr,
        ),
        *detection.warnings,
    ]
    diagnostics = dict(detection.diagnostics)
    voiced_ratio = (
        float(np.count_nonzero(np.asarray(detection.voiced))) / len(detection.voiced)
        if len(detection.voiced)
        else 0.0
    )
    diagnostics["snr"] = snr
    diagnostics["rmsDbfs"] = rms_dbfs
    diagnostics["peakDbfs"] = peak_dbfs
    diagnostics["clippingRatio"] = clipping_ratio
    diagnostics["voicedRatio"] = round(voiced_ratio, 3)
    match_score, match_reference = select_pitch_match_score(
        case.expected_pitches,
        case.expected_pitch_sets,
        notes,
    )
    feel = music_feel_from_diagnostics(diagnostics, notes) or music_feel_score(notes)
    status = "pass" if len(notes) >= case.expected_min_notes else "fail"
    if case.expect_warning and case.expect_warning not in warnings:
        status = "warn"
    pitch_match_min = case.pitch_match_min if case.pitch_match_min is not None else 0.55
    music_feel_min = case.music_feel_min if case.music_feel_min is not None else 0.58

    if match_score is not None and match_score < pitch_match_min and status == "pass":
        status = "warn"
    if feel is not None and feel["score"] < music_feel_min and status == "pass":
        status = "warn"
    if feel is not None and (
        feel["excessiveHoldRatio"] >= 0.34 or
        feel["onsetFragmentation"] >= 0.52
    ) and status == "pass":
        status = "warn"

    return {
        "case": case.name,
        "provider": detection.provider,
        "requestedProvider": provider,
        "status": status,
        "family": case.family,
        "source": case.source,
        "noteCount": len(notes),
        "expectedPitches": case.expected_pitches,
        "expectedPitchSets": case.expected_pitch_sets,
        "tags": case.tags or [],
        "thresholds": {
            "pitchMatchMin": pitch_match_min,
            "musicFeelMin": music_feel_min,
        },
        "pitchMatchScore": match_score,
        "pitchMatchReference": match_reference,
        "musicFeel": feel,
        "notes": notes,
        "warnings": warnings,
        "diagnostics": diagnostics,
    }


def summarize_results(results: list[dict[str, object]]) -> dict[str, object]:
    def status_count(bucket: list[dict[str, object]], value: str) -> int:
        return sum(1 for result in bucket if result.get("status") == value)

    def diagnostics_metric(metric: str, percentile: int | None = None) -> float | None:
        values = [
            float(result["diagnostics"][metric])
            for result in results
            if isinstance(result.get("diagnostics"), dict)
            and isinstance(result["diagnostics"].get(metric), (int, float))
        ]
        if not values:
            return None
        if percentile is not None:
            return round(float(np.percentile(values, percentile)), 3)
        return round(float(np.median(values)), 3)

    def mean_of(values: list[float]) -> float | None:
        if not values:
            return None
        return round(float(np.mean(values)), 3)

    def summarize_bucket(bucket: list[dict[str, object]]) -> dict[str, object]:
        pitch_scores = [
            float(result["pitchMatchScore"])
            for result in bucket
            if isinstance(result.get("pitchMatchScore"), (int, float))
        ]
        feel_scores = [
            float(result["musicFeel"]["score"])
            for result in bucket
            if isinstance(result.get("musicFeel"), dict)
            and isinstance(result["musicFeel"].get("score"), (int, float))
        ]
        return {
            "cases": len(bucket),
            "pass": status_count(bucket, "pass"),
            "warn": status_count(bucket, "warn"),
            "fail": status_count(bucket, "fail"),
            "error": status_count(bucket, "error"),
            "avgPitchMatchScore": mean_of(pitch_scores),
            "avgMusicFeelScore": mean_of(feel_scores),
        }

    families: dict[str, list[dict[str, object]]] = {}
    tags: dict[str, list[dict[str, object]]] = {}
    for result in results:
        family = str(result.get("family") or "unknown")
        families.setdefault(family, []).append(result)
        for tag in result.get("tags", []):
            tags.setdefault(str(tag), []).append(result)

    return {
        "pass": status_count(results, "pass"),
        "warn": status_count(results, "warn"),
        "fail": status_count(results, "fail"),
        "error": status_count(results, "error"),
        "repairTriggeredCount": sum(
            1
            for result in results
            if isinstance(result.get("diagnostics"), dict)
            and result["diagnostics"].get("repairTriggered") is True
        ),
        "providerReroutedCount": sum(
            1
            for result in results
            if isinstance(result.get("diagnostics"), dict)
            and result["diagnostics"].get("providerRerouted") is True
        ),
        "medianPitchMs": diagnostics_metric("pitchMs"),
        "p95PitchMs": diagnostics_metric("pitchMs", percentile=95),
        "families": {
            family: summarize_bucket(bucket)
            for family, bucket in sorted(families.items())
        },
        "tags": {
            tag: summarize_bucket(bucket)
            for tag, bucket in sorted(tags.items())
        },
    }


def load_expectations() -> dict[str, Any]:
    if not EXPECTATIONS_PATH.exists():
        return {}
    return json.loads(EXPECTATIONS_PATH.read_text())


def validate_runs(
    runs: list[dict[str, object]],
    expectations: dict[str, Any],
) -> list[str]:
    provider_expectations = expectations.get("providers", {})
    failures: list[str] = []

    for run in runs:
        provider = str(run.get("provider"))
        expected = provider_expectations.get(provider)
        if not expected:
            continue

        summary = run.get("summary", {})
        if isinstance(summary, dict):
            summary_expected = expected.get("summary", {})
            for key, value in summary_expected.items():
                actual_value = summary.get(key.removesuffix("Min").removesuffix("Max"))
                if key.endswith("Min"):
                    if not isinstance(actual_value, (int, float)) or float(actual_value) < float(value):
                        failures.append(f"{provider}: {key[:-3]} {actual_value} < {value}")
                elif key.endswith("Max"):
                    if not isinstance(actual_value, (int, float)) or float(actual_value) > float(value):
                        failures.append(f"{provider}: {key[:-3]} {actual_value} > {value}")

        case_index = {
            str(case.get("case")): case
            for case in run.get("cases", [])
            if isinstance(case, dict)
        }
        for case_name, case_expected in expected.get("cases", {}).items():
            actual = case_index.get(case_name)
            if actual is None:
                failures.append(f"{provider}/{case_name}: missing case")
                continue

            allowed_statuses = case_expected.get("statusIn")
            if allowed_statuses and actual.get("status") not in allowed_statuses:
                failures.append(
                    f"{provider}/{case_name}: status {actual.get('status')} not in {allowed_statuses}"
                )
            if "pitchMatchScoreMin" in case_expected:
                score = actual.get("pitchMatchScore")
                if not isinstance(score, (int, float)) or float(score) < float(case_expected["pitchMatchScoreMin"]):
                    failures.append(
                        f"{provider}/{case_name}: pitchMatchScore {score} < {case_expected['pitchMatchScoreMin']}"
                    )
            if "noteCountMin" in case_expected:
                note_count = int(actual.get("noteCount", 0))
                if note_count < int(case_expected["noteCountMin"]):
                    failures.append(
                        f"{provider}/{case_name}: noteCount {note_count} < {case_expected['noteCountMin']}"
                    )
            if "providerIn" in case_expected and actual.get("provider") not in case_expected["providerIn"]:
                failures.append(
                    f"{provider}/{case_name}: detector {actual.get('provider')} not in {case_expected['providerIn']}"
                )

            diagnostics_expected = case_expected.get("diagnostics", {})
            diagnostics = actual.get("diagnostics", {})
            if isinstance(diagnostics, dict):
                for key, value in diagnostics_expected.items():
                    actual_value = diagnostics.get(key.removesuffix("Min").removesuffix("Max"))
                    if key.endswith("Min"):
                        if not isinstance(actual_value, (int, float)) or float(actual_value) < float(value):
                            failures.append(
                                f"{provider}/{case_name}: {key[:-3]} {actual_value} < {value}"
                            )
                    elif key.endswith("Max"):
                        if not isinstance(actual_value, (int, float)) or float(actual_value) > float(value):
                            failures.append(
                                f"{provider}/{case_name}: {key[:-3]} {actual_value} > {value}"
                            )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Murmur local audio audit cases.")
    parser.add_argument(
      "--provider",
      default="auto",
      choices=["auto", "pyin", "swiftf0"],
      help="Pitch provider to audit",
    )
    parser.add_argument(
      "--pretty",
      action="store_true",
      help="Pretty-print JSON output",
    )
    parser.add_argument(
      "--all-providers",
      action="store_true",
      help="Run the audit across auto, swiftf0, and pyin for side-by-side comparison",
    )
    parser.add_argument(
      "--strict",
      action="store_true",
      help="Fail with a non-zero exit code when audited output violates the checked-in expectations",
    )
    parser.add_argument(
      "--manifest",
      help="Optional dataset manifest (JSON array) describing extra WAV cases to run",
    )
    parser.add_argument(
      "--manifest-root",
      help="Optional root directory used to resolve manifest audio paths",
    )
    parser.add_argument(
      "--manifest-case-limit",
      type=int,
      help="Optional limit on how many manifest cases to load",
    )
    parser.add_argument(
      "--manifest-only",
      action="store_true",
      help="Run only manifest-loaded cases instead of appending them to the built-in synthetic corpus",
    )
    args = parser.parse_args()

    providers = ["auto", "swiftf0", "pyin"] if args.all_providers else [args.provider]
    runs: list[dict[str, object]] = []
    cases = [] if args.manifest_only else build_cases()
    if args.manifest:
        manifest_root = Path(args.manifest_root).resolve() if args.manifest_root else None
        cases = [
            *cases,
            *load_manifest_cases(
                Path(args.manifest).resolve(),
                manifest_root=manifest_root,
                case_limit=args.manifest_case_limit,
            ),
        ]

    for provider in providers:
        results: list[dict[str, object]] = []
        for case in cases:
            try:
                results.append(run_case(provider, case))
            except DetectorUnavailable as exc:
                results.append(
                    {
                        "case": case.name,
                        "provider": provider,
                        "status": "error",
                        "error": str(exc),
                    }
                )
        runs.append(
            {
                "provider": provider,
                "cases": results,
                "summary": summarize_results(results),
            }
        )

    payload = {
        "sampleRate": SR,
        "providers": providers,
        "runs": runs,
    }
    if args.strict:
        failures = validate_runs(runs, load_expectations())
        payload["gate"] = {
            "ok": len(failures) == 0,
            "failures": failures,
            "expectationsPath": str(EXPECTATIONS_PATH),
        }
    print(json.dumps(payload, indent=2 if args.pretty else None, ensure_ascii=False))
    if args.strict and payload["gate"]["failures"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
