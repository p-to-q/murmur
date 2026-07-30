"""Shared HTTP/RunPod v2 output protocol assembly."""

from __future__ import annotations

import base64
import hashlib
import json

import engine
import pipeline


def input_receipt(
    request_id: str,
    prompt: str,
    duration: float,
    style_mix: float,
    melody_input: object,
    melody: dict | None,
    hum_bytes: bytes | None,
) -> dict:
    if isinstance(melody_input, str):
        melody_json = melody_input
    elif melody_input:
        melody_json = json.dumps(
            melody_input, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
    else:
        melody_json = ""
    return {
        "version": 2,
        "request_id": request_id,
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "duration": duration,
        "style_mix": style_mix,
        "melody_sha256": hashlib.sha256(melody_json.encode("utf-8")).hexdigest()
        if melody_json
        else None,
        "melody_accepted": melody is not None if melody_json else False,
        "melody_valid_note_count": pipeline.valid_note_count(melody, duration),
        "hum_sha256": hashlib.sha256(hum_bytes).hexdigest() if hum_bytes else None,
        "hum_accepted": hum_bytes is not None,
    }


def success_output(generated: dict, receipt: dict) -> dict:
    wav_bytes = generated["wav_bytes"]
    meta = generated["meta"]
    quality = generated["quality"]
    return {
        "audio_b64": base64.b64encode(wav_bytes).decode("ascii"),
        "model": meta.get("X-Model", engine.MODEL_NAME),
        "generation_ms": int(meta.get("X-Generation-Ms", "0") or 0),
        "style_mix": meta.get("X-Style-Mix", "0.00"),
        "melody_conditioned": meta.get("X-Melody-Conditioned", "0"),
        "cfg_notes": meta.get("X-Cfg-Notes", "0"),
        "melody_segments": int(meta.get("X-Melody-Segments", "0") or 0),
        "melody_onsets": int(meta.get("X-Melody-Onsets", "0") or 0),
        "melody_coverage": float(meta.get("X-Melody-Coverage", "0") or 0),
        "temperature": float(meta.get("X-Temperature", "0") or 0),
        "top_k": int(meta.get("X-Top-K", "0") or 0),
        "sample_rate": engine.SAMPLE_RATE,
        "input_receipt": _v1_receipt_compat(receipt),
        "input_receipt_v2": receipt,
        "quality": {**quality, "version": "music-technical-v1"},
        "quality_v2": quality,
        "diagnostics": generated["diagnostics"],
    }


def _v1_receipt_compat(receipt: dict) -> dict:
    return {
        key: value
        for key, value in receipt.items()
        if key not in {"melody_valid_note_count", "hum_accepted", "conditioning_error"}
    } | {"version": 1}
