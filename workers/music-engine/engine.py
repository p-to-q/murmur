"""Backend-agnostic Magenta RealTime 2 generation core.

Shared by both worker frontends:
  * `main.py`    — FastAPI server for local dev (`bun run dev:music`), MLX backend.
  * `handler.py` — RunPod Serverless handler for production, JAX/CUDA backend.

Everything here is transport-free: no FastAPI, no RunPod SDK. `generate_clip`
is the one entry point — it loads the model on first use (idempotently) and
returns PCM16 WAV bytes plus a small metadata dict whose keys mirror the
`X-*` response headers the app expects.

Env:
    MAGENTA_MODEL        mrt2_base (default) | mrt2_small
    MAGENTA_BACKEND      auto (default) | mlx | jax
    MAGENTA_CFG_NOTES    melody CFG scale (default 1.5; valid range [-1.0, 7.0])
    MUSIC_ENGINE_MOCK    "1" → synthesized placeholder clips, never import magenta
    MUSIC_ENGINE_PRELOAD "0" → callers should skip warming the model at startup
"""

from __future__ import annotations

import io
import hashlib
import logging
import math
import os
import platform
import subprocess
import threading
import time
from importlib import metadata as importlib_metadata

import numpy as np

logger = logging.getLogger("music-engine")

MOCK = os.getenv("MUSIC_ENGINE_MOCK", "").strip().lower() in {"1", "true", "yes"}
MODEL_NAME = os.getenv("MAGENTA_MODEL", "mrt2_base").strip() or "mrt2_base"
PRELOAD = os.getenv("MUSIC_ENGINE_PRELOAD", "1").strip().lower() not in {"0", "false", "no"}

SAMPLE_RATE = 48_000
FRAMES_PER_SECOND = 25          # MRT2: 25 codec frames ≈ 1 s of audio
MAX_FRAMES_PER_CALL = 250       # generate ≤10 s per call, then carry state
MIN_DURATION = 2.0
MAX_DURATION = 30.0
MAX_HUM_BYTES = 8 * 1024 * 1024
MAX_PROMPT_CHARS = 300

NOTES_DIM = 128                 # one slot per MIDI pitch (0–127)
# Notes CFG scale. The library default is 1.0; 3.0 over-forces the melody and
# strips its musicality (robotic, dissonant). 1.5 keeps a clear melodic link
def _bounded_env_float(
    name: str, default: float, minimum: float, maximum: float
) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("Invalid %s; falling back to %.3f", name, default)
        return default
    if not math.isfinite(value):
        logger.warning("Invalid %s; falling back to %.3f", name, default)
        return default
    return max(minimum, min(maximum, value))


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("Invalid %s; falling back to %d", name, default)
        return default
    return max(minimum, min(maximum, value))


CFG_NOTES_MELODY = _bounded_env_float("MAGENTA_CFG_NOTES", 1.5, -1.0, 7.0)
SAMPLING_TEMPERATURE = _bounded_env_float(
    "MAGENTA_TEMPERATURE", 1.3, 0.1, 2.0
)
SAMPLING_TOP_K = _bounded_env_int("MAGENTA_TOP_K", 40, 1, 512)
# Sub-perceptual runs (transcription jitter) fold into the prior note so the
# model isn't machine-gunned with re-onsets. 3 frames ≈ 0.12 s.
MIN_RUN_FRAMES = 3
FFMPEG_TIMEOUT_SECONDS = 20


# ── Model lifecycle ────────────────────────────────────────────────────
#
# MLX binds its GPU stream to the thread that loaded the model, so under the
# MLX backend *every* model operation (load, embed, generate) must run on one
# dedicated thread — the FastAPI server pins this with a single-worker
# executor. JAX has no such constraint, so the serverless handler can call
# straight through. `load_model` itself is lock-guarded and idempotent.

_load_lock = threading.Lock()
_mrt = None
_loaded_backend: str | None = None
_loading = False
_load_error: str | None = None


