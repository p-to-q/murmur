"""Tests for the transport-level music quality gate."""

import io
import math
import os
import struct
import sys
import unittest
import wave

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import engine
from quality_gate import analyze_wav


def _wav_from_samples(samples: list[int], sample_rate: int = 48_000) -> bytes:
    target = io.BytesIO()
    stereo_samples = [sample for sample in samples for _ in range(2)]
    with wave.open(target, "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(struct.pack(f"<{len(stereo_samples)}h", *stereo_samples))
    return target.getvalue()


def _tone(
    duration: float,
    amplitude: float = 0.3,
    sample_rate: int = 48_000,
) -> list[int]:
    return [
        round(amplitude * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
        for index in range(round(duration * sample_rate))
    ]


class QualityGateTest(unittest.TestCase):
    def test_accepts_a_normal_tone(self):
        result = analyze_wav(_wav_from_samples(_tone(2)), 2)

        self.assertTrue(result["passed"])
        self.assertGreater(result["metrics"]["rms_dbfs"], -20)
        self.assertLess(result["metrics"]["crest_factor_db"], 6.1)
        self.assertEqual(result["metrics"]["quiet_window_ratio"], 0)

    def test_accepts_a_playable_mock_clip(self):
        result = analyze_wav(engine.mock_clip("warm piano", 2), 2)
        self.assertTrue(result["passed"])
        self.assertGreater(result["metrics"]["active_ratio"], 0.12)

    def test_rejects_a_low_level_tone(self):
        result = analyze_wav(_wav_from_samples(_tone(2, amplitude=0.012)), 2)

        self.assertFalse(result["passed"])
        self.assertIn("low_average_level", result["failures"])
        self.assertLess(result["metrics"]["rms_dbfs"], -34)

    def test_rejects_audio_with_only_an_opening_fragment(self):
        samples = _tone(0.3) + [0] * round(1.7 * 48_000)
        result = analyze_wav(_wav_from_samples(samples), 2)

        self.assertFalse(result["passed"])
        self.assertNotIn("mostly_silent", result["failures"])
        self.assertIn("excessive_quiet_windows", result["failures"])
        self.assertIn("prolonged_silence", result["failures"])
        self.assertAlmostEqual(result["metrics"]["quiet_window_ratio"], 0.85)

    def test_rejects_a_peak_spike_over_a_weak_body(self):
        samples = _tone(2, amplitude=0.05)
        samples[len(samples) // 2] = round(0.95 * 32767)
        result = analyze_wav(_wav_from_samples(samples), 2)

        self.assertFalse(result["passed"])
        self.assertNotIn("low_average_level", result["failures"])
        self.assertIn("excessive_crest_factor", result["failures"])
        self.assertGreater(result["metrics"]["crest_factor_db"], 26)

    def test_accepts_a_short_natural_silence(self):
        samples = _tone(2)
        silence_start = round(0.8 * 48_000)
        silence_end = round(1.1 * 48_000)
        samples[silence_start:silence_end] = [0] * (silence_end - silence_start)
        result = analyze_wav(_wav_from_samples(samples), 2)

        self.assertTrue(result["passed"])
        self.assertAlmostEqual(result["metrics"]["longest_quiet_run_seconds"], 0.3)
        self.assertEqual(result["metrics"]["interior_dropout_count"], 0)

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

    def test_rejects_truncated_pcm_data(self):
        blob = bytearray(engine.mock_clip("warm piano", 2))
        del blob[-1]
        result = analyze_wav(bytes(blob), 2)
        self.assertFalse(result["passed"])
        self.assertIn("invalid_audio_data", result["failures"])


if __name__ == "__main__":
    unittest.main()
