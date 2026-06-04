"""Noise reduction provider selection for the Murmur audio engine."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from os import environ
from typing import Literal

ConfiguredDenoiseProviderId = Literal["auto", "off", "deepfilternet"]
DenoiseProviderId = Literal["off", "deepfilternet"]


@dataclass(frozen=True)
class DenoiseConfig:
    """Runtime configuration shared by denoise providers."""

    provider: ConfiguredDenoiseProviderId
    sample_rate: int


@dataclass(frozen=True)
class DenoiseResult:
    """Result of an optional denoise pass."""

    provider: DenoiseProviderId
    audio: object
    diagnostics: dict[str, int | float | str | None] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


class DenoiseUnavailable(RuntimeError):
    """Raised when the configured denoise provider cannot run."""


def configured_denoise_provider() -> ConfiguredDenoiseProviderId:
    """Read the worker denoise-provider switch from the environment."""
    configured = environ.get("AUDIO_ENGINE_DENOISE_PROVIDER", "auto").strip().lower()
    if configured in ("", "auto"):
        return "auto"
    if configured in ("off", "none", "disabled"):
        return "off"
    if configured in ("deepfilter", "deepfilternet"):
        return "deepfilternet"
    raise DenoiseUnavailable(f"Unsupported denoise provider: {configured}")


def denoise_audio(audio: object, config: DenoiseConfig) -> DenoiseResult:
    """Run the configured denoise provider.

    `auto` uses DeepFilterNet when its optional PyTorch stack is installed,
    then falls back to raw audio with a warning. Explicit `deepfilternet` fails
    loudly so production deployments do not silently ship without denoise.
    """
    if config.provider == "off":
        return raw_audio_result(audio)

    if config.provider == "auto":
        try:
            return denoise_deepfilternet(audio, config)
        except DenoiseUnavailable as exc:
            return raw_audio_result(
                audio,
                warnings=[f"deepfilternet_unavailable:{short_error(exc)}"],
            )

    if config.provider == "deepfilternet":
        return denoise_deepfilternet(audio, config)

    raise DenoiseUnavailable(f"Unsupported denoise provider: {config.provider}")


def raw_audio_result(
    audio: object,
    warnings: list[str] | None = None,
) -> DenoiseResult:
    return DenoiseResult(
        provider="off",
        audio=audio,
        diagnostics={
            "denoiseProvider": "off",
            "denoiseModel": None,
            "denoiseMs": 0,
        },
        warnings=warnings or [],
    )


def denoise_deepfilternet(audio: object, config: DenoiseConfig) -> DenoiseResult:
    """Denoise a mono float waveform with DeepFilterNet and return worker-rate audio."""
    try:
        import librosa
        import numpy as np
        import torch
        from df.enhance import enhance
    except Exception as exc:
        raise DenoiseUnavailable(
            "DeepFilterNet is not installed; install requirements-denoise.txt",
        ) from exc

    started = time.perf_counter()
    try:
        model, df_state, model_name = get_deepfilter_model()
        model_rate = deepfilter_sample_rate(df_state)

        source = np.asarray(audio, dtype=np.float32)
        if source.ndim > 1:
            source = source.mean(axis=1)
        source = np.nan_to_num(source, nan=0.0, posinf=0.0, neginf=0.0).astype(
            np.float32,
        )
        original_len = source.shape[0]
        if original_len == 0:
            return raw_audio_result(source)

        model_audio = resample(source, config.sample_rate, model_rate, librosa)
        tensor = torch.from_numpy(model_audio).unsqueeze(0)

        with torch.no_grad():
            enhanced = enhance(model, df_state, tensor, pad=True)

        denoised = (
            enhanced.detach()
            .cpu()
            .squeeze()
            .numpy()
            .astype(np.float32, copy=False)
        )
        worker_audio = resample(denoised, model_rate, config.sample_rate, librosa)
        worker_audio = match_length(worker_audio, original_len, np)
        worker_audio = np.clip(worker_audio, -1.0, 1.0).astype(np.float32)

        return DenoiseResult(
            provider="deepfilternet",
            audio=worker_audio,
            diagnostics={
                "denoiseProvider": "deepfilternet",
                "denoiseModel": str(model_name),
                "denoiseModelSampleRate": model_rate,
                "denoiseMs": round((time.perf_counter() - started) * 1000),
            },
            warnings=[],
        )
    except DenoiseUnavailable:
        raise
    except Exception as exc:
        raise DenoiseUnavailable(f"DeepFilterNet failed: {short_error(exc)}") from exc


_DEEPFILTER_CACHE: tuple[object, object, str] | None = None


def get_deepfilter_model() -> tuple[object, object, str]:
    """Cache one DeepFilterNet model per worker process."""
    global _DEEPFILTER_CACHE
    if _DEEPFILTER_CACHE is None:
        from df.enhance import init_df

        model, df_state, model_name = init_df(log_level="ERROR", log_file=None)
        if hasattr(model, "eval"):
            model.eval()
        _DEEPFILTER_CACHE = (model, df_state, model_name)
    return _DEEPFILTER_CACHE


def deepfilter_sample_rate(df_state: object) -> int:
    sample_rate = getattr(df_state, "sr")
    if callable(sample_rate):
        sample_rate = sample_rate()
    return int(sample_rate)


def resample(audio: object, source_rate: int, target_rate: int, librosa: object) -> object:
    if source_rate == target_rate:
        return audio
    return librosa.resample(audio, orig_sr=source_rate, target_sr=target_rate).astype(
        "float32",
    )


def match_length(audio: object, target_len: int, np: object) -> object:
    current_len = audio.shape[0]
    if current_len == target_len:
        return audio
    if current_len > target_len:
        return audio[:target_len]
    return np.pad(audio, (0, target_len - current_len))


def short_error(error: BaseException) -> str:
    return str(error).splitlines()[0][:180]
