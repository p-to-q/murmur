import importlib
import math
import unittest


def has_deepfilternet_deps() -> bool:
    try:
        import torch  # noqa: F401

        importlib.import_module("df.enhance")
        return True
    except Exception:
        return False


@unittest.skipUnless(
    has_deepfilternet_deps(),
    "DeepFilterNet optional runtime deps are not installed",
)
class DeepFilterNetDenoiseTests(unittest.TestCase):
    def test_deepfilternet_returns_worker_rate_audio(self):
        import numpy as np

        from audio_engine.denoise import DenoiseConfig, denoise_audio
        from main import SR

        rng = np.random.default_rng(42)
        t = np.arange(int(SR * 1.0), dtype=np.float32) / SR
        clean = 0.12 * np.sin(2 * math.pi * 261.63 * t)
        noise = 0.035 * rng.standard_normal(t.shape).astype(np.float32)
        audio = (clean + noise).astype(np.float32)

        result = denoise_audio(
            audio,
            DenoiseConfig(provider="deepfilternet", sample_rate=SR),
        )

        self.assertEqual(result.provider, "deepfilternet")
        self.assertEqual(len(result.audio), len(audio))
        self.assertTrue(np.isfinite(result.audio).all())
        self.assertGreaterEqual(result.diagnostics["denoiseMs"], 0)
        self.assertEqual(result.diagnostics["denoiseProvider"], "deepfilternet")


if __name__ == "__main__":
    unittest.main()
