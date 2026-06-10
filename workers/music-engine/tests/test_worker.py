"""Unit tests for the music-engine worker's pure helpers (no model needed)."""

import io
import os
import sys
import unittest
import wave

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

import main


class BlendStyleEmbeddingsTest(unittest.TestCase):
    def test_blend_is_unit_norm(self):
        a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        b = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        out = main.blend_style_embeddings(a, b, 0.5)
        self.assertAlmostEqual(float(np.linalg.norm(out)), 1.0, places=5)
        self.assertGreater(out[0], 0)
        self.assertGreater(out[1], 0)

    def test_mix_zero_keeps_text_direction(self):
        a = np.array([0.0, 2.0], dtype=np.float32)
        b = np.array([1.0, 0.0], dtype=np.float32)
        out = main.blend_style_embeddings(a, b, 0.0)
        self.assertAlmostEqual(float(out[0]), 0.0, places=5)
        self.assertAlmostEqual(float(out[1]), 1.0, places=5)

    def test_shape_mismatch_falls_back_to_text(self):
        a = np.array([1.0, 0.0], dtype=np.float32)
        b = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        out = main.blend_style_embeddings(a, b, 0.5)
        np.testing.assert_array_equal(out, a)


class WavEncodingTest(unittest.TestCase):
    def test_pcm16_wav_roundtrip(self):
        samples = np.zeros((4800, 2), dtype=np.float32)
        samples[:, 0] = 0.5
        blob = main.pcm16_wav_bytes(samples)
        with wave.open(io.BytesIO(blob)) as reader:
            self.assertEqual(reader.getnchannels(), 2)
            self.assertEqual(reader.getframerate(), main.SAMPLE_RATE)
            self.assertEqual(reader.getsampwidth(), 2)
            self.assertEqual(reader.getnframes(), 4800)

    def test_mock_clip_is_valid_wav_of_requested_duration(self):
        blob = main.mock_clip("dreamy synthwave", 2.0)
        with wave.open(io.BytesIO(blob)) as reader:
            seconds = reader.getnframes() / reader.getframerate()
            self.assertAlmostEqual(seconds, 2.0, places=2)
            self.assertEqual(reader.getnchannels(), 2)

    def test_mock_clip_deterministic_per_prompt(self):
        self.assertEqual(main.mock_clip("a", 2.0), main.mock_clip("a", 2.0))
        self.assertNotEqual(main.mock_clip("a", 2.0), main.mock_clip("b", 2.0))


if __name__ == "__main__":
    unittest.main()
