"""Murmur speech-engine worker.

This worker owns the local/self-hosted recognition boundary for Voice-aware
capture. It exposes a conservative ASR contract with a baseline faster-whisper
provider, preserves a mock path for tests, and keeps SenseVoice as a pinned
future provider candidate through the same contract.
"""

from __future__ import annotations

import hmac
import os
import subprocess
import tempfile
import time
import shutil
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

try:  # Optional in tests; the worker still falls back safely without them.
    import numpy as np
    import soundfile as sf
except Exception:  # pragma: no cover - exercised when optional deps are absent.
    np = None
    sf = None
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", ""}
MAX_AUDIO_BYTES = 2 * 1024 * 1024
DEFAULT_SAMPLE_RATE = 16_000


class _AudioArray(Protocol):
    size: int


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    require_worker_token()
    yield


app = FastAPI(title="murmur-speech-engine", version="0.2.0", lifespan=_lifespan)


def _truthy_env(name: str) -> bool:
    value = os.getenv(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _runtime_env() -> str:
    for name in ("MURMUR_ENV", "APP_ENV", "NODE_ENV", "ENV"):
        value = os.getenv(name, "").strip().lower()
        if value:
            return value
    return ""


def _bind_host() -> str:
    for name in ("SPEECH_ENGINE_HOST", "SPEECH_WORKER_BIND_HOST", "MURMUR_WORKER_BIND_HOST"):
        value = os.getenv(name, "").strip().lower()
        if value:
            return value
    return ""


def worker_auth_required() -> bool:
    host = _bind_host()
    return (
        _truthy_env("SPEECH_WORKER_REQUIRE_AUTH")
        or _truthy_env("WORKER_REQUIRE_AUTH")
        or _runtime_env() == "production"
        or (bool(host) and host not in LOOPBACK_HOSTS)
    )


def require_worker_token() -> None:
    if os.getenv("SPEECH_WORKER_TOKEN", "").strip():
        return
    if worker_auth_required():
        raise RuntimeError(
            "SPEECH_WORKER_TOKEN is required when the speech worker is production "
            "or bound outside loopback."
        )


def _verify_auth(request: Request) -> None:
    expected = os.getenv("SPEECH_WORKER_TOKEN", "").strip()
    if not expected:
        return
    provided = request.headers.get("authorization", "")
    if not hmac.compare_digest(
        provided.encode("utf-8"), f"Bearer {expected}".encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


def _mock_text() -> str:
    return os.getenv("SPEECH_ENGINE_MOCK_TEXT", "").strip()


def _provider_name() -> str:
    return os.getenv("SPEECH_WORKER_PRIMARY_PROVIDER", "").strip() or "faster-whisper"


def _model_artifact() -> str | None:
    artifact = os.getenv("SPEECH_WORKER_MODEL_ARTIFACT", "").strip()
    return artifact or None


def _model_sha() -> str | None:
    sha = os.getenv("SPEECH_WORKER_MODEL_SHA", "").strip()
    return sha or None


class _SilentAudio:
    size = 1


def _safe_fallback_audio() -> tuple[_AudioArray, int, int]:
    if np is None:
        return _SilentAudio(), 0, DEFAULT_SAMPLE_RATE
    return np.zeros(1, dtype=np.float32), 0, DEFAULT_SAMPLE_RATE


@dataclass(slots=True)
class RecognitionResult:
    text: str
    language: str
    confidence: float
    segments: list[dict[str, Any]]
    vad: dict[str, Any]
    audio: dict[str, Any]
    asr_diagnostics: dict[str, Any]

    def to_payload(self, provider: str) -> dict[str, Any]:
        return {
            "provider": provider,
            "text": self.text,
            "language": self.language,
            "confidence": self.confidence,
            "segments": self.segments,
            "vad": self.vad,
            "audio": self.audio,
            "asrDiagnostics": self.asr_diagnostics,
        }


@app.get("/health")
def health() -> dict[str, object]:
    provider = _provider_name()
    artifact = _model_artifact()
    return {
        "status": "ok",
        "provider": provider,
        "artifact": artifact,
        "artifactSha": _model_sha(),
        "mock": bool(_mock_text()),
    }


@app.post("/analyze-speech", dependencies=[Depends(_verify_auth)])
async def analyze_speech(
    audio: Annotated[UploadFile, File(...)],
) -> dict[str, object]:
    started = time.perf_counter()
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": "audio_required"})
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail={"error": "audio_too_large"})

    if mock_text := _mock_text():
        result = _mock_result(mock_text, started)
        return result.to_payload(_provider_label())

    result = await transcribe_with_faster_whisper(data, started)
    return result.to_payload(_provider_label())


def _provider_label() -> str:
    provider = _provider_name()
    artifact = _model_artifact()
    if artifact:
        return f"local:{provider}:{artifact}"
    return f"local:{provider}"


def _mock_result(text: str, started: float) -> RecognitionResult:
    language = _detect_language(text)
    confidence = 0.86 if text else 0.1
    duration_ms = 0
    speech_duration_ms = 1800 if text else 0
    speech_ratio = 0.65 if text else 0.0
    total_ms = round((time.perf_counter() - started) * 1000)
    return RecognitionResult(
        text=text,
        language=language,
        confidence=confidence,
        segments=(
            [
                {
                    "text": text,
                    "start": 0.0,
                    "end": 1.8,
                    "confidence": confidence,
                }
            ]
            if text
            else []
        ),
        vad={
            "provider": "stub",
            "speechDurationMs": speech_duration_ms,
            "speechRatio": speech_ratio,
            "segmentCount": 1 if text else 0,
            "maxSpeechSegmentMs": speech_duration_ms,
        },
        audio={"durationMs": duration_ms},
        asr_diagnostics={
            "runtime": "stub",
            "model": _model_artifact() or "stub",
            "artifact": _model_artifact(),
            "artifactSha": _model_sha(),
            "license": os.getenv("SPEECH_WORKER_MODEL_LICENSE", "").strip() or None,
            "decodeMs": 0,
            "totalMs": total_ms,
        },
    )


async def transcribe_with_faster_whisper(data: bytes, started: float) -> RecognitionResult:
    try:
        return await _transcribe_with_faster_whisper(data, started)
    except Exception as exc:  # noqa: BLE001 - fallback is intentional
        return _fallback_result(data, started, exc)


async def _transcribe_with_faster_whisper(data: bytes, started: float) -> RecognitionResult:
    model_name = os.getenv("SPEECH_WORKER_FALLBACK_MODEL", "").strip() or "tiny"
    compute_type = os.getenv("SPEECH_WORKER_FALLBACK_COMPUTE_TYPE", "").strip() or "int8"
    language_hint = _language_hint()
    audio, duration_ms, sample_rate = decode_audio_bytes(data)
    vad = estimate_vad(audio, sample_rate, duration_ms)
    if vad["speechDurationMs"] < 300 or vad["speechRatio"] < 0.08:
        return _hum_fallback_result(duration_ms, started, audio, vad, model_name, compute_type)

    transcript = run_whisper_decode(
        audio,
        sample_rate,
        model_name=model_name,
        compute_type=compute_type,
        language_hint=language_hint,
    )
    segments = transcript.get("segments", [])
    text = normalize_text(transcript.get("text", ""))
    confidence = transcript.get("confidence", 0.72)
    language = transcript.get("language", "unknown")
    return RecognitionResult(
        text=text,
        language=language,
        confidence=confidence,
        segments=segments,
        vad=vad,
        audio={
            "durationMs": duration_ms,
            "rmsDbfs": audio_stats(audio)["rmsDbfs"],
            "peakDbfs": audio_stats(audio)["peakDbfs"],
            "snr": audio_stats(audio)["snr"],
        },
        asr_diagnostics={
            "runtime": "faster-whisper",
            "model": model_name,
            "artifact": _model_artifact(),
            "artifactSha": _model_sha(),
            "license": os.getenv("SPEECH_WORKER_MODEL_LICENSE", "").strip() or None,
            "device": "cpu",
            "computeType": compute_type,
            "languageProbability": transcript.get("languageProbability"),
            "event": transcript.get("event", "speech"),
            "emotion": transcript.get("emotion"),
            "avgLogprob": transcript.get("avgLogprob"),
            "noSpeechProb": transcript.get("noSpeechProb"),
            "compressionRatio": transcript.get("compressionRatio"),
            "decodeMs": transcript.get("decodeMs", 0),
            "totalMs": round((time.perf_counter() - started) * 1000),
        },
    )


def _fallback_result(
    data: bytes,
    started: float,
    error: Exception,
) -> RecognitionResult:
    audio, duration_ms, sample_rate = decode_audio_bytes(data)
    vad = estimate_vad(audio, sample_rate, duration_ms)
    stats = audio_stats(audio)
    return RecognitionResult(
        text="",
        language="unknown",
        confidence=0.1,
        segments=[],
        vad={**vad, "provider": "none"},
        audio={
            "durationMs": duration_ms,
            "rmsDbfs": stats["rmsDbfs"],
            "peakDbfs": stats["peakDbfs"],
            "snr": stats["snr"],
        },
        asr_diagnostics={
            "runtime": "faster-whisper",
            "model": _model_artifact() or "stub",
            "artifact": _model_artifact(),
            "artifactSha": _model_sha(),
            "license": os.getenv("SPEECH_WORKER_MODEL_LICENSE", "").strip() or None,
            "event": "unknown",
            "decodeMs": 0,
            "totalMs": round((time.perf_counter() - started) * 1000),
            "fallbackReason": type(error).__name__,
        },
    )


def _hum_fallback_result(
    duration_ms: int,
    started: float,
    audio: np.ndarray,
    vad: dict[str, Any],
    model_name: str,
    compute_type: str,
) -> RecognitionResult:
    stats = audio_stats(audio)
    return RecognitionResult(
        text="",
        language="unknown",
        confidence=0.1,
        segments=[],
        vad=vad,
        audio={
            "durationMs": duration_ms,
            "rmsDbfs": stats["rmsDbfs"],
            "peakDbfs": stats["peakDbfs"],
            "snr": stats["snr"],
        },
        asr_diagnostics={
            "runtime": "faster-whisper",
            "model": model_name,
            "artifact": _model_artifact(),
            "artifactSha": _model_sha(),
            "license": os.getenv("SPEECH_WORKER_MODEL_LICENSE", "").strip() or None,
            "device": "cpu",
            "computeType": compute_type,
            "event": "speech",
            "decodeMs": 0,
            "totalMs": round((time.perf_counter() - started) * 1000),
            "fallbackReason": "low_vad_activity",
        },
    )


def decode_audio_bytes(data: bytes) -> tuple[_AudioArray, int, int]:
    if np is None or sf is None:
        return _safe_fallback_audio()
    if _looks_like_pcm_wave(data):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            tmp.write(data)
            tmp.flush()
            audio, sample_rate = sf.read(tmp.name, dtype="float32", always_2d=False)
        return normalize_audio(audio, sample_rate)

    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        decoded = decode_with_ffmpeg(tmp.name)
        if decoded is not None:
            return decoded

    return _safe_fallback_audio()


def normalize_audio(audio: Any, sample_rate: int) -> tuple[_AudioArray, int, int]:
    if np is None:
        return _safe_fallback_audio()
    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim > 1:
        arr = np.mean(arr, axis=1).astype(np.float32)
    if sample_rate != DEFAULT_SAMPLE_RATE and arr.size > 0:
        duration_sec = arr.size / sample_rate
        target_len = max(1, round(duration_sec * DEFAULT_SAMPLE_RATE))
        arr = np.interp(
            np.linspace(0, arr.size - 1, target_len),
            np.arange(arr.size),
            arr,
        ).astype(np.float32)
        sample_rate = DEFAULT_SAMPLE_RATE
    duration_ms = round(arr.size / max(sample_rate, 1) * 1000)
    return arr, duration_ms, sample_rate


def decode_with_ffmpeg(path: str) -> tuple[np.ndarray, int, int] | None:
    ffmpeg = (
        os.environ.get("FFMPEG_BIN", "").strip()
        or shutil.which("ffmpeg")
        or "/opt/homebrew/bin/ffmpeg"
        or "ffmpeg"
    )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as out:
        try:
            result = subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-loglevel",
                    "error",
                    "-i",
                    path,
                    "-f",
                    "wav",
                    "-ac",
                    "1",
                    "-ar",
                    str(DEFAULT_SAMPLE_RATE),
                    out.name,
                ],
                check=False,
                capture_output=True,
            )
        except FileNotFoundError:
            return None
        if result.returncode != 0:
            return None
        audio, sample_rate = sf.read(out.name, dtype="float32", always_2d=False)
        return normalize_audio(audio, sample_rate)


