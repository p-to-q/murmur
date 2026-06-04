"""
Murmur Audio Engine.

Current detector: SwiftF0 with pYIN fallback. The worker also exposes an
optional DeepFilterNet denoise seam behind the stable v2 audio-engine contract,
so algorithm changes do not leak into the Next.js /api/transcribe route.
"""

from __future__ import annotations

import io
import logging
import math
import os
import tempfile
import time
from typing import Annotated

import librosa
import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from audio_engine.denoise import (
    DenoiseConfig,
    DenoiseUnavailable,
    configured_denoise_provider,
    denoise_audio,
)
from audio_engine.detectors import (
    DetectorConfig,
    DetectorUnavailable,
    configured_pitch_provider,
    detect_pitch,
)
from audio_engine.frames import pyin_to_notes

logger = logging.getLogger(__name__)

app = FastAPI(title="Murmur Audio Engine", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SR = 22050
FMIN = 75
FMAX = 1050
FRAME_LEN = 2048
HOP_LEN = 512
MIN_NOTE_DUR = 0.08
MIN_CONF = 0.4
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_AUDIO_SECONDS = 30


def require_worker_auth(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("AUDIO_WORKER_TOKEN", "").strip()
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


def decode_audio(data: bytes, filename: str) -> np.ndarray:
    """Decode webm/opus/mp4/wav/m4a to 22.05 kHz mono float32."""
    try:
        y, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)
        if sr != SR:
            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        return y.astype(np.float32)
    except Exception:
        pass

    try:
        from pydub import AudioSegment

        ext = os.path.splitext(filename)[-1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        try:
            segment = AudioSegment.from_file(tmp_path)
        finally:
            os.unlink(tmp_path)

        segment = segment.set_frame_rate(SR).set_channels(1).set_sample_width(2)
        samples = (
            np.frombuffer(segment.raw_data, dtype=np.int16).astype(np.float32)
            / 32768.0
        )
        return samples
    except Exception as exc:
        raise ValueError(f"Audio decode failed: {exc}") from exc


def trim_silence(y: np.ndarray) -> np.ndarray:
    """Trim head/tail silence defensively before pitch detection."""
    if y.size == 0:
        return y
    trimmed, _ = librosa.effects.trim(y, top_db=35)
    return trimmed.astype(np.float32)


def estimate_snr(y: np.ndarray) -> float | None:
    """Estimate SNR from frame RMS percentiles; good enough for diagnostics."""
    if y.size < HOP_LEN:
        return None
    rms = librosa.feature.rms(y=y, frame_length=FRAME_LEN, hop_length=HOP_LEN)[0]
    if rms.size == 0:
        return None
    signal = float(np.percentile(rms, 90))
    noise = max(float(np.percentile(rms, 10)), 1e-6)
    return round(20 * math.log10(max(signal, 1e-6) / noise), 2)


@app.post("/transcribe", dependencies=[Depends(require_worker_auth)])
async def transcribe(
    audio: Annotated[UploadFile, File(...)],
    targetInstrument: Annotated[str, Form()] = "piano",
):
    started = time.perf_counter()
    decode_ms = 0
    trim_ms = 0

    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="empty audio file")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio file too large")

        phase = time.perf_counter()
        y = decode_audio(data, audio.filename or "hum.webm")
        decode_ms = round((time.perf_counter() - phase) * 1000)
        if y.size == 0:
            raise HTTPException(status_code=422, detail="audio decoded empty")

        duration = len(y) / SR
        if duration > MAX_AUDIO_SECONDS:
            raise HTTPException(status_code=413, detail="audio duration too long")

        phase = time.perf_counter()
        y = trim_silence(y)
        trim_ms = round((time.perf_counter() - phase) * 1000)

        denoise_result = denoise_audio(
            y,
            DenoiseConfig(
                provider=configured_denoise_provider(),
                sample_rate=SR,
            ),
        )
        y = np.asarray(denoise_result.audio, dtype=np.float32)

        configured_provider = configured_pitch_provider()
        detection = detect_pitch(
            y,
            DetectorConfig(
                provider=configured_provider,
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )

        notes = pyin_to_notes(
            detection.f0,
            detection.voiced,
            detection.confidence,
            hop_length=detection.hop_length,
            sample_rate=detection.sample_rate,
            min_confidence=MIN_CONF,
            min_note_duration=MIN_NOTE_DUR,
        )
        if configured_provider == "auto" and detection.provider == "swiftf0" and not notes:
            fallback_detection = detect_pitch(
                y,
                DetectorConfig(
                    provider="pyin",
                    sample_rate=SR,
                    fmin=FMIN,
                    fmax=FMAX,
                    frame_length=FRAME_LEN,
                    hop_length=HOP_LEN,
                ),
            )
            fallback_notes = pyin_to_notes(
                fallback_detection.f0,
                fallback_detection.voiced,
                fallback_detection.confidence,
                hop_length=fallback_detection.hop_length,
                sample_rate=fallback_detection.sample_rate,
                min_confidence=MIN_CONF,
                min_note_duration=MIN_NOTE_DUR,
            )
            if fallback_notes:
                detection = fallback_detection
                notes = fallback_notes
                detection.warnings.insert(0, "swiftf0_empty_fallback")

        voiced_ratio = (
            float(np.count_nonzero(detection.voiced)) / len(detection.voiced)
            if len(detection.voiced)
            else 0.0
        )
        diagnostics = {
            "duration": round(len(y) / SR, 3),
            "snr": estimate_snr(y),
            "voicedRatio": round(voiced_ratio, 3),
            "frameCount": int(len(detection.f0)),
            "decodeMs": decode_ms,
            "trimMs": trim_ms,
            **denoise_result.diagnostics,
            "pitchMs": detection.diagnostics.get("pitchMs", 0),
            "polishMs": 0,
            "totalMs": round((time.perf_counter() - started) * 1000),
            **detection.diagnostics,
        }

        if not notes:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "no_voiced_frames",
                    "diagnostics": diagnostics,
                },
            )

        logger.info(
            "%s detected %s notes from %s frames for target %s",
            detection.provider,
            len(notes),
            len(detection.f0),
            targetInstrument,
        )
        return {
            "provider": detection.provider,
            "rawNotes": notes,
            "warnings": [*denoise_result.warnings, *detection.warnings],
            "diagnostics": diagnostics,
        }
    except HTTPException:
        raise
    except DetectorUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "detector_unavailable", "message": str(exc)},
        ) from exc
    except DenoiseUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "denoise_unavailable", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.exception("transcription error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "murmur-audio-engine",
        "provider": configured_pitch_provider(),
        "denoiseProvider": configured_denoise_provider(),
    }


@app.get("/")
def root():
    return {
        "service": "Murmur Audio Engine",
        "endpoints": ["/transcribe", "/health"],
    }
