import importlib.util
import json
import math
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path


def has_worker_deps() -> bool:
    return all(
        importlib.util.find_spec(module) is not None
        for module in ("librosa", "numpy", "soundfile")
    )


@unittest.skipUnless(has_worker_deps(), "audio worker runtime deps are not installed")
class AudioAuditTests(unittest.TestCase):
    def test_pitch_match_score_is_alignment_tolerant(self):
        from tools.audio_audit import pitch_match_score

        score = pitch_match_score(
            [60, 62, 64, 65],
            [
                {"pitch": 60},
                {"pitch": 61},
                {"pitch": 62},
                {"pitch": 64},
                {"pitch": 65},
            ],
        )

        self.assertGreaterEqual(score, 0.88)

    def test_pitch_match_score_penalizes_wrong_contour(self):
        from tools.audio_audit import pitch_match_score

        score = pitch_match_score(
            [60, 62, 64, 65],
            [
                {"pitch": 60},
                {"pitch": 67},
                {"pitch": 69},
                {"pitch": 71},
            ],
        )

        self.assertLessEqual(score, 0.3)

    def test_select_pitch_match_score_can_use_best_reference(self):
        from tools.audio_audit import select_pitch_match_score

        score, label = select_pitch_match_score(
            [60, 62, 64, 65],
            [
                {"label": "A1", "pitches": [60, 62, 64, 65]},
                {"label": "A2", "pitches": [60, 64, 65]},
            ],
            [
                {"pitch": 60},
                {"pitch": 64},
                {"pitch": 65},
            ],
        )

        self.assertEqual(score, 1.0)
        self.assertEqual(label, "A2")

        primary_score, primary_label = select_pitch_match_score(
            [60, 62, 64],
            [{"label": "A2", "pitches": [60, 64]}],
            [{"pitch": 60}, {"pitch": 62}, {"pitch": 64}],
        )
        self.assertEqual(primary_score, 1.0)
        self.assertEqual(primary_label, "primary")

    def test_select_pitch_match_score_can_use_octave_equivalent_reference(self):
        from tools.audio_audit import select_pitch_match_score

        score, label = select_pitch_match_score(
            [48, 50, 52],
            [
                {"label": "A1", "pitches": [48, 50, 52]},
                {"label": "A1+12", "pitches": [60, 62, 64]},
            ],
            [{"pitch": 60}, {"pitch": 62}, {"pitch": 64}],
        )

        self.assertEqual(score, 1.0)
        self.assertEqual(label, "A1+12")

    def test_audio_audit_runs_and_emits_summary(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_audit.py"

        completed = subprocess.run(
            [sys.executable, str(tool), "--provider", "pyin"],
            cwd=worker_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(completed.stdout)

        self.assertEqual(payload["providers"], ["pyin"])
        self.assertEqual(payload["sampleRate"], 22050)
        self.assertEqual(len(payload["runs"]), 1)
        self.assertEqual(payload["runs"][0]["provider"], "pyin")
        self.assertGreaterEqual(len(payload["runs"][0]["cases"]), 12)
        self.assertIn("summary", payload["runs"][0])
        self.assertIn("repairTriggeredCount", payload["runs"][0]["summary"])
        self.assertIn("providerReroutedCount", payload["runs"][0]["summary"])
        self.assertIn("medianPitchMs", payload["runs"][0]["summary"])
        familiar_cases = {
            case["case"]: case for case in payload["runs"][0]["cases"]
            if case["case"] in {"two_tigers_phrase", "brightest_star_hook"}
        }
        self.assertEqual(set(familiar_cases.keys()), {"two_tigers_phrase", "brightest_star_hook"})
        for case in familiar_cases.values():
            self.assertIn("pitchMatchScore", case)
            self.assertIn("musicFeel", case)
            self.assertIn("diagnostics", case)
            self.assertIn("acceptanceScore", case["diagnostics"])
            self.assertIn("noteHypothesis", case["diagnostics"])
            self.assertIn("noteDensity", case["diagnostics"])
            self.assertIn("noteProposalProfile", case["diagnostics"])
        pyin_cases = {
            case["case"]: case for case in payload["runs"][0]["cases"]
            if case["provider"] == "pyin"
        }
        if pyin_cases:
            self.assertTrue(all("providerRerouted" in case["diagnostics"] for case in pyin_cases.values()))
        named_cases = {
            case["case"]: case for case in payload["runs"][0]["cases"]
            if case["case"] in {"overheld_middle_phrase", "pitch_weak_stable_phrase", "urgent_hook_fragment"}
        }
        self.assertEqual(
            set(named_cases.keys()),
            {"overheld_middle_phrase", "pitch_weak_stable_phrase", "urgent_hook_fragment"},
        )
        self.assertEqual(named_cases["overheld_middle_phrase"]["status"], "pass")
        self.assertEqual(named_cases["overheld_middle_phrase"]["diagnostics"]["noteHypothesis"], "repair_split")
        self.assertGreater(named_cases["urgent_hook_fragment"]["musicFeel"]["urgentCoherence"], 0.2)
        self.assertGreater(named_cases["urgent_hook_fragment"]["musicFeel"]["score"], 0.8)
        expressive_cases = {
            case["case"]: case for case in payload["runs"][0]["cases"]
            if case["case"] in {"glide_phrase", "vibrato_phrase"}
        }
        self.assertEqual(set(expressive_cases.keys()), {"glide_phrase", "vibrato_phrase"})
        for case in expressive_cases.values():
            self.assertIn("noteProposalProfile", case["diagnostics"])

    def test_audio_audit_strict_gate_passes_current_expectations(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_audit.py"

        completed = subprocess.run(
            [sys.executable, str(tool), "--all-providers", "--strict"],
            cwd=worker_dir,
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(completed.stdout)

        self.assertIn("gate", payload)
        self.assertTrue(payload["gate"]["ok"])
        self.assertEqual(payload["gate"]["failures"], [])

    def test_audio_audit_can_load_extra_manifest_cases(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_audit.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            wav_path = tmp_path / "case.wav"
            manifest_path = tmp_path / "manifest.json"

            with wave.open(str(wav_path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(22050)
                frames = bytearray()
                for sample_index in range(int(22050 * 0.5)):
                    value = int(12000 * math.sin(2 * math.pi * 261.63 * sample_index / 22050))
                    frames.extend(value.to_bytes(2, "little", signed=True))
                handle.writeframes(bytes(frames))

            manifest_path.write_text(json.dumps([
                {
                    "name": "temp_manifest_case",
                    "family": "humtrans",
                    "source": "public_dataset",
                    "path": "case.wav",
                    "expected_min_notes": 1,
                    "expected_pitches": [60],
                    "pitch_match_min": 0.7,
                    "music_feel_min": 0.45,
                    "tags": ["manifest", "real"],
                }
            ]))

            completed = subprocess.run(
                [sys.executable, str(tool), "--provider", "auto", "--manifest", str(manifest_path)],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

        payload = json.loads(completed.stdout)
        cases = payload["runs"][0]["cases"]
        named_case = next(case for case in cases if case["case"] == "temp_manifest_case")
        self.assertEqual(named_case["family"], "humtrans")
        self.assertEqual(named_case["source"], "public_dataset")
        self.assertEqual(named_case["thresholds"]["pitchMatchMin"], 0.7)
        self.assertEqual(named_case["thresholds"]["musicFeelMin"], 0.45)
        self.assertIn("expectedPitchSets", named_case)
        self.assertIn("p95PitchMs", payload["runs"][0]["summary"])
        self.assertIn("families", payload["runs"][0]["summary"])
        self.assertIn("humtrans", payload["runs"][0]["summary"]["families"])
        self.assertIn("tags", payload["runs"][0]["summary"])
        self.assertIn("real", payload["runs"][0]["summary"]["tags"])


if __name__ == "__main__":
    unittest.main()
