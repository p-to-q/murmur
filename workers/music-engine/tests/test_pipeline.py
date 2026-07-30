"""Focused tests for quality retry budgeting."""

import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline


FAILED_QUALITY = {
    "passed": False,
    "failures": ["low_average_level"],
}
PASSED_QUALITY = {
    "passed": True,
    "failures": [],
}


class RetryBudgetTest(unittest.TestCase):
    @patch.object(pipeline, "MAX_QUALITY_ATTEMPTS", 3)
    @patch.object(pipeline, "MAX_TOTAL_GENERATION_SECONDS", 165.0)
    @patch.object(pipeline, "analyze_wav", return_value=FAILED_QUALITY)
    @patch.object(
        pipeline.engine,
        "generate_clip",
        return_value=(b"first-candidate", {"X-Generation-Ms": "239000"}),
    )
    @patch.object(pipeline.time, "monotonic", side_effect=[100.0, 265.0, 265.0])
    def test_exhausted_budget_rejects_before_starting_retry(
        self, _monotonic, generate_clip, _analyze_wav
    ):
        with self.assertRaises(pipeline.PipelineError) as raised:
            pipeline.generate_candidates(
                "warm piano",
                10,
                None,
                0,
                None,
                request_id="budget_exhausted",
                require_hum=False,
                require_melody=False,
            )

        error = raised.exception
        self.assertEqual(error.code, "quality_gate_failed")
        self.assertEqual(error.reason, "quality_retry_budget_exhausted")
        self.assertEqual(generate_clip.call_count, 1)
        self.assertEqual(error.diagnostics["candidate_count"], 1)
        self.assertEqual(
            error.diagnostics["generation_budget"],
            {
                "exhausted": True,
                "budget_ms": 165_000,
                "elapsed_ms": 165_000,
                "remaining_ms": 0,
                "next_attempt": 2,
            },
        )

    @patch.object(pipeline, "MAX_QUALITY_ATTEMPTS", 2)
    @patch.object(pipeline, "MAX_TOTAL_GENERATION_SECONDS", 165.0)
    @patch.object(
        pipeline,
        "analyze_wav",
        side_effect=[FAILED_QUALITY, PASSED_QUALITY],
    )
    @patch.object(
        pipeline.engine,
        "generate_clip",
        side_effect=[
            (b"first-candidate", {"X-Generation-Ms": "120000"}),
            (b"second-candidate", {"X-Generation-Ms": "110000"}),
        ],
    )
    @patch.object(pipeline.time, "monotonic", side_effect=[100.0, 220.0, 330.0])
    def test_remaining_budget_allows_retry(
        self, _monotonic, generate_clip, _analyze_wav
    ):
        result = pipeline.generate_candidates(
            "warm piano",
            10,
            None,
            0,
            None,
            request_id="budget_remaining",
            require_hum=False,
            require_melody=False,
        )

        self.assertEqual(generate_clip.call_count, 2)
        self.assertEqual(result["wav_bytes"], b"second-candidate")
        self.assertEqual(result["diagnostics"]["candidate_count"], 2)


if __name__ == "__main__":
    unittest.main()
