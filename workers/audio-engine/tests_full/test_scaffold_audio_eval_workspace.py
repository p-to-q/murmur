import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class ScaffoldAudioEvalWorkspaceTests(unittest.TestCase):
    def test_scaffold_creates_expected_local_structure(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "scaffold_audio_eval_workspace.py"
        manifest_path = worker_dir / "tools" / "manifests" / "murmur-golden.local.json"
        pitch_map_path = worker_dir / "tools" / "pitch-maps" / "murmur-golden.local.json"
        original_manifest = manifest_path.read_text() if manifest_path.exists() else None
        original_pitch_map = pitch_map_path.read_text() if pitch_map_path.exists() else None

        try:
            manifest_path.unlink(missing_ok=True)
            pitch_map_path.unlink(missing_ok=True)

            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                root = tmp_path / "datasets"

                completed = subprocess.run(
                    [sys.executable, str(tool), "--root", str(root)],
                    cwd=worker_dir,
                    capture_output=True,
                    text=True,
                    check=True,
                )

                payload = json.loads(completed.stdout)
                self.assertEqual(payload["root"], str(root.resolve()))
                murmur = payload["datasets"]["murmur-golden"]
                self.assertTrue((root / "murmur-golden" / "familiar").exists())
                self.assertTrue((root / "murmur-golden" / "urgent").exists())
                self.assertTrue((root / "murmur-golden" / "repair").exists())
                self.assertTrue(Path(murmur["manifest"]).exists())
                self.assertTrue(Path(murmur["pitchMap"]).exists())
                self.assertEqual(Path(murmur["manifest"]).read_text(), "[]\n")
                self.assertEqual(Path(murmur["pitchMap"]).read_text(), "{}\n")
        finally:
            if original_manifest is None:
                manifest_path.unlink(missing_ok=True)
            else:
                manifest_path.write_text(original_manifest)
            if original_pitch_map is None:
                pitch_map_path.unlink(missing_ok=True)
            else:
                pitch_map_path.write_text(original_pitch_map)


if __name__ == "__main__":
    unittest.main()
