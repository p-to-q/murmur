import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class SeedMurmurGoldenTests(unittest.TestCase):
    def test_seed_tool_writes_local_golden_audio_manifest_and_pitch_map(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "seed_murmur_golden.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            root = tmp_path / "datasets" / "murmur-golden"
            manifest_path = tmp_path / "manifests" / "murmur-golden.local.json"
            pitch_map_path = tmp_path / "pitch-maps" / "murmur-golden.local.json"

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--root",
                    str(root),
                    "--manifest",
                    str(manifest_path),
                    "--pitch-map",
                    str(pitch_map_path),
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            summary = json.loads(completed.stdout)
            manifest = json.loads(manifest_path.read_text())
            pitch_map = json.loads(pitch_map_path.read_text())
            self.assertEqual(summary["count"], 9)
            self.assertEqual(summary["bucketCounts"]["repair"], 1)
            self.assertTrue((root / "repair" / "overheld_middle_phrase.wav").exists())
            self.assertTrue((root / "urgent" / "urgent_hook_fragment.wav").exists())
            self.assertEqual(len(manifest), 9)
            self.assertEqual(manifest[0]["family"], "murmur_golden_seeded")
            self.assertIn("seeded", manifest[0]["tags"])
            self.assertIn("repair/overheld_middle_phrase.wav", pitch_map)


if __name__ == "__main__":
    unittest.main()
