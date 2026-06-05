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

    def test_heals_confident_stable_voicing_gap_between_matching_notes(self):
        frames = stabilize_midi_frames(
            [261.63, 261.4, 261.2, 261.1, 261.3, 261.5],
            [True, False, False, False, False, True],
            [0.92, 0.84, 0.83, 0.82, 0.85, 0.91],
        )

        self.assertEqual(frames, [60, 60, 60, 60, 60, 60])

    def test_midi_frames_segment_into_notes(self):
        notes = midi_frames_to_notes(
            [60, 60, 60, 60, 62, 62, 62, 62, None, 64, 64, 64, 64, None],
            [0.8, 0.9, 0.88, 0.86, 0.7, 0.8, 0.78, 0.76, 0.0, 0.9, 0.9, 0.9, 0.88, 0.0],
            hop_length=100,
            sample_rate=1000,
            min_note_duration=0.15,
            onset_confirm_frames=1,
            pitch_change_confirm_frames=1,
        )

        self.assertEqual(
            notes,
            [
                {
                    "pitch": 60,
                    "start": 0.0,
                    "duration": 0.4,
                    "velocity": 0.731,
                    "confidence": 0.86,
                },
                {
                    "pitch": 62,
                    "start": 0.4,
                    "duration": 0.4,
                    "velocity": 0.646,
                    "confidence": 0.76,
                },
                {
                    "pitch": 64,
                    "start": 0.9,
                    "duration": 0.4,
                    "velocity": 0.761,
                    "confidence": 0.895,
                },
            ],
        )

    def test_pyin_to_notes_keeps_octave_guard_in_the_pipeline(self):
        notes = pyin_to_notes(
            [261.63, 523.25, 263.0, 293.66, 293.66, 293.66, 293.66],
            [True, True, True, True, True, True, True],
            [0.9, 0.9, 0.9, 0.8, 0.8, 0.82, 0.81],
            hop_length=100,
            sample_rate=1000,
            min_note_duration=0.15,
        )

        self.assertEqual([note["pitch"] for note in notes], [60, 62])

    def test_requires_confirmed_onset_before_committing_a_note(self):
        notes = midi_frames_to_notes(
            [67, 60, 60, 60, None],
            [0.62, 0.92, 0.94, 0.93, 0.0],
            hop_length=512,
            sample_rate=22050,
            onset_confirm_frames=2,
            pitch_change_confirm_frames=2,
        )

        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["pitch"], 60)
        self.assertAlmostEqual(notes[0]["start"], round(512 / 22050, 3), places=3)

    def test_ignores_single_frame_pitch_blips_inside_a_note(self):
        notes = midi_frames_to_notes(
            [60, 60, 67, 60, 60, None, None],
            [0.9, 0.9, 0.58, 0.92, 0.93, 0.0, 0.0],
            hop_length=512,
            sample_rate=22050,
            onset_confirm_frames=1,
            pitch_change_confirm_frames=2,
        )

        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["pitch"], 60)
        self.assertGreater(notes[0]["duration"], 0.11)

    def test_commits_real_pitch_change_after_two_frames(self):
        notes = midi_frames_to_notes(
            [60, 60, 60, 60, 62, 62, 62, 62, None, None],
            [0.9, 0.91, 0.92, 0.9, 0.88, 0.9, 0.89, 0.9, 0.0, 0.0],
            hop_length=512,
            sample_rate=22050,
            onset_confirm_frames=1,
            pitch_change_confirm_frames=2,
        )

        self.assertEqual(len(notes), 2)
        self.assertEqual([note["pitch"] for note in notes], [60, 62])
        self.assertLess(notes[0]["duration"], notes[1]["start"] + 0.001)


if __name__ == "__main__":
    unittest.main()
