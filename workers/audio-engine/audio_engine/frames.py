"""Frame-to-note segmentation helpers for Murmur's monophonic audio engine."""

from __future__ import annotations

import math
from collections.abc import Sequence

DEFAULT_MIN_CONFIDENCE = 0.4
DEFAULT_LOW_MIDI = 36
DEFAULT_HIGH_MIDI = 84
DEFAULT_MIN_NOTE_DURATION = 0.08
DEFAULT_ONSET_CONFIRM_FRAMES = 2
DEFAULT_PITCH_CHANGE_CONFIRM_FRAMES = 2
DEFAULT_VOICING_BRIDGE_CONFIDENCE = 0.7
DEFAULT_MAX_VOICING_BRIDGE_FRAMES = 14

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

    # Heal short "voicing dropped but pitch stayed stable" gaps. SwiftF0 can
    # sometimes emit confident, near-stationary f0 while momentarily marking the
    # segment unvoiced under noise; treating those spans as hard silence causes
    # the first sung note to disappear entirely.
    index = 0
    while index < len(smoothed):
        if smoothed[index] is not None:
            index += 1
            continue

        gap_start = index
        while index < len(smoothed) and smoothed[index] is None:
            index += 1
        gap_end = index
        gap_length = gap_end - gap_start
        if gap_start == 0 or gap_end >= len(smoothed):
            continue
        if gap_length > DEFAULT_MAX_VOICING_BRIDGE_FRAMES:
            continue

        left = smoothed[gap_start - 1]
        right = smoothed[gap_end]
        if left is None or right is None or abs(left - right) > 1:
            continue

        candidate_midis: list[int] = []
        stable_confidence = True
        for gap_index in range(gap_start, gap_end):
            value = float(f0[gap_index])
            conf = float(confidence[gap_index])
            if math.isnan(value) or conf < DEFAULT_VOICING_BRIDGE_CONFIDENCE:
                stable_confidence = False
                break
            midi = hz_to_midi(value)
            if abs(midi - left) > 1:
                stable_confidence = False
                break
            candidate_midis.append(midi)

        if not stable_confidence:
            continue

        bridged_pitch = round(sum(candidate_midis) / len(candidate_midis)) if candidate_midis else left
        for gap_index in range(gap_start, gap_end):
            smoothed[gap_index] = bridged_pitch

    return smoothed


