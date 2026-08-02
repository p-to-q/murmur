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
        result = analyze_wav(_wav_from_samples(_tone(2, amplitude=500 / 32767)), 2)

        self.assertFalse(result["passed"])
        self.assertEqual(result["failures"], ["low_average_level"])
        self.assertLess(result["metrics"]["rms_dbfs"], -34)

    def test_accepts_bytes_after_the_declared_riff_payload(self):
        blob = _wav_from_samples(_tone(1)) + b"trailer"
        result = analyze_wav(blob, 1)

        self.assertTrue(result["passed"])

    def test_rejects_riff_sizes_outside_the_file_or_data_payload(self):
        beyond_file = bytearray(_wav_from_samples(_tone(1)))
        struct.pack_into("<I", beyond_file, 4, len(beyond_file))
        self.assertIn(
            "invalid_wav_structure",
            analyze_wav(bytes(beyond_file), 1)["failures"],
        )

        before_data_end = bytearray(_wav_from_samples(_tone(1)))
        struct.pack_into("<I", before_data_end, 4, len(before_data_end) - 9)
        self.assertIn(
            "invalid_wav_structure",
            analyze_wav(bytes(before_data_end), 1)["failures"],
        )

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


class InteriorDropoutTest(unittest.TestCase):
    """A long gap bounded by audio on both sides is a hole, not phrasing."""

    def _clip(self, gap_seconds: float, total: float = 12.0) -> bytes:
        sr = 48_000
        frames = []
        gap_start = (total - gap_seconds) / 2
        for i in range(int(sr * total)):
            t = i / sr
            v = 0.0 if gap_start <= t < gap_start + gap_seconds else 0.3 * math.sin(2 * math.pi * 220 * t)
            s16 = struct.pack("<h", int(v * 32767))
            frames.append(s16)
            frames.append(s16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(b"".join(frames))
        return buf.getvalue()

    def test_rejects_a_long_interior_dropout(self):
        result = analyze_wav(self._clip(1.1), 12.0)
        self.assertIn("interior_dropout", result["failures"])
        self.assertFalse(result["passed"])
        self.assertGreaterEqual(
            result["metrics"]["longest_interior_dropout_seconds"], 1.0
        )

    def test_keeps_short_rests_as_shadow_evidence_only(self):
        result = analyze_wav(self._clip(0.5), 12.0)
        self.assertNotIn("interior_dropout", result["failures"])
        self.assertTrue(result["passed"])
        self.assertEqual(result["metrics"]["interior_dropout_count"], 1)