class ConditioningError(RuntimeError):
    """A requested conditioning signal could not be applied safely."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _import_system_class():
    """Pick the inference backend.

    MAGENTA_BACKEND=mlx   force Apple-Silicon MLX (errors elsewhere)
    MAGENTA_BACKEND=jax   force JAX (NVIDIA GPU / TPU / CPU servers)
    MAGENTA_BACKEND=auto  (default) MLX when importable, else JAX
    """
    backend = (os.getenv("MAGENTA_BACKEND", "auto").strip().lower() or "auto")
    if backend in ("auto", "mlx"):
        try:
            from magenta_rt import MagentaRT2Mlxfn

            return "mlx", MagentaRT2Mlxfn
        except Exception:
            if backend == "mlx":
                raise
    import magenta_rt

    for name in ("MagentaRT2Jax", "MagentaRT2", "MagentaRT2System"):
        try:
            cls = getattr(magenta_rt, name, None)
        except ImportError:
            cls = None
        if cls is not None:
            return "jax", cls
    raise RuntimeError(
        "magenta_rt exposes no JAX system class (install with: pip install magenta-rt[jax] jax[cuda12])"
    )


def load_model():
    """Idempotently load the model; safe to call from any thread."""
    global _mrt, _loaded_backend, _loading, _load_error
    if _mrt is not None:
        return _mrt
    with _load_lock:
        if _mrt is not None:
            return _mrt
        _loading = True
        started = time.time()
        try:
            backend, system_cls = _import_system_class()

            logger.info("Loading Magenta RT model '%s' (%s)…", MODEL_NAME, backend)
            model = system_cls(size=MODEL_NAME)
            _mrt = model
            _loaded_backend = backend
            _load_error = None
            logger.info("Model '%s' ready in %.1fs", MODEL_NAME, time.time() - started)
            return _mrt
        except Exception as error:  # noqa: BLE001 — surface anything to /health
            _load_error = f"{type(error).__name__}: {error}"
            logger.exception("Failed to load Magenta RT model '%s'", MODEL_NAME)
            raise
        finally:
            _loading = False


def model_loaded() -> bool:
    return MOCK or _mrt is not None


def model_loading() -> bool:
    return _loading


def model_load_error() -> str | None:
    return _load_error


def runtime_fingerprint() -> dict[str, str]:
    """Return bounded, non-user runtime evidence for incident correlation."""

    return {
        "model": MODEL_NAME,
        "backend_configured": os.getenv("MAGENTA_BACKEND", "auto")[:32],
        "backend_loaded": _loaded_backend or ("mock" if MOCK else "not_loaded"),
        "engine_revision": os.getenv("MURMUR_MUSIC_ENGINE_REVISION", "unknown")[:64],
        "magenta_rt": _package_version("magenta-rt"),
        "jax": _package_version("jax"),
        "numpy": np.__version__[:32],
        "python": platform.python_version()[:32],
        "machine": os.uname().machine[:32] if hasattr(os, "uname") else "unknown",
        "cfg_notes": f"{CFG_NOTES_MELODY:.3f}",
        "temperature": f"{SAMPLING_TEMPERATURE:.3f}",
        "top_k": str(SAMPLING_TOP_K),
    }


def _package_version(name: str) -> str:
    try:
        return importlib_metadata.version(name)[:64]
    except importlib_metadata.PackageNotFoundError:
        return "not_installed"


# ── Helpers ────────────────────────────────────────────────────────────


def blend_style_embeddings(
    text_emb: np.ndarray, audio_emb: np.ndarray, mix: float
) -> np.ndarray:
    """Weighted blend of MusicCoCa embeddings, renormalized to unit length.

    MusicCoCa embeddings live in a contrastive joint space, so a convex
    combination followed by L2 renormalization is the standard way to mix
    styles. Falls back to the text embedding when shapes disagree.
    """
    a = np.asarray(text_emb, dtype=np.float32)
    b = np.asarray(audio_emb, dtype=np.float32)
    if a.shape != b.shape:
        return a
    out = (1.0 - mix) * a + mix * b
    norm = float(np.linalg.norm(out))
    if norm > 1e-6:
        out = out / norm
    return out


def decode_hum_waveform(hum_bytes: bytes):
    """Decode a browser hum upload into a Magenta Waveform.

    Magenta delegates Waveform.from_file to libsndfile, which handles WAV/FLAC
    well but usually rejects browser WebM/Opus blobs. The production image
    already ships ffmpeg, so fall back through a short in-memory transcode before
    dropping hum styling.
    """
    from magenta_rt.audio import Waveform

    try:
        return Waveform.from_file(io.BytesIO(hum_bytes))
    except Exception as direct_error:  # noqa: BLE001 - try browser formats next
        try:
            transcoded = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    "pipe:0",
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-f",
                    "wav",
                    "pipe:1",
                ],
                input=hum_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=FFMPEG_TIMEOUT_SECONDS,
            )
            return Waveform.from_file(io.BytesIO(transcoded.stdout))
        except Exception as transcode_error:  # noqa: BLE001 - preserve root clue
            raise RuntimeError(
                f"direct decode failed: {direct_error}; ffmpeg decode failed: {transcode_error}"
            ) from transcode_error


def pcm16_wav_bytes(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Encode float32 [nsamp, nch] samples as a PCM16 WAV blob (stdlib only)."""
    import wave

    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as writer:
        writer.setnchannels(pcm.shape[1])
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm.tobytes())
    return buf.getvalue()