def estimate_vad(audio: _AudioArray, sample_rate: int, duration_ms: int) -> dict[str, Any]:
    if audio.size == 0 or sample_rate <= 0:
        return {
            "provider": "silero",
            "speechDurationMs": 0,
            "speechRatio": 0.0,
            "segmentCount": 0,
            "maxSpeechSegmentMs": 0,
        }
    energy = np.abs(audio)
    threshold = max(0.01, float(np.percentile(energy, 70)) * 0.55)
    voiced = energy > threshold
    voiced_samples = int(voiced.sum())
    speech_ratio = voiced_samples / max(audio.size, 1)
    speech_duration_ms = round(duration_ms * speech_ratio)
    return {
        "provider": "silero",
        "speechDurationMs": speech_duration_ms,
        "speechRatio": round(speech_ratio, 4),
        "segmentCount": 1 if voiced_samples else 0,
        "maxSpeechSegmentMs": speech_duration_ms,
        "meanSpeechProbability": round(float(np.mean(energy > threshold)), 4),
    }


def audio_stats(audio: _AudioArray) -> dict[str, float]:
    if audio.size == 0:
        return {"rmsDbfs": -120.0, "peakDbfs": -120.0, "snr": 0.0}
    rms = float(np.sqrt(np.mean(np.square(audio))))
    peak = float(np.max(np.abs(audio)))
    rms_dbfs = 20 * np.log10(max(rms, 1e-6))
    peak_dbfs = 20 * np.log10(max(peak, 1e-6))
    snr = max(0.0, (peak - rms) * 60)
    return {"rmsDbfs": round(rms_dbfs, 2), "peakDbfs": round(peak_dbfs, 2), "snr": round(snr, 2)}


