"""Auth hardening tests for the speech-engine worker."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main


class WorkerAuthRequiredTest(unittest.TestCase):
    def test_local_loopback_without_token_stays_allowed(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(main.worker_auth_required())
            main.require_worker_token()

    def test_production_requires_token(self):
        with patch.dict(os.environ, {"NODE_ENV": "production"}, clear=True):
            self.assertTrue(main.worker_auth_required())
            with self.assertRaisesRegex(RuntimeError, "SPEECH_WORKER_TOKEN is required"):
                main.require_worker_token()

    def test_public_bind_requires_token(self):
        with patch.dict(os.environ, {"SPEECH_ENGINE_HOST": "0.0.0.0"}, clear=True):
            self.assertTrue(main.worker_auth_required())
            with self.assertRaisesRegex(RuntimeError, "SPEECH_WORKER_TOKEN is required"):
                main.require_worker_token()

    def test_token_satisfies_required_auth(self):
        with patch.dict(
            os.environ,
            {"NODE_ENV": "production", "SPEECH_WORKER_TOKEN": "tok_test"},
            clear=True,
        ):
            self.assertTrue(main.worker_auth_required())
            main.require_worker_token()


if __name__ == "__main__":
    unittest.main()
