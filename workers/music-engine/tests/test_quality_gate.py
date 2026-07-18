"""Tests for the transport-level music quality gate."""

import io
import os
import sys
import unittest
import wave

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import engine
from quality_gate import analyze_wav


class QualityGateTest(unittest.TestCase):
    def test_accepts_a_playable_mock_clip(self):
        result = analyze_wav(engine.mock_clip("warm piano", 2), 2)
        self.assertTrue(result["passed"])
        self.assertGreater(result["metrics"]["active_ratio"], 0.12)

    def test_rejects_silence(self):
        target = io.BytesIO()
        with wave.open(target, "wb") as writer:
            writer.setnchannels(2)
            writer.setsampwidth(2)
            writer.setframerate(48_000)
            writer.writeframes(b"\0\0" * 2 * 48_000)
        result = analyze_wav(target.getvalue(), 1)
        self.assertFalse(result["passed"])
        self.assertIn("near_silence", result["failures"])

    def test_rejects_corrupt_transport(self):
        result = analyze_wav(b"not a wav", 2)
        self.assertFalse(result["passed"])
        self.assertIn("invalid_wav", result["failures"])


if __name__ == "__main__":
    unittest.main()
