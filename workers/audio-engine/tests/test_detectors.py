import os
import unittest
from types import ModuleType
from unittest.mock import patch

from audio_engine.detectors import (
    DetectorConfig,
    DetectorUnavailable,
    PitchDetection,
    configured_pitch_provider,
    detect_pitch,
)


class DetectorSelectionTests(unittest.TestCase):
    def test_default_provider_is_auto(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_pitch_provider(), "auto")

    def test_explicit_pyin_provider_is_supported(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "pyin"}):
            self.assertEqual(configured_pitch_provider(), "pyin")

    def test_explicit_swiftf0_provider_is_supported(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "swiftf0"}):
            self.assertEqual(configured_pitch_provider(), "swiftf0")

    def test_explicit_swiftf0_provider_fails_loudly_when_unavailable(self):
        swift_module = ModuleType("audio_engine.swift_f0_provider")
        swift_module.detect_swiftf0 = fail_swiftf0

        with patch.dict("sys.modules", {"audio_engine.swift_f0_provider": swift_module}):
            with self.assertRaisesRegex(DetectorUnavailable, "SwiftF0"):
                detect_pitch(
                    object(),
                    DetectorConfig(
                        provider="swiftf0",
                        sample_rate=22050,
                        fmin=75,
                        fmax=1050,
                        frame_length=2048,
                        hop_length=512,
                    ),
                )

    def test_auto_provider_falls_back_to_pyin_when_swiftf0_is_unavailable(self):
        swift_module = ModuleType("audio_engine.swift_f0_provider")
        swift_module.detect_swiftf0 = fail_swiftf0
        pyin_module = ModuleType("audio_engine.pyin_provider")
        pyin_module.detect_pyin = return_empty_pyin

        with patch.dict(
            "sys.modules",
            {
                "audio_engine.swift_f0_provider": swift_module,
                "audio_engine.pyin_provider": pyin_module,
            },
        ):
            result = detect_pitch(
                object(),
                DetectorConfig(
                    provider="auto",
                    sample_rate=22050,
                    fmin=75,
                    fmax=1050,
                    frame_length=2048,
                    hop_length=512,
                ),
            )

        self.assertEqual(result.provider, "pyin")
        self.assertIn("swiftf0_unavailable:SwiftF0 missing", result.warnings)

    def test_explicit_pyin_provider_uses_pyin_detector(self):
        pyin_module = ModuleType("audio_engine.pyin_provider")
        pyin_module.detect_pyin = return_empty_pyin

        with patch.dict("sys.modules", {"audio_engine.pyin_provider": pyin_module}):
            result = detect_pitch(
                object(),
                DetectorConfig(
                    provider="pyin",
                    sample_rate=22050,
                    fmin=75,
                    fmax=1050,
                    frame_length=2048,
                    hop_length=512,
                ),
            )

        self.assertEqual(result.provider, "pyin")

    def test_unknown_provider_fails_loudly(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "mystery"}):
            with self.assertRaisesRegex(DetectorUnavailable, "Unsupported"):
                configured_pitch_provider()


def fail_swiftf0(_audio, _config):
    raise DetectorUnavailable("SwiftF0 missing")


def return_empty_pyin(_audio, _config):
    return PitchDetection(
        provider="pyin",
        f0=[],
        voiced=[],
        confidence=[],
        diagnostics={},
        warnings=[],
        sample_rate=22050,
        hop_length=512,
    )


if __name__ == "__main__":
    unittest.main()
