"""Health endpoint and readiness tests for the audio-engine worker."""

import os
import sys
import asyncio
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main


class DetectorsReadyTest(unittest.TestCase):
    def setUp(self):
        main._preload_outcomes.clear()

    def test_empty_preload_returns_true(self):
        self.assertTrue(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="auto")
    def test_auto_any_ok_returns_true(self, _provider):
        main._preload_outcomes["rmvpe"] = "model file not found"
        main._preload_outcomes["swiftf0"] = "ok"
        main._preload_outcomes["pyin"] = "ok"
        self.assertTrue(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="auto")
    def test_auto_all_fail_returns_false(self, _provider):
        main._preload_outcomes["rmvpe"] = "model file not found"
        main._preload_outcomes["swiftf0"] = "onnx runtime error"
        main._preload_outcomes["pyin"] = "librosa init failed"
        self.assertFalse(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="rmvpe")
    def test_specific_provider_ok_returns_true(self, _provider):
        main._preload_outcomes["rmvpe"] = "ok"
        main._preload_outcomes["pyin"] = "ok"
        self.assertTrue(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="rmvpe")
    def test_specific_provider_fails_even_if_other_ok(self, _provider):
        main._preload_outcomes["rmvpe"] = "onnx runtime error"
        main._preload_outcomes["pyin"] = "ok"
        self.assertFalse(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="swiftf0")
    def test_pyin_ok_does_not_mask_swiftf0_fail(self, _provider):
        main._preload_outcomes["swiftf0"] = "onnx runtime error"
        main._preload_outcomes["pyin"] = "ok"
        self.assertFalse(main._detectors_ready())

    @patch("main.configured_pitch_provider", return_value="yin")
    def test_unpreloaded_provider_defaults_true(self, _provider):
        main._preload_outcomes["rmvpe"] = "onnx runtime error"
        self.assertTrue(main._detectors_ready())

    def tearDown(self):
        main._preload_outcomes.clear()


class LifespanShutdownTest(unittest.TestCase):
    def test_lifespan_gracefully_shuts_down_transcription_executor(self):
        executor = Mock()
        with (
            patch.object(main, "_TRANSCRIBE_EXECUTOR", executor),
            patch.object(main, "require_worker_token"),
            patch.object(main, "_preload_pitch_model"),
        ):
            async def run_lifespan():
                async with main._lifespan(main.app):
                    pass

            asyncio.run(run_lifespan())

        executor.shutdown.assert_called_once_with(wait=True)


class TranscriptionErrorMappingTest(unittest.TestCase):
    def test_invalid_pitch_provider_uses_worker_safe_client_error(self):
        with self.assertRaises(main.TranscriptionClientError) as raised:
            main.resolve_requested_pitch_provider("unknown")

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["error"], "invalid_pitch_provider")
