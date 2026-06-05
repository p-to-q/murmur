import json
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path


class BuildDatasetManifestTests(unittest.TestCase):
    def test_builds_manifest_from_local_audio_tree(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "build_dataset_manifest.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            dataset_root = tmp_path / "dataset"
            subset = dataset_root / "subset"
            subset.mkdir(parents=True)
            wav_path = subset / "take_a.wav"
            flac_path = subset / "take_b.flac"
            manifest_path = tmp_path / "manifest.json"
            expected_path = tmp_path / "expected.json"

            self._write_wav(wav_path)
            self._write_wav(flac_path)
            expected_path.write_text(json.dumps({
                "subset/take_a.wav": [60, 62, 64],
                "take_b": [67, 69],
            }))

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--root",
                    str(dataset_root),
                    "--out",
                    str(manifest_path),
                    "--family",
                    "humtrans",
                    "--source",
                    "public_dataset",
                    "--tag",
                    "real",
                    "--tag",
                    "humming",
                    "--expected-min-notes",
                    "2",
                    "--pitch-match-min",
                    "0.65",
                    "--music-feel-min",
                    "0.45",
                    "--expected-pitches-json",
                    str(expected_path),
                    "--name-mode",
                    "relative",
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            summary = json.loads(completed.stdout)
            payload = json.loads(manifest_path.read_text())

        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["family"], "humtrans")
        self.assertEqual(len(payload), 2)
        first = payload[0]
        self.assertEqual(first["family"], "humtrans")
        self.assertEqual(first["source"], "public_dataset")
        self.assertEqual(first["expected_min_notes"], 2)
        self.assertEqual(first["pitch_match_min"], 0.65)
        self.assertEqual(first["music_feel_min"], 0.45)
        self.assertEqual(first["tags"], ["real", "humming"])
        self.assertEqual(first["name"], "subset/take_a")
        self.assertEqual(first["expected_pitches"], [60, 62, 64])

    def test_ignores_macos_metadata_audio_entries(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "build_dataset_manifest.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            dataset_root = tmp_path / "dataset"
            audio_dir = dataset_root / "Audio"
            metadata_dir = dataset_root / "__MACOSX" / "Audio"
            audio_dir.mkdir(parents=True)
            metadata_dir.mkdir(parents=True)
            wav_path = audio_dir / "vocadito_1.wav"
            macos_path = metadata_dir / "._vocadito_1.wav"
            manifest_path = tmp_path / "manifest.json"

            self._write_wav(wav_path)
            self._write_wav(macos_path)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--root",
                    str(dataset_root),
                    "--out",
                    str(manifest_path),
                    "--family",
                    "vocadito",
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            summary = json.loads(completed.stdout)
            payload = json.loads(manifest_path.read_text())

        self.assertEqual(summary["count"], 1)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["path"], "Audio/vocadito_1.wav")

    @staticmethod
    def _write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(22050)
            handle.writeframes(b"\x00\x00" * 22050)


if __name__ == "__main__":
    unittest.main()
