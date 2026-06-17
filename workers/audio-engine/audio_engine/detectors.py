"""Pitch detector selection for the Murmur audio engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from os import environ
from typing import Literal

ConfiguredPitchProviderId = Literal["auto", "pyin", "swiftf0", "yin", "parselmouth"]
PitchProviderId = Literal["pyin", "swiftf0", "yin", "parselmouth"]


@dataclass(frozen=True)
class DetectorConfig:
    """Runtime configuration shared by pitch detector providers."""

    provider: ConfiguredPitchProviderId
    sample_rate: int
    fmin: int
    fmax: int
    frame_length: int
    hop_length: int


@dataclass(frozen=True)
class PitchDetection:
    """Raw frame-level f0 output from a detector provider."""

    provider: PitchProviderId
    timestamps: object
    f0: object
    voiced: object
    confidence: object
    diagnostics: dict[str, int | float | str | None] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    sample_rate: int = 22050
    hop_length: int = 512


class DetectorUnavailable(RuntimeError):
    """Raised when the configured pitch detector is known but not installed."""


def configured_pitch_provider() -> ConfiguredPitchProviderId:
    """Read the worker pitch-provider switch from the environment."""
    configured = environ.get("AUDIO_ENGINE_PITCH_PROVIDER", "auto").strip().lower()
    if configured in ("", "auto"):
        return "auto"
    if configured in ("pyin", "swiftf0", "yin", "parselmouth"):
        return configured
    raise DetectorUnavailable(f"Unsupported pitch provider: {configured}")


def detect_pitch(audio: object, config: DetectorConfig) -> PitchDetection:
    """Run the configured pitch detector.

    `auto` tries SwiftF0 first, then falls back to pYIN if the package/model
    is unavailable. Explicit `swiftf0` fails loudly so deploy diagnostics stay
    honest.
    """
    if config.provider == "auto":
        try:
            from audio_engine.swift_f0_provider import detect_swiftf0

            return detect_swiftf0(audio, config)
        except DetectorUnavailable as exc:
            detection = detect_pitch(audio, replace_provider(config, "pyin"))
            return PitchDetection(
                provider=detection.provider,
                timestamps=detection.timestamps,
                f0=detection.f0,
                voiced=detection.voiced,
                confidence=detection.confidence,
                diagnostics=detection.diagnostics,
                warnings=[f"swiftf0_unavailable:{exc}", *detection.warnings],
                sample_rate=detection.sample_rate,
                hop_length=detection.hop_length,
            )

    if config.provider == "pyin":
        from audio_engine.pyin_provider import detect_pyin

        return detect_pyin(audio, config)

    if config.provider == "swiftf0":
        from audio_engine.swift_f0_provider import detect_swiftf0

        return detect_swiftf0(audio, config)

    if config.provider == "yin":
        from audio_engine.yin_provider import detect_yin

        return detect_yin(audio, config)

    if config.provider == "parselmouth":
        from audio_engine.parselmouth_provider import detect_parselmouth

        return detect_parselmouth(audio, config)

    raise DetectorUnavailable(f"Unsupported pitch provider: {config.provider}")


def replace_provider(
    config: DetectorConfig,
    provider: ConfiguredPitchProviderId,
) -> DetectorConfig:
    return DetectorConfig(
        provider=provider,
        sample_rate=config.sample_rate,
        fmin=config.fmin,
        fmax=config.fmax,
        frame_length=config.frame_length,
        hop_length=config.hop_length,
    )
