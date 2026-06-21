import importlib.util
import io
import math
import struct
import unittest
import wave
from unittest.mock import patch


def has_worker_deps() -> bool:
    return all(
        importlib.util.find_spec(module) is not None
        for module in ("fastapi", "librosa", "numpy", "soundfile")
    )


def raise_detector_unavailable(message: str):
    from audio_engine.detectors import DetectorUnavailable

    raise DetectorUnavailable(message)


@unittest.skipUnless(has_worker_deps(), "audio worker runtime deps are not installed")
class WorkerPipelineTests(unittest.TestCase):
    def test_auto_ensemble_can_pick_pyin_when_it_scores_better(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 392.0, 261.63, 392.0],
            voiced=[True, True, True, True],
            confidence=[0.58, 0.57, 0.56, 0.55],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        pyin_detection = PitchDetection(
            provider="pyin",
            timestamps=[0.00, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14],
            f0=[261.63, 261.7, 261.6, 261.65, 293.66, 293.7, 293.6, 293.68],
            voiced=[True, True, True, True, True, True, True, True],
            confidence=[0.92, 0.93, 0.91, 0.92, 0.94, 0.95, 0.94, 0.95],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            return swift_detection if config.provider == "swiftf0" else pyin_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "swiftf0":
                return [
                    ("balanced", [{"pitch": 60, "start": 0.0, "duration": 0.22, "velocity": 0.6, "confidence": 0.58}], {
                        "score": 0.54,
                        "musicFeelScore": 0.61,
                        "excessiveHoldRatio": 0.0,
                        "interiorHoldRatio": 0.0,
                        "onsetFragmentation": 0.0,
                        "firstOnsetLag": 0.18,
                    }, 2.2)
                ], None
            return [
                ("rescue", [
                    {"pitch": 60, "start": 0.0, "duration": 0.22, "velocity": 0.8, "confidence": 0.92},
                    {"pitch": 62, "start": 0.24, "duration": 0.22, "velocity": 0.82, "confidence": 0.94},
                ], {
                    "score": 0.86,
                    "musicFeelScore": 0.83,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.0,
                    "firstOnsetLag": 0.0,
                }, 3.8)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "pyin")
        self.assertGreaterEqual(len(notes), 1)
        self.assertTrue(any("ensemble_pick:pyin" in warning for warning in detection.warnings))

    def test_auto_ensemble_can_fast_path_rmvpe_when_it_is_already_strong(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        rmvpe_detection = PitchDetection(
            provider="rmvpe",
            timestamps=[0.0, 0.01, 0.02, 0.03],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.94, 0.95, 0.94, 0.93],
            diagnostics={"pitchMs": 86},
            warnings=[],
            sample_rate=16000,
            hop_length=160,
        )

        def fake_detect(_audio, config):
            if config.provider in {"swiftf0", "pyin"}:
                raise AssertionError("alternate providers should not run when rmvpe fast-path triggers")
            return rmvpe_detection

        def fake_collect(_detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            return [
                ("balanced", [
                    {"pitch": 60, "start": 0.0, "duration": 0.24, "velocity": 0.84, "confidence": 0.93},
                    {"pitch": 62, "start": 0.24, "duration": 0.24, "velocity": 0.84, "confidence": 0.94},
                ], {
                    "score": 0.85,
                    "musicFeelScore": 0.79,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.08,
                    "firstOnsetLag": 0.0,
                }, 3.48)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "rmvpe")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["ensembleDecision"], "rmvpe_fast_path")
        self.assertFalse(detection.diagnostics["providerRerouted"])
        self.assertEqual(detection.diagnostics["providerPitchMs"], 86)

    def test_auto_ensemble_can_fall_back_from_weak_rmvpe_to_swiftf0(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        rmvpe_detection = PitchDetection(
            provider="rmvpe",
            timestamps=[0.0, 0.01, 0.02, 0.03],
            f0=[261.63, 392.0, 261.63, 392.0],
            voiced=[True, True, True, True],
            confidence=[0.42, 0.4, 0.41, 0.39],
            diagnostics={"pitchMs": 90},
            warnings=[],
            sample_rate=16000,
            hop_length=160,
        )
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.9, 0.91, 0.9, 0.89],
            diagnostics={"pitchMs": 120},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                return rmvpe_detection
            if config.provider == "swiftf0":
                return swift_detection
            raise_detector_unavailable("pYIN missing")

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "rmvpe":
                return [
                    ("balanced", [{"pitch": 60, "start": 0.0, "duration": 0.12, "velocity": 0.4, "confidence": 0.4}], {
                        "score": 0.42,
                        "musicFeelScore": 0.43,
                        "excessiveHoldRatio": 0.0,
                        "interiorHoldRatio": 0.0,
                        "onsetFragmentation": 0.5,
                        "firstOnsetLag": 0.18,
                    }, 1.8)
                ], "acceptance_low"
            return [
                ("balanced", [
                    {"pitch": 60, "start": 0.0, "duration": 0.24, "velocity": 0.82, "confidence": 0.9},
                    {"pitch": 62, "start": 0.24, "duration": 0.24, "velocity": 0.83, "confidence": 0.91},
                ], {
                    "score": 0.84,
                    "musicFeelScore": 0.78,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.08,
                    "firstOnsetLag": 0.0,
                }, 3.46)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["ensembleSelected"], "swiftf0/balanced")
        self.assertTrue(any("ensemble_pick:swiftf0" in warning for warning in detection.warnings))

    def test_auto_ensemble_can_fast_path_swiftf0_when_it_is_already_strong(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.91, 0.92, 0.91, 0.9],
            diagnostics={"pitchMs": 120},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            if config.provider == "pyin":
                raise AssertionError("pyin should not run when swift fast-path triggers")
            return swift_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            return [
                ("agile", [
                    {"pitch": 60, "start": 0.0, "duration": 0.24, "velocity": 0.82, "confidence": 0.9},
                    {"pitch": 62, "start": 0.24, "duration": 0.24, "velocity": 0.83, "confidence": 0.91},
                ], {
                    "score": 0.84,
                    "musicFeelScore": 0.78,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.08,
                    "firstOnsetLag": 0.0,
                }, 3.46)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["ensembleDecision"], "swift_fast_path")
        self.assertTrue(detection.diagnostics["providerRerouted"])
        self.assertEqual(detection.diagnostics["providerPitchMs"], 120)

    def test_auto_ensemble_can_long_take_fast_path_swiftf0_when_it_is_clearly_good_enough(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        timestamps = [index * 0.02 for index in range(500)]
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.9] * len(timestamps),
            diagnostics={"pitchMs": 124},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            if config.provider == "pyin":
                raise AssertionError("pyin should not run when long-take swift fast-path triggers")
            return swift_detection

        def fake_collect(_detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            return [
                ("steady_octave_up", [
                    {"pitch": 60, "start": 0.0, "duration": 0.32, "velocity": 0.82, "confidence": 0.9},
                    {"pitch": 62, "start": 0.34, "duration": 0.28, "velocity": 0.83, "confidence": 0.91},
                ], {
                    "score": 0.81,
                    "musicFeelScore": 0.71,
                    "excessiveHoldRatio": 0.02,
                    "interiorHoldRatio": 0.08,
                    "onsetFragmentation": 0.19,
                    "firstOnsetLag": 0.0,
                }, 3.62)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["ensembleDecision"], "swift_long_take_fast_path")
        self.assertTrue(detection.diagnostics["providerRerouted"])
        self.assertEqual(detection.diagnostics["providerPitchMs"], 124)

    def test_auto_ensemble_can_use_light_alternate_review_for_long_swiftf0_led_takes(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        timestamps = [index * 0.02 for index in range(1200)]
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.9] * len(timestamps),
            diagnostics={"pitchMs": 420},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        pyin_detection = PitchDetection(
            provider="pyin",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.88] * len(timestamps),
            diagnostics={"pitchMs": 900},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            return swift_detection if config.provider == "swiftf0" else pyin_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "swiftf0":
                return [
                    ("steady", [
                        {"pitch": 60, "start": 0.0, "duration": 0.3, "velocity": 0.82, "confidence": 0.9},
                        {"pitch": 62, "start": 0.32, "duration": 0.28, "velocity": 0.83, "confidence": 0.91},
                    ], {
                        "score": 0.78,
                        "musicFeelScore": 0.72,
                        "excessiveHoldRatio": 0.04,
                        "interiorHoldRatio": 0.08,
                        "onsetFragmentation": 0.22,
                        "firstOnsetLag": 0.04,
                    }, 2.98)
                ], None
            if allow_repair_rerun:
                raise AssertionError("pyin should be reviewed in light mode without repair rerun")
            return [
                ("steady", [
                    {"pitch": 60, "start": 0.0, "duration": 0.3, "velocity": 0.8, "confidence": 0.88},
                    {"pitch": 62, "start": 0.32, "duration": 0.28, "velocity": 0.8, "confidence": 0.88},
                ], {
                    "score": 0.71,
                    "musicFeelScore": 0.69,
                    "excessiveHoldRatio": 0.05,
                    "interiorHoldRatio": 0.09,
                    "onsetFragmentation": 0.24,
                    "firstOnsetLag": 0.05,
                }, 2.61)
            ], "interior_hold"

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["alternateReviewMode"], "light_no_repair")
        self.assertEqual(detection.diagnostics["ensembleDecision"], "highest_score")

    def test_auto_ensemble_can_use_compact_light_alternate_review_for_medium_swiftf0_led_takes(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        timestamps = [index * 0.02 for index in range(700)]
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.9] * len(timestamps),
            diagnostics={"pitchMs": 185},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        pyin_detection = PitchDetection(
            provider="pyin",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.87] * len(timestamps),
            diagnostics={"pitchMs": 940},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            return swift_detection if config.provider == "swiftf0" else pyin_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "swiftf0":
                return [
                    ("steady_octave_up", [
                        {"pitch": 60, "start": 0.0, "duration": 0.3, "velocity": 0.82, "confidence": 0.9},
                        {"pitch": 62, "start": 0.32, "duration": 0.28, "velocity": 0.83, "confidence": 0.91},
                    ], {
                        "score": 0.81,
                        "musicFeelScore": 0.74,
                        "rushedRatio": 0.42,
                        "excessiveHoldRatio": 0.0,
                        "interiorHoldRatio": 0.03,
                        "onsetFragmentation": 0.2,
                        "firstOnsetLag": 0.0,
                    }, 3.12)
                ], None
            if allow_repair_rerun:
                raise AssertionError("pyin should be reviewed in compact light mode without repair rerun")
            self.assertEqual(allowed_base_hypothesis_ids, {"steady", "balanced", "rescue"})
            return [
                ("steady", [
                    {"pitch": 60, "start": 0.0, "duration": 0.3, "velocity": 0.8, "confidence": 0.88},
                    {"pitch": 62, "start": 0.32, "duration": 0.28, "velocity": 0.8, "confidence": 0.88},
                ], {
                    "score": 0.72,
                    "musicFeelScore": 0.69,
                    "rushedRatio": 0.44,
                    "excessiveHoldRatio": 0.02,
                    "interiorHoldRatio": 0.04,
                    "onsetFragmentation": 0.22,
                    "firstOnsetLag": 0.04,
                }, 2.64)
            ], "interior_hold"

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(
            detection.diagnostics["alternateReviewMode"],
            "light_no_repair_compact",
        )
        self.assertEqual(detection.diagnostics["ensembleDecision"], "highest_score")

    def test_auto_ensemble_can_use_general_light_alternate_review_for_swiftf0_led_takes(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        timestamps = [index * 0.02 for index in range(1100)]
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.92] * len(timestamps),
            diagnostics={"pitchMs": 246, "proposalUrgentRatio": 0.14},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        pyin_detection = PitchDetection(
            provider="pyin",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.87] * len(timestamps),
            diagnostics={"pitchMs": 1015},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            return swift_detection if config.provider == "swiftf0" else pyin_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "swiftf0":
                return [
                    ("steady_octave_up", [
                        {"pitch": 60, "start": 0.0, "duration": 0.16, "velocity": 0.82, "confidence": 0.91},
                        {"pitch": 62, "start": 0.18, "duration": 0.16, "velocity": 0.83, "confidence": 0.92},
                    ], {
                        "score": 0.81,
                        "musicFeelScore": 0.79,
                        "rushedRatio": 0.51,
                        "excessiveHoldRatio": 0.0,
                        "interiorHoldRatio": 0.02,
                        "onsetFragmentation": 0.09,
                        "firstOnsetLag": 0.0,
                    }, 3.14)
                ], None
            if allow_repair_rerun:
                raise AssertionError("pyin should be reviewed in general light mode without repair rerun")
            self.assertEqual(allowed_base_hypothesis_ids, {"steady", "balanced"})
            return [
                ("steady", [
                    {"pitch": 60, "start": 0.0, "duration": 0.15, "velocity": 0.8, "confidence": 0.88},
                    {"pitch": 62, "start": 0.17, "duration": 0.15, "velocity": 0.8, "confidence": 0.88},
                ], {
                    "score": 0.77,
                    "musicFeelScore": 0.74,
                    "rushedRatio": 0.51,
                    "excessiveHoldRatio": 0.01,
                    "interiorHoldRatio": 0.03,
                    "onsetFragmentation": 0.14,
                    "firstOnsetLag": 0.03,
                }, 2.52)
            ], "urgent_coherence"

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(
            detection.diagnostics["alternateReviewMode"],
            "light_no_repair_general",
        )
        self.assertEqual(
            detection.diagnostics["alternateReviewHypotheses"],
            "balanced,steady",
        )
        self.assertEqual(detection.diagnostics["ensembleDecision"], "highest_score")

    def test_auto_ensemble_can_use_hold_light_alternate_review_for_hold_sensitive_swiftf0_led_takes(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        timestamps = [index * 0.02 for index in range(1300)]
        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.93] * len(timestamps),
            diagnostics={"pitchMs": 520, "proposalUrgentRatio": 0.05},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        pyin_detection = PitchDetection(
            provider="pyin",
            timestamps=timestamps,
            f0=[261.63] * len(timestamps),
            voiced=[True] * len(timestamps),
            confidence=[0.87] * len(timestamps),
            diagnostics={"pitchMs": 1040},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "rmvpe":
                raise_detector_unavailable("RMVPE missing")
            return swift_detection if config.provider == "swiftf0" else pyin_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            if detection.provider == "swiftf0":
                return [
                    ("steady", [
                        {"pitch": 60, "start": 0.0, "duration": 0.52, "velocity": 0.82, "confidence": 0.91},
                        {"pitch": 62, "start": 0.54, "duration": 0.8, "velocity": 0.83, "confidence": 0.92},
                    ], {
                        "score": 0.84,
                        "musicFeelScore": 0.79,
                        "rushedRatio": 0.26,
                        "excessiveHoldRatio": 0.12,
                        "interiorHoldRatio": 0.22,
                        "onsetFragmentation": 0.5,
                        "firstOnsetLag": 0.01,
                    }, 3.18)
                ], "interior_hold"
            if allow_repair_rerun:
                raise AssertionError("pyin should be reviewed in hold light mode without repair rerun")
            self.assertEqual(allowed_base_hypothesis_ids, {"steady", "balanced"})
            return [
                ("steady", [
                    {"pitch": 60, "start": 0.0, "duration": 0.5, "velocity": 0.8, "confidence": 0.88},
                    {"pitch": 62, "start": 0.52, "duration": 0.78, "velocity": 0.8, "confidence": 0.88},
                ], {
                    "score": 0.77,
                    "musicFeelScore": 0.73,
                    "rushedRatio": 0.24,
                    "excessiveHoldRatio": 0.11,
                    "interiorHoldRatio": 0.2,
                    "onsetFragmentation": 0.48,
                    "firstOnsetLag": 0.02,
                }, 2.74)
            ], "interior_hold"

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "auto")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(
            detection.diagnostics["alternateReviewMode"],
            "light_no_repair_hold",
        )
        self.assertEqual(
            detection.diagnostics["alternateReviewHypotheses"],
            "balanced,steady",
        )
        self.assertEqual(detection.diagnostics["ensembleDecision"], "highest_score")

    def test_explicit_provider_does_not_reroute_after_acceptance_repair_review(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 261.63, 261.63, 261.63],
            voiced=[True, True, True, True],
            confidence=[0.61, 0.62, 0.63, 0.62],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider != "swiftf0":
                raise AssertionError("explicit provider probes should not run alternates")
            return swift_detection

        def fake_collect(detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            return [
                ("balanced", [{"pitch": 60, "start": 0.0, "duration": 0.88, "velocity": 0.64, "confidence": 0.61}], {
                    "score": 0.41,
                    "musicFeelScore": 0.46,
                    "excessiveHoldRatio": 0.42,
                    "onsetFragmentation": 0.0,
                    "firstOnsetLag": 0.0,
                }, 1.4)
            ], "interior_hold"

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "swiftf0")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 1)
        self.assertFalse(detection.diagnostics["providerRerouted"])
        self.assertEqual(detection.diagnostics["ensembleDecision"], "configured_provider")
        self.assertFalse(
            any("provider_reroute:swiftf0->pyin" in warning for warning in detection.warnings)
        )

    def test_explicit_swiftf0_can_fast_path_without_alternate_review(self):
        from audio_engine.detectors import PitchDetection
        from main import detect_with_optional_ensemble

        swift_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.92, 0.93, 0.91, 0.9],
            diagnostics={"pitchMs": 118},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_detect(_audio, config):
            if config.provider == "pyin":
                raise AssertionError("pyin should not run when explicit swift fast-path triggers")
            return swift_detection

        def fake_collect(_detection, *, allow_repair_rerun=True, allowed_base_hypothesis_ids=None):
            return [
                ("agile", [
                    {"pitch": 60, "start": 0.0, "duration": 0.24, "velocity": 0.82, "confidence": 0.9},
                    {"pitch": 62, "start": 0.24, "duration": 0.24, "velocity": 0.83, "confidence": 0.91},
                ], {
                    "score": 0.84,
                    "musicFeelScore": 0.78,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.08,
                    "firstOnsetLag": 0.0,
                }, 3.46)
            ], None

        with (
            patch("main.detect_pitch", side_effect=fake_detect),
            patch("main.collect_note_candidates", side_effect=fake_collect),
        ):
            detection, notes = detect_with_optional_ensemble([0.0] * 100, "swiftf0")

        self.assertEqual(detection.provider, "swiftf0")
        self.assertEqual(len(notes), 2)
        self.assertEqual(detection.diagnostics["ensembleDecision"], "configured_fast_path")
        self.assertEqual(detection.diagnostics["providerPitchMs"], 118)
        self.assertFalse(detection.diagnostics["providerRerouted"])

    def test_collect_note_candidates_records_glide_proposal_profile(self):
        from audio_engine.detectors import PitchDetection
        from main import collect_note_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(8)],
            f0=[261.63, 268.0, 277.0, 293.66, 302.0, 311.0, 329.63, 329.63],
            voiced=[True] * 8,
            confidence=[0.86, 0.87, 0.88, 0.89, 0.88, 0.87, 0.9, 0.9],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        candidates, _repair_reason = collect_note_candidates(detection)

        self.assertGreaterEqual(len(candidates), 1)
        self.assertEqual(detection.diagnostics["noteProposalProfile"], "glide")
        self.assertIn("glide_guarded", detection.diagnostics["noteProposalCandidates"])

    def test_collect_note_candidates_repair_pass_only_builds_repair_hypotheses(self):
        from audio_engine.detectors import PitchDetection
        from main import collect_note_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 261.63, 261.63, 261.63],
            voiced=[True, True, True, True],
            confidence=[0.61, 0.62, 0.63, 0.62],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        build_calls: list[tuple[bool, tuple[str, ...]]] = []

        def fake_build(_detection, extra_hypotheses=(), *, include_base_hypotheses=True, allowed_hypothesis_ids=None):
            ids = tuple(str(item["id"]) for item in extra_hypotheses)
            build_calls.append((include_base_hypotheses, ids))
            if include_base_hypotheses:
                return [
                    ("balanced", [{"pitch": 60, "start": 0.0, "duration": 0.88, "velocity": 0.64, "confidence": 0.61}], {
                        "score": 0.41,
                        "musicFeelScore": 0.46,
                        "excessiveHoldRatio": 0.42,
                        "interiorHoldRatio": 0.42,
                        "onsetFragmentation": 0.0,
                        "firstOnsetLag": 0.0,
                    }, 1.4)
                ]
            return [
                ("repair_split", [
                    {"pitch": 60, "start": 0.0, "duration": 0.18, "velocity": 0.78, "confidence": 0.9},
                    {"pitch": 62, "start": 0.2, "duration": 0.18, "velocity": 0.8, "confidence": 0.91},
                ], {
                    "score": 0.83,
                    "musicFeelScore": 0.81,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.0,
                    "firstOnsetLag": 0.0,
                }, 4.2)
            ]

        with patch("main.build_note_hypotheses", side_effect=fake_build):
            candidates, repair_reason = collect_note_candidates(detection)

        self.assertEqual(repair_reason, "acceptance_low")
        self.assertEqual(candidates[0][0], "repair_split")
        self.assertEqual(
            build_calls,
            [
                (True, ()),
                (False, ("repair_split", "repair_guarded")),
            ],
        )

    def test_collect_note_candidates_adds_urgent_hypothesis_on_urgent_coherence_repair(self):
        from audio_engine.detectors import PitchDetection
        from main import collect_note_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.91, 0.92, 0.91, 0.9],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        build_calls: list[tuple[bool, tuple[str, ...]]] = []

        def fake_build(_detection, extra_hypotheses=(), *, include_base_hypotheses=True, allowed_hypothesis_ids=None):
            ids = tuple(str(item["id"]) for item in extra_hypotheses)
            build_calls.append((include_base_hypotheses, ids))
            if include_base_hypotheses:
                return [
                    ("balanced", [
                        {"pitch": 67, "start": 0.08, "duration": 0.144, "velocity": 0.812, "confidence": 0.955},
                        {"pitch": 69, "start": 0.272, "duration": 0.192, "velocity": 0.82, "confidence": 0.965},
                        {"pitch": 67, "start": 0.464, "duration": 0.208, "velocity": 0.812, "confidence": 0.955},
                        {"pitch": 64, "start": 0.672, "duration": 0.096, "velocity": 0.807, "confidence": 0.949},
                        {"pitch": 62, "start": 0.864, "duration": 0.176, "velocity": 0.827, "confidence": 0.973},
                    ], {
                        "score": 0.82,
                        "musicFeelScore": 0.743,
                        "rushedRatio": 0.4,
                        "urgentCoherence": 0.162,
                        "noteDensity": 4.593,
                        "excessiveHoldRatio": 0.0,
                        "interiorHoldRatio": 0.0,
                        "onsetFragmentation": 0.0,
                        "firstOnsetLag": 0.0,
                    }, 3.33)
                ]
            return [
                ("urgent_attack", [
                    {"pitch": 67, "start": 0.08, "duration": 0.158, "velocity": 0.812, "confidence": 0.955},
                    {"pitch": 69, "start": 0.272, "duration": 0.163, "velocity": 0.82, "confidence": 0.965},
                    {"pitch": 67, "start": 0.464, "duration": 0.163, "velocity": 0.812, "confidence": 0.955},
                    {"pitch": 64, "start": 0.672, "duration": 0.158, "velocity": 0.807, "confidence": 0.949},
                    {"pitch": 62, "start": 0.864, "duration": 0.163, "velocity": 0.827, "confidence": 0.973},
                ], {
                    "score": 0.86,
                    "musicFeelScore": 0.81,
                    "rushedRatio": 0.4,
                    "urgentCoherence": 0.31,
                    "noteDensity": 4.593,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.0,
                    "firstOnsetLag": 0.0,
                }, 3.52)
            ]

        with patch("main.build_note_hypotheses", side_effect=fake_build):
            candidates, repair_reason = collect_note_candidates(detection)

        self.assertEqual(repair_reason, "urgent_coherence")
        self.assertEqual(candidates[0][0], "urgent_attack")
        self.assertEqual(
            build_calls,
            [
                (True, ()),
                (False, ("urgent_attack", "repair_split", "repair_guarded")),
            ],
        )

    def test_build_note_hypotheses_skips_octave_expansion_for_repair_hypotheses(self):
        from audio_engine.detectors import PitchDetection
        from main import build_note_hypotheses

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[0.0, 0.02, 0.04, 0.06],
            f0=[261.63, 293.66, 329.63, 349.23],
            voiced=[True, True, True, True],
            confidence=[0.91, 0.92, 0.91, 0.9],
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_notes(*_args, **_kwargs):
            return [
                {"pitch": 60, "start": 0.0, "duration": 0.24, "velocity": 0.82, "confidence": 0.9},
                {"pitch": 62, "start": 0.24, "duration": 0.24, "velocity": 0.83, "confidence": 0.91},
            ]

        def fake_acceptance(_detection, _notes):
            return {
                "score": 0.84,
                "musicFeelScore": 0.78,
                "excessiveHoldRatio": 0.0,
                "interiorHoldRatio": 0.0,
                "onsetFragmentation": 0.08,
                "firstOnsetLag": 0.0,
            }

        with (
            patch("main.f0_to_notes", side_effect=fake_notes),
            patch("main.score_note_acceptance", side_effect=fake_acceptance),
            patch("main.score_detection_candidate", return_value=1.6),
            patch("main.score_proposal_fit", return_value=0.0),
            patch(
                "main.build_octave_shift_candidates",
                side_effect=lambda _detection, hypothesis_id, notes: [
                    (f"{hypothesis_id}_octave_up", notes, 0.24)
                ],
            ) as octave_patch,
        ):
            candidates = build_note_hypotheses(
                detection,
                extra_hypotheses=[{
                    "id": "repair_split",
                    "min_note_duration": 0.05,
                    "onset_confirm_frames": 1,
                    "pitch_change_confirm_frames": 1,
                }],
                include_base_hypotheses=False,
            )

        self.assertEqual([candidate[0] for candidate in candidates], ["repair_split"])
        self.assertEqual(octave_patch.call_count, 0)

    def test_collect_note_candidates_promotes_repair_hypothesis_for_overheld_phrase(self):
        from audio_engine.detectors import DetectorConfig, detect_pitch
        from main import FMAX, FMIN, FRAME_LEN, HOP_LEN, SR, collect_note_candidates
        from tools.audio_audit import build_cases

        case = next(case for case in build_cases() if case.name == "overheld_middle_phrase")
        detection = detect_pitch(
            case.signal,
            DetectorConfig(
                provider="pyin",
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )

        candidates, repair_reason = collect_note_candidates(detection)
        best_hypothesis, _notes, acceptance, _score = candidates[0]

        self.assertEqual(repair_reason, "interior_hold")
        self.assertTrue(best_hypothesis.startswith("repair"))
        self.assertEqual(acceptance["interiorHoldRatio"], 0.0)
        self.assertLessEqual(float(acceptance["onsetFragmentation"]), 0.34)

    def test_collect_note_candidates_rewards_coherent_urgent_phrase(self):
        from audio_engine.detectors import DetectorConfig, detect_pitch
        from main import FMAX, FMIN, FRAME_LEN, HOP_LEN, SR, collect_note_candidates
        from tools.audio_audit import build_cases

        case = next(case for case in build_cases() if case.name == "urgent_hook_fragment")
        detection = detect_pitch(
            case.signal,
            DetectorConfig(
                provider="swiftf0",
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )

        candidates, repair_reason = collect_note_candidates(detection)
        _best_hypothesis, _notes, acceptance, _score = candidates[0]

        self.assertIsNone(repair_reason)
        self.assertEqual(candidates[0][0], "balanced")
        self.assertGreater(float(acceptance["urgentCoherence"]), 0.2)
        self.assertGreater(float(acceptance["musicFeelScore"]), 0.8)

    def test_collect_note_candidates_reranks_from_steady_to_glide_when_detail_is_clearly_better(self):
        from audio_engine.detectors import PitchDetection
        from main import collect_note_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(12)],
            f0=[261.63, 268.0, 277.0, 293.66, 302.0, 311.0, 329.63, 338.0, 329.63, 320.0, 311.0, 302.0],
            voiced=[True] * 12,
            confidence=[0.9] * 12,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_build(_detection, extra_hypotheses=(), *, include_base_hypotheses=True, allowed_hypothesis_ids=None):
            if not include_base_hypotheses:
                return []
            return [
                ("steady", [{"pitch": 60, "start": index * 0.24, "duration": 0.24, "velocity": 0.8, "confidence": 0.9} for index in range(18)], {
                    "score": 0.7,
                    "musicFeelScore": 0.69,
                    "rushedRatio": 0.2,
                    "urgentCoherence": 0.0,
                    "noteDensity": 2.0,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.16,
                    "firstOnsetLag": 0.18,
                }, 3.08),
                ("glide_guarded", [{"pitch": 60, "start": index * 0.12, "duration": 0.12, "velocity": 0.8, "confidence": 0.9} for index in range(36)], {
                    "score": 0.73,
                    "musicFeelScore": 0.71,
                    "rushedRatio": 0.24,
                    "urgentCoherence": 0.0,
                    "noteDensity": 3.1,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.14,
                    "firstOnsetLag": 0.05,
                }, 3.02),
            ]

        with patch("main.build_note_hypotheses", side_effect=fake_build):
            candidates, repair_reason = collect_note_candidates(detection)

        self.assertIsNone(repair_reason)
        self.assertEqual(candidates[0][0], "glide_guarded")
        self.assertEqual(detection.diagnostics["detailPreservingRerank"], "steady->glide_guarded:glide")

    def test_collect_note_candidates_reranks_from_steady_to_balanced_when_fragmentation_is_high(self):
        from audio_engine.detectors import PitchDetection
        from main import collect_note_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(16)],
            f0=[110.0, 220.0, 220.0, 196.0, 196.0, 207.65, 196.0, 207.65, 207.65, 196.0, 196.0, 220.0, 220.0, 196.0, 174.61, 164.81],
            voiced=[True] * 16,
            confidence=[0.88] * 16,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        def fake_build(_detection, extra_hypotheses=(), *, include_base_hypotheses=True, allowed_hypothesis_ids=None):
            if not include_base_hypotheses:
                return []
            return [
                ("steady", [{"pitch": 55, "start": index * 0.28, "duration": 0.28, "velocity": 0.8, "confidence": 0.88} for index in range(24)], {
                    "score": 0.86,
                    "musicFeelScore": 0.86,
                    "rushedRatio": 0.26,
                    "urgentCoherence": 0.0,
                    "noteDensity": 1.9,
                    "excessiveHoldRatio": 0.04,
                    "interiorHoldRatio": 0.02,
                    "onsetFragmentation": 0.37,
                    "firstOnsetLag": 0.0,
                }, 3.55),
                ("balanced", [{"pitch": 55, "start": index * 0.18, "duration": 0.18, "velocity": 0.8, "confidence": 0.88} for index in range(36)], {
                    "score": 0.84,
                    "musicFeelScore": 0.81,
                    "rushedRatio": 0.28,
                    "urgentCoherence": 0.0,
                    "noteDensity": 2.5,
                    "excessiveHoldRatio": 0.0,
                    "interiorHoldRatio": 0.0,
                    "onsetFragmentation": 0.26,
                    "firstOnsetLag": 0.0,
                }, 3.22),
            ]

        with patch("main.build_note_hypotheses", side_effect=fake_build):
            candidates, repair_reason = collect_note_candidates(detection)

        self.assertIsNone(repair_reason)
        self.assertEqual(candidates[0][0], "balanced")
        self.assertEqual(detection.diagnostics["detailPreservingRerank"], "steady->balanced:balanced")

    def test_regularize_urgent_phrase_redistributes_short_fragments_into_cleaner_hook(self):
        from main import regularize_urgent_phrase

        notes = [
            {"pitch": 67, "start": 0.08, "duration": 0.144, "velocity": 0.812, "confidence": 0.955},
            {"pitch": 69, "start": 0.272, "duration": 0.192, "velocity": 0.82, "confidence": 0.965},
            {"pitch": 67, "start": 0.464, "duration": 0.208, "velocity": 0.812, "confidence": 0.955},
            {"pitch": 64, "start": 0.672, "duration": 0.096, "velocity": 0.807, "confidence": 0.949},
            {"pitch": 62, "start": 0.864, "duration": 0.176, "velocity": 0.827, "confidence": 0.973},
        ]

        adjusted = regularize_urgent_phrase(notes)
        adjusted_durations = [round(float(note["duration"]), 3) for note in adjusted]

        self.assertEqual(len(adjusted), len(notes))
        self.assertNotEqual(adjusted_durations, [0.144, 0.192, 0.208, 0.096, 0.176])
        self.assertGreaterEqual(min(adjusted_durations), 0.158)
        self.assertLessEqual(max(adjusted_durations) - min(adjusted_durations), 0.012)

    def test_build_octave_shift_candidates_offers_octave_up_variant_for_low_stable_phrase(self):
        from audio_engine.detectors import PitchDetection
        from main import build_octave_shift_candidates

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(64)],
            f0=[110.0, 123.47, 130.81, 146.83, 164.81, 174.61, 196.0, 220.0] * 8,
            voiced=[True] * 64,
            confidence=[0.9] * 64,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        notes = [
            {"pitch": 45, "start": 0.0, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 48, "start": 0.4, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 52, "start": 0.8, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 55, "start": 1.2, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 57, "start": 1.6, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 55, "start": 2.0, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 52, "start": 2.4, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 48, "start": 2.8, "duration": 0.32, "velocity": 0.8, "confidence": 0.9},
        ]

        octave_candidates = build_octave_shift_candidates(detection, "balanced", notes)
        candidate_ids = [candidate_id for candidate_id, _notes, _bonus in octave_candidates]

        self.assertTrue(any(candidate_id.endswith("octave_up") for candidate_id in candidate_ids))
        lifted = next(notes for candidate_id, notes, _bonus in octave_candidates if candidate_id.endswith("octave_up"))
        self.assertTrue(all(int(note["pitch"]) >= 57 for note in lifted))

    def test_score_detection_candidate_penalizes_over_fragmented_long_phrase(self):
        from audio_engine.detectors import PitchDetection
        from main import score_detection_candidate

        detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(400)],
            f0=[261.63] * 400,
            voiced=[True] * 400,
            confidence=[0.9] * 400,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        balanced_notes = [
            {"pitch": 60, "start": 0.0, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 62, "start": 0.5, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 64, "start": 1.0, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 65, "start": 1.5, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 67, "start": 2.0, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
            {"pitch": 69, "start": 2.5, "duration": 0.5, "velocity": 0.8, "confidence": 0.9},
        ]
        fragmented_notes = [
            {
                "pitch": 60 + (index % 3),
                "start": round(index * 0.08, 3),
                "duration": 0.08,
                "velocity": 0.8,
                "confidence": 0.9,
            }
            for index in range(36)
        ]

        balanced_score = score_detection_candidate(detection, balanced_notes)
        fragmented_score = score_detection_candidate(detection, fragmented_notes)

        self.assertGreater(balanced_score, fragmented_score)

    def test_score_detection_candidate_penalizes_oversegmented_long_phrase_more_than_short_hook(self):
        from audio_engine.detectors import PitchDetection
        from main import score_detection_candidate

        long_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(420)],
            f0=[261.63] * 420,
            voiced=[True] * 420,
            confidence=[0.92] * 420,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )
        short_detection = PitchDetection(
            provider="swiftf0",
            timestamps=[i * 0.02 for i in range(68)],
            f0=[261.63] * 68,
            voiced=[True] * 68,
            confidence=[0.92] * 68,
            diagnostics={},
            warnings=[],
            sample_rate=22050,
            hop_length=512,
        )

        oversegmented_long_notes = [
            {
                "pitch": 60 + (index % 4),
                "start": round(index * 0.08, 3),
                "duration": 0.08 if index % 3 else 0.112,
                "velocity": 0.82,
                "confidence": 0.9,
            }
            for index in range(40)
        ]
        coherent_short_hook = [
            {"pitch": 67, "start": 0.08, "duration": 0.144, "velocity": 0.812, "confidence": 0.955},
            {"pitch": 69, "start": 0.272, "duration": 0.16, "velocity": 0.826, "confidence": 0.971},
            {"pitch": 67, "start": 0.464, "duration": 0.208, "velocity": 0.812, "confidence": 0.955},
            {"pitch": 64, "start": 0.672, "duration": 0.096, "velocity": 0.807, "confidence": 0.949},
            {"pitch": 62, "start": 0.864, "duration": 0.176, "velocity": 0.827, "confidence": 0.973},
        ]

        long_score = score_detection_candidate(long_detection, oversegmented_long_notes)
        short_score = score_detection_candidate(short_detection, coherent_short_hook)

        self.assertLess(long_score, short_score)
        less_segmented_long_notes = oversegmented_long_notes[:24]
        for index, note in enumerate(less_segmented_long_notes):
            note["start"] = round(index * 0.14, 3)
            note["duration"] = 0.14
        less_segmented_score = score_detection_candidate(long_detection, less_segmented_long_notes)
        self.assertGreater(less_segmented_score, long_score)

    def test_wobble_helpers_collapse_split_fragments_back_into_stable_notes(self):
        from main import collapse_adjacent_same_pitch, collapse_short_wobble_detours

        notes = [
            {"pitch": 67, "start": 0.032, "duration": 0.32, "velocity": 0.826, "confidence": 0.972},
            {"pitch": 67, "start": 0.344, "duration": 0.04, "velocity": 0.817, "confidence": 0.961},
            {"pitch": 69, "start": 0.832, "duration": 0.304, "velocity": 0.837, "confidence": 0.985},
            {"pitch": 67, "start": 1.217, "duration": 0.368, "velocity": 0.836, "confidence": 0.983},
        ]

        collapsed = collapse_adjacent_same_pitch(notes)
        self.assertEqual([int(note["pitch"]) for note in collapsed], [67, 69, 67])

        repeated_same_pitch = [
            {"pitch": 67, "start": 0.0, "duration": 0.34, "velocity": 0.82, "confidence": 0.97},
            {"pitch": 67, "start": 0.42, "duration": 0.3, "velocity": 0.81, "confidence": 0.96},
            {"pitch": 69, "start": 0.82, "duration": 0.3, "velocity": 0.83, "confidence": 0.98},
        ]
        preserved = collapse_adjacent_same_pitch(repeated_same_pitch)
        self.assertEqual(len(preserved), 3)

        detour_notes = [
            {"pitch": 67, "start": 0.16, "duration": 0.24, "velocity": 0.826, "confidence": 0.972},
            {"pitch": 66, "start": 0.4, "duration": 0.128, "velocity": 0.683, "confidence": 0.803},
            {"pitch": 67, "start": 0.528, "duration": 0.256, "velocity": 0.823, "confidence": 0.968},
            {"pitch": 69, "start": 0.88, "duration": 0.304, "velocity": 0.835, "confidence": 0.982},
            {"pitch": 67, "start": 1.265, "duration": 0.368, "velocity": 0.837, "confidence": 0.984},
        ]
        wobble_collapsed = collapse_short_wobble_detours(detour_notes)
        self.assertEqual([int(note["pitch"]) for note in wobble_collapsed], [67, 69, 67])

    def test_input_quality_helpers_flag_quiet_hot_and_clipped_audio(self):
        from main import (
            estimate_clipping_ratio,
            estimate_peak_dbfs,
            estimate_rms_dbfs,
            collect_input_quality_warnings,
        )

        import numpy as np

        quiet = np.full(2048, 0.01, dtype=np.float32)
        hot = np.full(2048, 0.995, dtype=np.float32)

        quiet_warnings = collect_input_quality_warnings(
            rms_dbfs=estimate_rms_dbfs(quiet),
            peak_dbfs=estimate_peak_dbfs(quiet),
            clipping_ratio=estimate_clipping_ratio(quiet),
            snr=18.0,
        )
        hot_warnings = collect_input_quality_warnings(
            rms_dbfs=estimate_rms_dbfs(hot),
            peak_dbfs=estimate_peak_dbfs(hot),
            clipping_ratio=estimate_clipping_ratio(hot),
            snr=6.5,
        )

        self.assertIn("input_too_quiet", quiet_warnings)
        self.assertIn("input_hot", hot_warnings)
        self.assertIn("input_clipping", hot_warnings)
        self.assertIn("input_noisy", hot_warnings)

    def test_build_contour_payload_serializes_unvoiced_frames_as_null_pitch(self):
        from main import build_contour_payload, SR

        contour = build_contour_payload(
            timestamps=[0.0, 0.02, 0.04],
            f0=[261.63, float("nan"), 293.66],
            confidence=[0.91, 0.12, 0.88],
            voiced=[True, False, True],
            sample_rate=SR,
            hop_length=441,
        )

        self.assertEqual(contour["timestamps"], [0.0, 0.02, 0.04])
        self.assertEqual(contour["pitchHz"], [261.63, None, 293.66])
        self.assertEqual(contour["voiced"], [True, False, True])
        self.assertEqual(contour["confidence"], [0.91, 0.12, 0.88])
        self.assertGreater(contour["hopSeconds"], 0)

    def test_decode_wav_to_mono_22050_float32(self):
        from main import SR, decode_audio

        wav = synth_wav(
            sample_rate=44100,
            channels=2,
            segments=[
                (0.2, 0.0),
                (0.8, 261.63),
                (0.2, 0.0),
            ],
        )

        decoded = decode_audio(wav, "hum.wav")

        self.assertEqual(decoded.ndim, 1)
        self.assertGreater(len(decoded), SR)
        self.assertLess(abs(float(decoded.max()) - 0.35), 0.08)

    def test_trim_silence_reduces_head_and_tail_padding(self):
        from main import SR, trim_silence

        import numpy as np

        silence = np.zeros(int(SR * 0.5), dtype=np.float32)
        tone = 0.25 * np.sin(2 * np.pi * 261.63 * np.arange(int(SR * 0.8)) / SR)
        audio = np.concatenate([silence, tone.astype(np.float32), silence])

        trimmed = trim_silence(audio)

        self.assertLess(len(trimmed), len(audio))
        self.assertGreater(len(trimmed), int(SR * 0.7))

    def test_synthetic_hum_produces_swiftf0_notes_in_auto_mode(self):
        from audio_engine.detectors import DetectorConfig, detect_pitch
        from main import (
            FRAME_LEN,
            FMAX,
            FMIN,
            HOP_LEN,
            SR,
            decode_audio,
            pyin_to_notes,
            trim_silence,
        )

        wav = synth_wav(
            sample_rate=SR,
            channels=1,
            segments=[
                (0.2, 0.0),
                (0.45, 261.63),
                (0.45, 293.66),
                (0.45, 329.63),
                (0.2, 0.0),
            ],
        )
        decoded = trim_silence(decode_audio(wav, "hum.wav"))
        detection = detect_pitch(
            decoded,
            DetectorConfig(
                provider="auto",
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )
        notes = pyin_to_notes(
            detection.f0,
            detection.voiced,
            detection.confidence,
            hop_length=detection.hop_length,
            sample_rate=detection.sample_rate,
        )

        self.assertEqual(detection.provider, "swiftf0")
        self.assertGreaterEqual(len(notes), 2)
        self.assertTrue(any(59 <= note["pitch"] <= 61 for note in notes))
        self.assertTrue(any(61 <= note["pitch"] <= 63 for note in notes))


def synth_wav(
    *,
    sample_rate: int,
    channels: int,
    segments: list[tuple[float, float]],
    amplitude: float = 0.35,
) -> bytes:
    frames = bytearray()
    phase = 0.0

    for duration, frequency in segments:
        sample_count = int(duration * sample_rate)
        for _ in range(sample_count):
            sample = 0.0
            if frequency > 0:
                sample = amplitude * math.sin(phase)
                phase += 2 * math.pi * frequency / sample_rate
            int_sample = max(-32768, min(32767, round(sample * 32767)))
            packed = struct.pack("<h", int_sample)
            for _channel in range(channels):
                frames.extend(packed)

    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(frames))
    return output.getvalue()


if __name__ == "__main__":
    unittest.main()
