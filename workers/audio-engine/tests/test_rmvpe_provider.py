import os
import unittest
from unittest.mock import patch

import numpy as np

from audio_engine.detectors import DetectorConfig, DetectorUnavailable
from audio_engine.rmvpe_provider import detect_rmvpe, resolve_model_path


class RmvpeProviderTests(unittest.TestCase):
    def test_missing_configured_model_fails_without_hidden_download(self):
        with patch.dict(
            os.environ,
            {
                "AUDIO_ENGINE_RMVPE_MODEL_PATH": "/tmp/murmur-missing-rmvpe-test.onnx",
                "AUDIO_ENGINE_RMVPE_ALLOW_DOWNLOAD": "",
            },
        ):
            with self.assertRaisesRegex(DetectorUnavailable, "RMVPE model is missing"):
                resolve_model_path()

    def test_model_load_errors_are_reported_as_unavailable(self):
        with (
            patch("audio_engine.rmvpe_provider.resolve_model_path", return_value=None),
            patch(
                "audio_engine.rmvpe_provider.get_model",
                side_effect=ImportError("Using SOCKS proxy"),
            ),
        ):
            with self.assertRaisesRegex(
                DetectorUnavailable,
                "RMVPE model could not be loaded",
            ):
                detect_rmvpe(np.zeros(1600, dtype=np.float32), detector_config())

    def test_inference_errors_are_reported_as_unavailable(self):
        with (
            patch("audio_engine.rmvpe_provider.resolve_model_path", return_value=None),
            patch("audio_engine.rmvpe_provider.get_model", return_value=FailingModel()),
        ):
            with self.assertRaisesRegex(DetectorUnavailable, "RMVPE inference failed"):
                detect_rmvpe(np.zeros(1600, dtype=np.float32), detector_config())


class FailingModel:
    def predict(self, *, audio, sr):
        raise RuntimeError("bad inference")


def detector_config():
    return DetectorConfig(
        provider="rmvpe",
        sample_rate=22050,
        fmin=75,
        fmax=1050,
        frame_length=2048,
        hop_length=512,
    )