def midi_frames_to_notes(
    midi_frames: Sequence[int | None],
    confidence: Sequence[float],
    *,
    hop_length: int,
    sample_rate: int,
    min_note_duration: float = DEFAULT_MIN_NOTE_DURATION,
    onset_confirm_frames: int = DEFAULT_ONSET_CONFIRM_FRAMES,
    pitch_change_confirm_frames: int = DEFAULT_PITCH_CHANGE_CONFIRM_FRAMES,
) -> list[NoteEvent]:
    """Segment stabilized MIDI frames into compact monophonic note events.

    We keep a light hysteresis layer here so noisy leading frames or single
    unstable frames do not immediately become committed notes. That makes the
    first committed onset more trustworthy and reduces "I didn't sing it that
    long / that high" artifacts.
    """
    notes: list[NoteEvent] = []
    note_start: float | None = None
    note_midi: int | None = None
    note_confs: list[float] = []
    pending_start: float | None = None
    pending_midi: int | None = None
    pending_confs: list[float] = []
    pending_frames = 0
    change_start: float | None = None
    change_midi: int | None = None
    change_confs: list[float] = []
    change_frames = 0
    onset_confirm_frames = max(1, onset_confirm_frames)
    pitch_change_confirm_frames = max(1, pitch_change_confirm_frames)

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

    def reset_pending() -> None:
        nonlocal pending_start, pending_midi, pending_confs, pending_frames
        pending_start = None
        pending_midi = None
        pending_confs = []
        pending_frames = 0

    def start_pending(timestamp: float, midi: int, frame_confidence: float) -> None:
        nonlocal pending_start, pending_midi, pending_confs, pending_frames
        pending_start = timestamp
        pending_midi = midi
        pending_confs = [frame_confidence]
        pending_frames = 1

    def commit_pending() -> None:
        nonlocal note_start, note_midi, note_confs
        if pending_start is None or pending_midi is None:
            return
        note_start = pending_start
        note_midi = pending_midi
        note_confs = pending_confs[:]
        reset_pending()

    def reset_change() -> None:
        nonlocal change_start, change_midi, change_confs, change_frames
        change_start = None
        change_midi = None
        change_confs = []
        change_frames = 0

    def begin_change(timestamp: float, midi: int | None, frame_confidence: float) -> None:
        nonlocal change_start, change_midi, change_confs, change_frames
        change_start = timestamp
        change_midi = midi
        change_confs = [frame_confidence]
        change_frames = 1

    for index, midi in enumerate(midi_frames):
        timestamp = index * hop_length / sample_rate
        if midi is None:
            if note_start is None:
                reset_pending()
                continue
            if change_frames > 0 and change_midi is None:
                change_confs.append(0.0)
                change_frames += 1
            else:
                begin_change(timestamp, None, 0.0)
            if change_frames >= pitch_change_confirm_frames:
                flush(change_start if change_start is not None else timestamp)
                reset_change()
            continue

        frame_confidence = float(confidence[index]) if index < len(confidence) else 0.7
        if note_start is None:
            if pending_start is None or pending_midi != midi:
                start_pending(timestamp, midi, frame_confidence)
            else:
                pending_confs.append(frame_confidence)
                pending_frames += 1
            if pending_frames >= onset_confirm_frames:
                commit_pending()
            continue

        if change_frames > 0:
            if midi == note_midi:
                note_confs.extend(change_confs)
                reset_change()
                note_confs.append(frame_confidence)
                continue
            if midi == change_midi:
                change_confs.append(frame_confidence)
                change_frames += 1
            else:
                begin_change(timestamp, midi, frame_confidence)
            if change_frames >= pitch_change_confirm_frames:
                flush(change_start if change_start is not None else timestamp)
                note_start = change_start if change_start is not None else timestamp
                note_midi = midi if midi == change_midi else change_midi
                note_confs = change_confs[:]
                reset_change()
            continue

        if midi != note_midi:
            begin_change(timestamp, midi, frame_confidence)
            if pitch_change_confirm_frames == 1:
                flush(timestamp)
                note_start = timestamp
                note_midi = midi
                note_confs = [frame_confidence]
                reset_change()
            continue

        note_confs.append(frame_confidence)

    flush(len(midi_frames) * hop_length / sample_rate)
    return notes


def f0_to_notes(
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
    onset_confirm_frames: int = DEFAULT_ONSET_CONFIRM_FRAMES,
    pitch_change_confirm_frames: int = DEFAULT_PITCH_CHANGE_CONFIRM_FRAMES,
) -> list[NoteEvent]:
    """Convert detector f0 frames to compact monophonic note events."""
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
        onset_confirm_frames=onset_confirm_frames,
        pitch_change_confirm_frames=pitch_change_confirm_frames,
    )


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
    onset_confirm_frames: int = DEFAULT_ONSET_CONFIRM_FRAMES,
    pitch_change_confirm_frames: int = DEFAULT_PITCH_CHANGE_CONFIRM_FRAMES,
) -> list[NoteEvent]:
    """Backward-compatible alias for older pYIN-oriented call sites."""
    return f0_to_notes(
        f0,
        voiced,
        confidence,
        hop_length=hop_length,
        sample_rate=sample_rate,
        min_confidence=min_confidence,
        low_midi=low_midi,
        high_midi=high_midi,
        min_note_duration=min_note_duration,
        onset_confirm_frames=onset_confirm_frames,
        pitch_change_confirm_frames=pitch_change_confirm_frames,
    )