def mock_clip(prompt: str, duration: float) -> bytes:
    """Deterministic pleasant placeholder so the app is testable without weights."""
    digest = hashlib.sha256(prompt.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big")
    rng = np.random.default_rng(seed % (2**32))
    n = int(duration * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    roots = [220.0, 246.94, 261.63, 293.66, 329.63]
    root = roots[seed % len(roots)] * (1.0 + (((seed >> 8) % 9) - 4) * 0.001)
    chord = [root, root * 5 / 4, root * 3 / 2]
    left = np.zeros(n, dtype=np.float32)
    right = np.zeros(n, dtype=np.float32)
    for i, freq in enumerate(chord):
        env = 0.5 + 0.5 * np.sin(2 * math.pi * (0.25 + 0.1 * i) * t + i)
        tone = np.sin(2 * math.pi * freq * t).astype(np.float32) * env.astype(np.float32)
        left += tone * (0.18 if i % 2 == 0 else 0.12)
        right += tone * (0.12 if i % 2 == 0 else 0.18)
    fade = np.minimum(1.0, np.minimum(t / 0.05, (duration - t) / 0.25)).astype(np.float32)
    return pcm16_wav_bytes(np.stack([left * fade, right * fade], axis=1))


def _held_notes(vec: list[int] | None) -> list[int] | None:
    """Onset → continuation, for the tail of a note split across calls."""
    if vec is None:
        return None
    return [1 if v == 2 else v for v in vec]


def melody_to_segments(
    melody: dict, total_duration: float
) -> list[tuple[list[int] | None, int]]:
    """Turn transcribed notes into (notes_vector, frames) generation segments.

    The model holds its `notes` argument constant for a whole generate() call,
    so a melody that changes over time has to be sliced: one segment per note,
    one per rest. Each note becomes a *monophonic* onset — a hum is a single
    line, so the old per-second roll (which switched on every pitch overlapping
    the window) just produced dissonant clusters. Rests are all-masked so the
    model stays free to sustain its accompaniment underneath the silence.

    notes_vector is 128 ints (-1 masked / 0 off / 1 hold / 2 onset / 3 model's
    choice); None is an all-masked rest. frames run at 25 per second, and the
    returned segments tile the whole clip (notes + rests) with no gaps.
    """
    raw = (melody or {}).get("notes") or []
    total_frames = int(round(total_duration * FRAMES_PER_SECOND))
    if not raw or total_frames <= 0:
        return []

    events: list[tuple[int, int, int]] = []
    for n in raw:
        try:
            pitch = int(n.get("pitch", -1))
            start = float(n.get("start", 0.0))
            dur = float(n.get("duration", 0.0))
        except (TypeError, ValueError, AttributeError):
            continue
        if not (0 <= pitch <= 127) or dur <= 0 or start < 0:
            continue
        sf = int(round(start * FRAMES_PER_SECOND))
        ef = int(round((start + dur) * FRAMES_PER_SECOND))
        if sf >= total_frames:
            continue
        events.append((sf, min(max(ef, sf + 1), total_frames), pitch))

    if not events:
        return []
    events.sort(key=lambda e: (e[0], e[1]))

    # Collapse to a monophonic per-frame pitch track; the earliest note wins an
    # overlap so a clean hum stays a single line instead of a chord.
    track = [-1] * total_frames
    for sf, ef, pitch in events:
        for f in range(sf, ef):
            if track[f] == -1:
                track[f] = pitch

    # Run-length encode, folding sub-perceptual blips into the prior run.
    runs: list[list[int]] = []  # [pitch, frames]
    for pitch in track:
        if runs and runs[-1][0] == pitch:
            runs[-1][1] += 1
        else:
            runs.append([pitch, 1])
    merged: list[list[int]] = []
    for pitch, frames in runs:
        if merged and frames < MIN_RUN_FRAMES:
            merged[-1][1] += frames
        else:
            merged.append([pitch, frames])

    segments: list[tuple[list[int] | None, int]] = []
    for pitch, frames in merged:
        if pitch < 0:
            segments.append((None, frames))
        else:
            vec = [-1] * NOTES_DIM
            vec[pitch] = 2  # onset; the held tail lives inside this one call
            segments.append((vec, frames))
    return segments


# ── Generation ─────────────────────────────────────────────────────────


def generate_clip(
    prompt: str,
    duration: float,
    hum_bytes: bytes | None = None,
    style_mix: float = 0.0,
    melody: dict | None = None,
    *,
    temperature: float | None = None,
    top_k: int | None = None,
) -> tuple[bytes, dict[str, str]]:
    """Run one full clip generation → (PCM16 WAV bytes, X-* metadata).

    Loads the model on first use. Under MLX this must run on the model's pinned
    thread (the FastAPI server routes it through a single-worker executor);
    under JAX any thread is fine. Returns a mock clip when MUSIC_ENGINE_MOCK.
    """
    started = time.time()
    applied_temperature = SAMPLING_TEMPERATURE if temperature is None else max(
        0.1, min(2.0, float(temperature))
    )
    applied_top_k = SAMPLING_TOP_K if top_k is None else max(1, min(512, int(top_k)))
    segments = melody_to_segments(melody, duration) if melody else []
    has_melody = len(segments) > 0
    total_frames = int(round(duration * FRAMES_PER_SECOND))
    conditioned_frames = sum(frames for notes, frames in segments if notes is not None)
    melody_onsets = sum(1 for notes, _frames in segments if notes is not None)
    melody_coverage = conditioned_frames / total_frames if total_frames > 0 else 0.0

    if MOCK:
        return mock_clip(prompt, duration), {
            "X-Model": "mock",
            "X-Generation-Ms": "0",
            "X-Style-Mix": f"{style_mix if hum_bytes and style_mix > 0 else 0.0:.2f}",
            "X-Melody-Conditioned": "1" if has_melody else "0",
            "X-Cfg-Notes": f"{CFG_NOTES_MELODY:.1f}" if has_melody else "0",
            "X-Melody-Segments": str(len(segments)),
            "X-Melody-Onsets": str(melody_onsets),
            "X-Melody-Coverage": f"{melody_coverage:.4f}",
            "X-Temperature": f"{applied_temperature:.3f}",
            "X-Top-K": str(applied_top_k),
        }

    mrt = load_model()

    style = mrt.embed_style(prompt, use_mapper=True)
    mixed = 0.0
    if hum_bytes and style_mix > 0:
        try:
            hum = decode_hum_waveform(hum_bytes)
            hum_emb = mrt.embed_style(hum)
            if np.asarray(style).shape != np.asarray(hum_emb).shape:
                raise ConditioningError("hum_embedding_shape_mismatch")
            style = blend_style_embeddings(style, hum_emb, style_mix)
            mixed = style_mix
        except ConditioningError:
            raise
        except Exception as error:  # noqa: BLE001 — normalize vendor failures
            logger.warning("Hum style conditioning failed: %s", type(error).__name__)
            raise ConditioningError("hum_style_conditioning_failed") from error

    chunks = []
    state = None

    if has_melody:
        # Segments already tile the whole clip (notes + rests), so this single
        # pass both voices the melody and fills the tail — no separate free run.
        for notes_vec, seg_frames in segments:
            remaining = seg_frames
            first = True
            while remaining > 0:
                frames = min(MAX_FRAMES_PER_CALL, remaining)
                wav, state = mrt.generate(
                    style=style,
                    notes=notes_vec if first else _held_notes(notes_vec),
                    cfg_notes=CFG_NOTES_MELODY,
                    temperature=applied_temperature,
                    top_k=applied_top_k,
                    frames=frames,
                    state=state,
                )
                chunks.append(wav)
                remaining -= frames
                first = False
    else:
        remaining = total_frames
        while remaining > 0:
            frames = min(MAX_FRAMES_PER_CALL, remaining)
            wav, state = mrt.generate(
                style=style,
                temperature=applied_temperature,
                top_k=applied_top_k,
                frames=frames,
                state=state,
            )
            chunks.append(wav)
            remaining -= frames

    if len(chunks) == 1:
        full = chunks[0]
    else:
        from magenta_rt import audio as audio_lib

        full = audio_lib.concatenate(chunks)
    full = full.as_stereo()
    pre_normalization_samples = np.asarray(full.samples, dtype=np.float32)
    pre_normalization_peak = float(np.max(np.abs(pre_normalization_samples)))
    pre_normalization_rms = float(np.sqrt(np.mean(np.square(pre_normalization_samples))))
    full = full.peak_normalize(0.95)
    samples = np.asarray(full.samples, dtype=np.float32)
    normalization_gain = (
        float(np.max(np.abs(samples))) / pre_normalization_peak
        if pre_normalization_peak > 1e-9
        else 0.0
    )

    elapsed_ms = int((time.time() - started) * 1000)
    meta = {
        "X-Model": MODEL_NAME,
        "X-Generation-Ms": str(elapsed_ms),
        "X-Style-Mix": f"{mixed:.2f}",
        "X-Melody-Conditioned": "1" if has_melody else "0",
        "X-Cfg-Notes": f"{CFG_NOTES_MELODY:.1f}" if has_melody else "0",
        "X-Melody-Segments": str(len(segments)),
        "X-Melody-Onsets": str(melody_onsets),
        "X-Melody-Coverage": f"{melody_coverage:.4f}",
        "X-Temperature": f"{applied_temperature:.3f}",
        "X-Top-K": str(applied_top_k),
        "X-Pre-Normalization-Peak": f"{pre_normalization_peak:.6f}",
        "X-Pre-Normalization-Rms": f"{pre_normalization_rms:.6f}",
        "X-Normalization-Gain-Db": f"{20 * math.log10(normalization_gain):.3f}"
        if normalization_gain > 0
        else "-120.000",
    }
    logger.info(
        "Generated %.1fs clip in %dms (prompt_sha256=%s, style_mix=%.2f, cfg_notes=%.1f, melody=%s)",
        duration, elapsed_ms, hashlib.sha256(prompt.encode()).hexdigest()[:12], mixed, CFG_NOTES_MELODY,
        f"{len(segments)} segments" if has_melody else "none",
    )
    return pcm16_wav_bytes(samples, full.sample_rate), meta
