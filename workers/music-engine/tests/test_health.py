"""Readiness and shutdown tests for the music-engine HTTP worker."""

import asyncio
import os
import sys
import unittest
from unittest.mock import Mock, patch

os.environ.setdefault("MUSIC_ENGINE_MOCK", "1")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

import main


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_health_returns_503_while_preloaded_model_is_not_ready(self):
        with (
            patch.object(main.engine, "MOCK", False),
            patch.object(main.engine, "PRELOAD", True),
            patch.object(main.engine, "model_loaded", return_value=False),
            patch.object(main.engine, "model_loading", return_value=True),
            patch.object(main.engine, "model_load_error", return_value=None),
        ):
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body["status"], "unavailable")
        self.assertEqual(body["error"], "model_loading")
        self.assertTrue(body["loading"])

    def test_health_returns_503_after_model_load_error(self):
        with (
            patch.object(main.engine, "MOCK", False),
            patch.object(main.engine, "PRELOAD", True),
            patch.object(main.engine, "model_loaded", return_value=False),
            patch.object(main.engine, "model_loading", return_value=False),
            patch.object(
                main.engine,
                "model_load_error",
                return_value="RuntimeError: weights missing",
            ),
        ):
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body["status"], "unavailable")
        self.assertEqual(body["error"], "model_unavailable")
        self.assertEqual(body["loadError"], "RuntimeError: weights missing")

    def test_generate_fast_fails_when_model_load_failed(self):
        with (
            patch.object(main.engine, "MOCK", False),
            patch.object(main.engine, "PRELOAD", True),
            patch.object(main.engine, "model_loaded", return_value=False),
            patch.object(main.engine, "model_loading", return_value=False),
            patch.object(
                main.engine,
                "model_load_error",
                return_value="RuntimeError: weights missing",
            ),
            patch.object(main.engine, "generate_clip") as generate_clip,
        ):
            response = self.client.post(
                "/generate",
                data={"prompt": "warm pads", "duration": "2"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["error"], "model_unavailable")
        generate_clip.assert_not_called()

    def test_generate_maps_lazy_load_failure_to_503(self):
        with (
            patch.object(main.engine, "MOCK", False),
            patch.object(main.engine, "PRELOAD", False),
            patch.object(main.engine, "model_loaded", return_value=False),
            patch.object(main.engine, "model_loading", return_value=False),
            patch.object(main.engine, "model_load_error", side_effect=[None, "RuntimeError: boom"]),
            patch.object(main.engine, "generate_clip", side_effect=RuntimeError("boom")),
        ):
            response = self.client.post(
                "/generate",
                data={"prompt": "warm pads", "duration": "2"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["error"], "model_unavailable")


class LifespanShutdownTest(unittest.TestCase):
    def test_lifespan_gracefully_shuts_down_generation_executor(self):
        executor = Mock()
        with (
            patch.object(main, "_executor", executor),
            patch.object(main, "require_worker_token"),
            patch.object(main.engine, "MOCK", True),
        ):
            async def run_lifespan():
                async with main._lifespan(main.app):
                    pass

            asyncio.run(run_lifespan())

        executor.shutdown.assert_called_once_with(wait=True)


if __name__ == "__main__":
    unittest.main()
