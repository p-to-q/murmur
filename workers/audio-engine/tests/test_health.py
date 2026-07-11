"""Health endpoint and readiness tests for the audio-engine worker."""

import os
import sys
import unittest
from unittest.mock import patch

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
