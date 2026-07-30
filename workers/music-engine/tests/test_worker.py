"""Unit tests for the music-engine worker's pure helpers (no model needed)."""

import io
import os
import sys
import types
import unittest
import wave
from unittest.mock import patch

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

import main
import engine


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


class HumDecodeTest(unittest.TestCase):
    def test_decode_hum_falls_back_to_ffmpeg_transcode(self):
        expected = object()
        calls = []

        class FakeWaveform:
            @classmethod
            def from_file(cls, file):
                calls.append(file.read())
                if len(calls) == 1:
                    raise RuntimeError("format not recognised")
                return expected

        completed = type(
            "Completed",
            (),
            {"stdout": b"RIFFfake-wav", "stderr": b""},
        )()

        fake_magenta = types.ModuleType("magenta_rt")
        fake_audio = types.ModuleType("magenta_rt.audio")
        fake_audio.Waveform = FakeWaveform

        with patch.dict(
            sys.modules,
            {"magenta_rt": fake_magenta, "magenta_rt.audio": fake_audio},
        ), patch("engine.subprocess.run", return_value=completed) as run:
            self.assertIs(main.decode_hum_waveform(b"webm-opus"), expected)

        self.assertEqual(calls, [b"webm-opus", b"RIFFfake-wav"])
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs["input"], b"webm-opus")


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


class MelodyConditioningTest(unittest.TestCase):
    def test_segments_tile_the_clip_and_ignore_invalid_notes(self):
        segments = engine.melody_to_segments({"notes": [
            {"pitch": 60, "start": 0.2, "duration": 0.5},
            {"pitch": 999, "start": 0, "duration": 1},
        ]}, 2.0)
        self.assertEqual(sum(frames for _notes, frames in segments), 50)
        self.assertEqual(sum(1 for notes, _frames in segments if notes is not None), 1)

    def test_no_valid_notes_produces_no_conditioning(self):
        self.assertEqual(engine.melody_to_segments({"notes": [
            {"pitch": 999, "start": 0, "duration": 1},
        ]}, 2.0), [])


if __name__ == "__main__":
    unittest.main()
