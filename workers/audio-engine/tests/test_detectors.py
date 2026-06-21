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

    def test_explicit_rmvpe_provider_is_supported(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "rmvpe"}):
            self.assertEqual(configured_pitch_provider(), "rmvpe")

    def test_light_lab_providers_are_supported(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "yin"}):
            self.assertEqual(configured_pitch_provider(), "yin")
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "parselmouth"}):
            self.assertEqual(configured_pitch_provider(), "parselmouth")

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
        rmvpe_module = ModuleType("audio_engine.rmvpe_provider")
        rmvpe_module.detect_rmvpe = fail_rmvpe
        swift_module = ModuleType("audio_engine.swift_f0_provider")
        swift_module.detect_swiftf0 = fail_swiftf0
        pyin_module = ModuleType("audio_engine.pyin_provider")
        pyin_module.detect_pyin = return_empty_pyin

        with patch.dict(
            "sys.modules",
            {
                "audio_engine.rmvpe_provider": rmvpe_module,
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
        self.assertIn("rmvpe_unavailable:RMVPE missing", result.warnings)
        self.assertIn("swiftf0_unavailable:SwiftF0 missing", result.warnings)

    def test_auto_provider_falls_back_to_swiftf0_when_rmvpe_is_unavailable(self):
        rmvpe_module = ModuleType("audio_engine.rmvpe_provider")
        rmvpe_module.detect_rmvpe = fail_rmvpe
        swift_module = ModuleType("audio_engine.swift_f0_provider")
        swift_module.detect_swiftf0 = return_swiftf0

        with patch.dict(
            "sys.modules",
            {
                "audio_engine.rmvpe_provider": rmvpe_module,
                "audio_engine.swift_f0_provider": swift_module,
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

        self.assertEqual(result.provider, "swiftf0")
        self.assertIn("rmvpe_unavailable:RMVPE missing", result.warnings)

    def test_explicit_rmvpe_provider_uses_rmvpe_detector(self):
        rmvpe_module = ModuleType("audio_engine.rmvpe_provider")
        rmvpe_module.detect_rmvpe = return_rmvpe

        with patch.dict("sys.modules", {"audio_engine.rmvpe_provider": rmvpe_module}):
            result = detect_pitch(
                object(),
                DetectorConfig(
                    provider="rmvpe",
                    sample_rate=22050,
                    fmin=75,
                    fmax=1050,
                    frame_length=2048,
                    hop_length=512,
                ),
            )

        self.assertEqual(result.provider, "rmvpe")

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

    def test_explicit_yin_provider_uses_yin_detector(self):
        yin_module = ModuleType("audio_engine.yin_provider")
        yin_module.detect_yin = return_yin

        with patch.dict("sys.modules", {"audio_engine.yin_provider": yin_module}):
            result = detect_pitch(
                object(),
                DetectorConfig(
                    provider="yin",
                    sample_rate=22050,
                    fmin=75,
                    fmax=1050,
                    frame_length=2048,
                    hop_length=512,
                ),
            )

        self.assertEqual(result.provider, "yin")

    def test_explicit_parselmouth_provider_uses_parselmouth_detector(self):
        parselmouth_module = ModuleType("audio_engine.parselmouth_provider")
        parselmouth_module.detect_parselmouth = return_parselmouth

        with patch.dict("sys.modules", {"audio_engine.parselmouth_provider": parselmouth_module}):
            result = detect_pitch(
                object(),
                DetectorConfig(
                    provider="parselmouth",
                    sample_rate=22050,
                    fmin=75,
                    fmax=1050,
                    frame_length=2048,
                    hop_length=512,
                ),
            )

        self.assertEqual(result.provider, "parselmouth")

    def test_unknown_provider_fails_loudly(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_PITCH_PROVIDER": "mystery"}):
            with self.assertRaisesRegex(DetectorUnavailable, "Unsupported"):
                configured_pitch_provider()


def fail_swiftf0(_audio, _config):
    raise DetectorUnavailable("SwiftF0 missing")


def fail_rmvpe(_audio, _config):
    raise DetectorUnavailable("RMVPE missing")


def return_rmvpe(_audio, _config):
    return PitchDetection(
        provider="rmvpe",
        timestamps=[],
        f0=[],
        voiced=[],
        confidence=[],
        diagnostics={},
        warnings=[],
        sample_rate=16000,
        hop_length=160,
    )


def return_swiftf0(_audio, _config):
    return PitchDetection(
        provider="swiftf0",
        timestamps=[],
        f0=[],
        voiced=[],
        confidence=[],
        diagnostics={},
        warnings=[],
        sample_rate=22050,
        hop_length=512,
    )


def return_empty_pyin(_audio, _config):
    return PitchDetection(
        provider="pyin",
        timestamps=[],
        f0=[],
        voiced=[],
        confidence=[],
        diagnostics={},
        warnings=[],
        sample_rate=22050,
        hop_length=512,
    )


def return_yin(_audio, _config):
    return PitchDetection(
        provider="yin",
        timestamps=[],
        f0=[],
        voiced=[],
        confidence=[],
        diagnostics={},
        warnings=[],
        sample_rate=22050,
        hop_length=512,
    )


def return_parselmouth(_audio, _config):
    return PitchDetection(
        provider="parselmouth",
        timestamps=[],
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