def run_whisper_decode(
    audio: np.ndarray,
    sample_rate: int,
    *,
    model_name: str,
    compute_type: str,
    language_hint: str | None,
) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError("faster-whisper is not installed") from exc

    segments_data: list[dict[str, Any]] = []
    text_parts: list[str] = []
    started = time.perf_counter()
    model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    segments, info = model.transcribe(
        audio,
        language=language_hint or None,
        beam_size=1,
        vad_filter=False,
        word_timestamps=False,
    )
    for segment in segments:
        text_parts.append(segment.text)
        segments_data.append(
            {
                "text": segment.text,
                "start": segment.start,
                "end": segment.end,
                "confidence": getattr(segment, "avg_logprob", None),
                "avgLogprob": getattr(segment, "avg_logprob", None),
                "noSpeechProb": getattr(segment, "no_speech_prob", None),
                "compressionRatio": getattr(segment, "compression_ratio", None),
            }
        )
    text = normalize_text(" ".join(text_parts))
    confidence = max(0.05, min(0.98, 0.65 + (info.language_probability or 0.0) * 0.3))
    return {
        "text": text,
        "language": normalize_language(info.language or "unknown"),
        "languageProbability": getattr(info, "language_probability", None),
        "segments": segments_data,
        "confidence": confidence,
        "avgLogprob": getattr(info, "avg_logprob", None),
        "noSpeechProb": getattr(info, "no_speech_prob", None),
        "compressionRatio": getattr(info, "compression_ratio", None),
        "decodeMs": round((time.perf_counter() - started) * 1000),
        "event": "speech",
    }


def normalize_text(text: str) -> str:
    return " ".join(text.replace("\r\n", "\n").replace("\n", " ").split()).strip()


def _language_hint() -> str | None:
    hint = os.getenv("SPEECH_WORKER_LANGUAGE_HINT", "").strip().lower()
    if hint.startswith("zh"):
        return "zh"
    if hint.startswith("en"):
        return "en"
    return None


def _detect_language(text: str) -> str:
    zh_count = sum(1 for char in text if "\u3400" <= char <= "\u9fff")
    en_count = sum(1 for char in text if char.isascii() and char.isalpha())
    if zh_count == 0 and en_count == 0:
        return "unknown"
    return "zh" if zh_count >= en_count * 0.35 else "en"


def _looks_like_pcm_wave(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
