"""Frame-to-note segmentation helpers for Murmur's monophonic audio engine."""

from __future__ import annotations

import math
from collections.abc import Sequence

DEFAULT_MIN_CONFIDENCE = 0.4
DEFAULT_LOW_MIDI = 36
DEFAULT_HIGH_MIDI = 84
DEFAULT_MIN_NOTE_DURATION = 0.08

NoteEvent = dict[str, float | int]


def hz_to_midi(hz: float) -> int:
    """Convert a positive frequency in Hz to the nearest MIDI pitch."""
    if hz <= 0:
        raise ValueError("hz must be positive")
    return round(12 * math.log2(hz / 440) + 69)


def stabilize_midi_frames(
    f0: Sequence[float],
    voiced: Sequence[bool],
    confidence: Sequence[float],
    *,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    low_midi: int = DEFAULT_LOW_MIDI,
    high_midi: int = DEFAULT_HIGH_MIDI,
) -> list[int | None]:
    """Convert f0 frames to MIDI and suppress single-frame octave blips.

    pYIN/YIN-family detectors can briefly jump by one octave under noise. If a
    frame jumps 10-14 semitones and the next frame returns near the original
    pitch, treat the middle frame as an octave blip rather than a real note.
    """
    frames: list[int | None] = []
    frame_count = min(len(f0), len(voiced), len(confidence))

    for index in range(frame_count):
        value = float(f0[index])
        is_voiced = (
            bool(voiced[index])
            and not math.isnan(value)
            and float(confidence[index]) >= min_confidence
        )
        if not is_voiced:
            frames.append(None)
            continue

        midi = hz_to_midi(value)
        frames.append(midi if low_midi <= midi <= high_midi else None)

    smoothed = frames[:]
    for index in range(1, len(frames) - 1):
        prev = frames[index - 1]
        curr = frames[index]
        nxt = frames[index + 1]
        if prev is None or curr is None or nxt is None:
            continue
        jump = abs(curr - prev)
        returns_home = abs(nxt - prev) <= 2
        if 10 <= jump <= 14 and returns_home:
            smoothed[index] = prev

    return smoothed


def midi_frames_to_notes(
    midi_frames: Sequence[int | None],
    confidence: Sequence[float],
    *,
    hop_length: int,
    sample_rate: int,
    min_note_duration: float = DEFAULT_MIN_NOTE_DURATION,
) -> list[NoteEvent]:
    """Segment stabilized MIDI frames into compact monophonic note events."""
    notes: list[NoteEvent] = []
    note_start: float | None = None
    note_midi: int | None = None
    note_confs: list[float] = []

    def flush(end_time: float) -> None:
        nonlocal note_start, note_midi, note_confs
        if note_start is None or note_midi is None:
            return
        duration = end_time - note_start
        if duration >= min_note_duration:
            avg_conf = sum(note_confs) / len(note_confs) if note_confs else 0.7
            notes.append(
                {
                    "pitch": note_midi,
                    "start": round(note_start, 3),
                    "duration": round(duration, 3),
                    "velocity": round(min(1.0, avg_conf) * 0.85, 3),
                    "confidence": round(avg_conf, 3),
                }
            )
        note_start = None
        note_midi = None
        note_confs = []

    for index, midi in enumerate(midi_frames):
        timestamp = index * hop_length / sample_rate
        if midi is None:
            flush(timestamp)
            continue

        frame_confidence = float(confidence[index]) if index < len(confidence) else 0.7
        if note_start is None:
            note_start = timestamp
            note_midi = midi
            note_confs = [frame_confidence]
            continue

        if midi != note_midi:
            flush(timestamp)
            note_start = timestamp
            note_midi = midi
            note_confs = [frame_confidence]
            continue

        note_confs.append(frame_confidence)

    flush(len(midi_frames) * hop_length / sample_rate)
    return notes


def pyin_to_notes(
    f0: Sequence[float],
    voiced: Sequence[bool],
    confidence: Sequence[float],
    *,
    hop_length: int,
    sample_rate: int,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    low_midi: int = DEFAULT_LOW_MIDI,
    high_midi: int = DEFAULT_HIGH_MIDI,
    min_note_duration: float = DEFAULT_MIN_NOTE_DURATION,
) -> list[NoteEvent]:
    """Convert pYIN frames to compact monophonic note events."""
    midi_frames = stabilize_midi_frames(
        f0,
        voiced,
        confidence,
        min_confidence=min_confidence,
        low_midi=low_midi,
        high_midi=high_midi,
    )
    return midi_frames_to_notes(
        midi_frames,
        confidence,
        hop_length=hop_length,
        sample_rate=sample_rate,
        min_note_duration=min_note_duration,
    )
