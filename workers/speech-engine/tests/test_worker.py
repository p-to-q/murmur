"""Contract tests for the speech-engine worker."""

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main


def make_wav_bytes(text: str = "I can sing this line") -> bytes:
    # The text argument keeps the helper call sites readable even though the
    # worker only needs audio bytes here.
    _ = text
    sample_rate = 16000
    t = np.linspace(0, 0.5, int(sample_rate * 0.5), endpoint=False)
    audio = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV")
    return buf.getvalue()


class SpeechWorkerContractTest(unittest.TestCase):
    def test_health_reports_provider(self):
        with TestClient(main.app) as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["provider"], "faster-whisper")

    def test_empty_upload_is_rejected(self):
        with TestClient(main.app) as client:
            response = client.post(
                "/analyze-speech",
                files={"audio": ("empty.webm", b"", "audio/webm")},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["error"], "audio_required")

    def test_default_response_is_conservative_hum_fallback_when_decode_fails(self):
        with patch.dict(os.environ, {"SPEECH_WORKER_FALLBACK_MODEL": "tiny"}, clear=True), TestClient(main.app) as client:
            response = client.post(
                "/analyze-speech",
                files={"audio": ("capture.webm", b"not-real-audio", "audio/webm")},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["provider"], "local:faster-whisper")
        self.assertEqual(body["text"], "")
        self.assertEqual(body["language"], "unknown")
        self.assertLess(body["confidence"], 0.45)
        self.assertEqual(body["vad"]["speechDurationMs"], 0)

    def test_mock_text_exercises_contract_shape(self):
        env = {
            "SPEECH_ENGINE_MOCK_TEXT": "我想和你唱到天亮",
            "SPEECH_WORKER_PRIMARY_PROVIDER": "sensevoice",
            "SPEECH_WORKER_MODEL_ARTIFACT": "SenseVoiceSmall-GGUF",
            "SPEECH_WORKER_MODEL_SHA": "sha_test",
            "SPEECH_WORKER_MODEL_LICENSE": "apache-2.0",
        }
        with patch.dict(os.environ, env, clear=True), TestClient(main.app) as client:
            response = client.post(
                "/analyze-speech",
                files={"audio": ("capture.webm", b"not-real-audio", "audio/webm")},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["provider"], "local:sensevoice:SenseVoiceSmall-GGUF")
        self.assertEqual(body["language"], "zh")
        self.assertGreaterEqual(body["confidence"], 0.8)
        self.assertEqual(body["asrDiagnostics"]["artifactSha"], "sha_test")
        self.assertEqual(body["asrDiagnostics"]["license"], "apache-2.0")

    def test_ffmpeg_decode_handles_valid_wav(self):
        wav_bytes = make_wav_bytes()
        audio, duration_ms, sample_rate = main.decode_audio_bytes(wav_bytes)
        self.assertGreater(audio.size, 0)
        self.assertGreater(duration_ms, 0)
        self.assertEqual(sample_rate, 16000)

    def test_bearer_token_is_enforced_when_configured(self):
        with patch.dict(os.environ, {"SPEECH_WORKER_TOKEN": "tok"}, clear=True), TestClient(main.app) as client:
            denied = client.post(
                "/analyze-speech",
                files={"audio": ("capture.webm", b"audio", "audio/webm")},
            )
            allowed = client.post(
                "/analyze-speech",
                headers={"Authorization": "Bearer tok"},
                files={"audio": ("capture.webm", b"audio", "audio/webm")},
            )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)


if __name__ == "__main__":
    unittest.main()
