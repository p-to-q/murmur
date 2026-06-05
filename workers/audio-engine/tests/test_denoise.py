import os
import unittest
from unittest.mock import patch

from audio_engine.denoise import (
    DenoiseConfig,
    DenoiseResult,
    DenoiseUnavailable,
    configured_denoise_provider,
    denoise_audio,
)


class DenoiseSelectionTests(unittest.TestCase):
    def test_default_provider_is_auto(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_denoise_provider(), "auto")

    def test_off_provider_keeps_audio_unchanged(self):
        audio = object()

        result = denoise_audio(
            audio,
            DenoiseConfig(provider="off", sample_rate=22050),
        )

        self.assertEqual(result.provider, "off")
        self.assertIs(result.audio, audio)
        self.assertEqual(result.diagnostics["denoiseMs"], 0)

    def test_auto_provider_falls_back_when_deepfilternet_is_unavailable(self):
        audio = object()

        with patch(
            "audio_engine.denoise.denoise_deepfilternet",
            side_effect=DenoiseUnavailable("missing torch"),
        ):
            result = denoise_audio(
                audio,
                DenoiseConfig(provider="auto", sample_rate=22050),
            )

        self.assertEqual(result.provider, "off")
        self.assertIs(result.audio, audio)
        self.assertIn("deepfilternet_unavailable:missing torch", result.warnings)

    def test_explicit_deepfilternet_provider_fails_loudly(self):
        with patch(
            "audio_engine.denoise.denoise_deepfilternet",
            side_effect=DenoiseUnavailable("missing torchaudio"),
        ):
            with self.assertRaisesRegex(DenoiseUnavailable, "torchaudio"):
                denoise_audio(
                    object(),
                    DenoiseConfig(provider="deepfilternet", sample_rate=22050),
                )

    def test_explicit_deepfilternet_provider_returns_provider_result(self):
        audio = object()
        provider_result = DenoiseResult(
            provider="deepfilternet",
            audio=audio,
            diagnostics={"denoiseMs": 12},
        )

        with patch(
            "audio_engine.denoise.denoise_deepfilternet",
            return_value=provider_result,
        ):
            result = denoise_audio(
                audio,
                DenoiseConfig(provider="deepfilternet", sample_rate=22050),
            )

        self.assertEqual(result.provider, "deepfilternet")
        self.assertIs(result, provider_result)

    def test_unknown_provider_fails_loudly(self):
        with patch.dict(os.environ, {"AUDIO_ENGINE_DENOISE_PROVIDER": "mystery"}):
            with self.assertRaisesRegex(DenoiseUnavailable, "Unsupported"):
                configured_denoise_provider()


if __name__ == "__main__":
    unittest.main()
