import math
import unittest

from audio_engine.frames import (
    hz_to_midi,
    midi_frames_to_notes,
    pyin_to_notes,
    stabilize_midi_frames,
)


class FrameSegmentationTests(unittest.TestCase):
    def test_hz_to_midi_rounds_to_nearest_pitch(self):
        self.assertEqual(hz_to_midi(440.0), 69)
        self.assertEqual(hz_to_midi(261.63), 60)

    def test_octave_blip_is_suppressed(self):
        frames = stabilize_midi_frames(
            [261.63, 523.25, 263.0],
            [True, True, True],
            [0.9, 0.9, 0.9],
        )

        self.assertEqual(frames, [60, 60, 60])

    def test_low_confidence_and_out_of_range_frames_become_silence(self):
        frames = stabilize_midi_frames(
            [261.63, 440.0, 30.0, math.nan],
            [True, True, True, True],
            [0.9, 0.2, 0.9, 0.9],
        )

        self.assertEqual(frames, [60, None, None, None])

    def test_midi_frames_segment_into_notes(self):
        notes = midi_frames_to_notes(
            [60, 60, 62, 62, None, 64, 64, 64],
            [0.8, 0.9, 0.7, 0.8, 0.0, 0.9, 0.9, 0.9],
            hop_length=100,
            sample_rate=1000,
            min_note_duration=0.15,
        )

        self.assertEqual(
            notes,
            [
                {
                    "pitch": 60,
                    "start": 0.0,
                    "duration": 0.2,
                    "velocity": 0.723,
                    "confidence": 0.85,
                },
                {
                    "pitch": 62,
                    "start": 0.2,
                    "duration": 0.2,
                    "velocity": 0.637,
                    "confidence": 0.75,
                },
                {
                    "pitch": 64,
                    "start": 0.5,
                    "duration": 0.3,
                    "velocity": 0.765,
                    "confidence": 0.9,
                },
            ],
        )

    def test_pyin_to_notes_keeps_octave_guard_in_the_pipeline(self):
        notes = pyin_to_notes(
            [261.63, 523.25, 263.0, 293.66, 293.66],
            [True, True, True, True, True],
            [0.9, 0.9, 0.9, 0.8, 0.8],
            hop_length=100,
            sample_rate=1000,
            min_note_duration=0.15,
        )

        self.assertEqual([note["pitch"] for note in notes], [60, 62])


if __name__ == "__main__":
    unittest.main()
