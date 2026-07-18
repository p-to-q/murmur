"""Unit tests for the RunPod Serverless handler (mock mode, no model)."""

import base64
import io
import os
import sys
import unittest
import wave

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import handler


class HandlerTest(unittest.TestCase):
    def test_invalid_attempt_configuration_uses_default(self):
        self.assertGreaterEqual(handler.MAX_QUALITY_ATTEMPTS, 1)
        self.assertLessEqual(handler.MAX_QUALITY_ATTEMPTS, 3)

    def test_returns_wav_of_requested_duration(self):
        out = handler.handler({"input": {"prompt": "warm dreamy pads", "duration": 2}})
        self.assertNotIn("error", out)
        self.assertIn("audio_b64", out)
        self.assertEqual(out["sample_rate"], 48_000)  # engine.SAMPLE_RATE
        self.assertTrue(out["quality"]["passed"])
        self.assertEqual(out["quality"]["version"], "music-technical-v1")
        self.assertEqual(out["diagnostics"]["candidate_count"], 1)

        blob = base64.b64decode(out["audio_b64"])
        with wave.open(io.BytesIO(blob)) as reader:
            seconds = reader.getnframes() / reader.getframerate()
            self.assertAlmostEqual(seconds, 2.0, places=2)
            self.assertEqual(reader.getnchannels(), 2)

    def test_missing_prompt_is_an_error(self):
        out = handler.handler({"input": {"duration": 5}})
        self.assertEqual(out.get("error"), "prompt_required")

    def test_duration_is_clamped(self):
        # 999 s clamps to MAX_DURATION (30 s); the clip must not exceed it.
        out = handler.handler({"input": {"prompt": "x", "duration": 999}})
        blob = base64.b64decode(out["audio_b64"])
        with wave.open(io.BytesIO(blob)) as reader:
            seconds = reader.getnframes() / reader.getframerate()
            self.assertLessEqual(seconds, 30.0)

    def test_empty_input_object(self):
        out = handler.handler({})
        self.assertEqual(out.get("error"), "prompt_required")

    def test_returns_a_safe_input_receipt(self):
        out = handler.handler({"input": {
            "prompt": "private prompt",
            "duration": 2,
            "request_id": "mjob_test",
            "melody": {"notes": [{"pitch": 60}]},
        }})
        receipt = out["input_receipt"]
        self.assertEqual(receipt["request_id"], "mjob_test")
        self.assertNotIn("private prompt", str(receipt))
        self.assertEqual(len(receipt["prompt_sha256"]), 64)
        self.assertTrue(receipt["melody_accepted"])


if __name__ == "__main__":
    unittest.main()
