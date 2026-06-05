import importlib.util
import json
import ssl
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import wave
import zipfile
from pathlib import Path
from unittest.mock import patch

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "prepare_public_dataset.py"
MODULE_SPEC = importlib.util.spec_from_file_location("prepare_public_dataset_module", MODULE_PATH)
assert MODULE_SPEC is not None and MODULE_SPEC.loader is not None
PREPARE_DATASET_MODULE = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = PREPARE_DATASET_MODULE
MODULE_SPEC.loader.exec_module(PREPARE_DATASET_MODULE)


class PreparePublicDatasetTests(unittest.TestCase):
    def test_describe_vocadito_preset(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "prepare_public_dataset.py"

        completed = subprocess.run(
            [sys.executable, str(tool), "vocadito", "--describe"],
            cwd=worker_dir,
            capture_output=True,
            text=True,
            check=True,
        )

        payload = json.loads(completed.stdout)
        self.assertEqual(payload["dataset"], "vocadito")
        self.assertEqual(payload["preset"]["family"], "vocadito")
        self.assertIn("downloadUrl", payload["preset"])

    def test_extracts_archive_and_builds_manifest(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "prepare_public_dataset.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_path = tmp_path / "vocadito.zip"
            extract_root = tmp_path / "vocadito"
            manifest_out = tmp_path / "vocadito.local.json"
            pitch_map_out = tmp_path / "vocadito.local.pitch-map.json"
            nested_audio_dir = tmp_path / "payload" / "vocadito_pack" / "audio"
            notes_dir = tmp_path / "payload" / "vocadito_pack" / "Annotations" / "Notes"
            nested_audio_dir.mkdir(parents=True)
            notes_dir.mkdir(parents=True)
            self._write_wav(nested_audio_dir / "vocadito_1.wav")
            self._write_wav(nested_audio_dir / "vocadito_2.wav")
            (notes_dir / "vocadito_1_notesA1.csv").write_text("0.0,261.63,0.4\n0.5,293.66,0.4\n1.0,329.63,0.4\n")
            (notes_dir / "vocadito_1_notesA2.csv").write_text("0.0,261.63,0.5\n0.7,329.63,0.4\n")

            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.write(
                    nested_audio_dir / "vocadito_1.wav",
                    arcname="vocadito_pack/audio/vocadito_1.wav",
                )
                archive.write(
                    nested_audio_dir / "vocadito_2.wav",
                    arcname="vocadito_pack/audio/vocadito_2.wav",
                )
                archive.write(
                    notes_dir / "vocadito_1_notesA1.csv",
                    arcname="vocadito_pack/Annotations/Notes/vocadito_1_notesA1.csv",
                )
                archive.write(
                    notes_dir / "vocadito_1_notesA2.csv",
                    arcname="vocadito_pack/Annotations/Notes/vocadito_1_notesA2.csv",
                )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "vocadito",
                    "--archive",
                    str(archive_path),
                    "--extract",
                    "--root",
                    str(extract_root),
                    "--manifest-out",
                    str(manifest_out),
                    "--pitch-map-out",
                    str(pitch_map_out),
                    "--limit",
                    "1",
                    "--name-mode",
                    "relative",
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(completed.stdout)
            manifest = json.loads(manifest_out.read_text())
            pitch_map = json.loads(pitch_map_out.read_text())

        self.assertEqual(payload["manifestBuild"]["count"], 1)
        self.assertEqual(payload["manifestBuild"]["audioRoot"], str((extract_root / "vocadito_pack" / "audio").resolve()))
        self.assertEqual(payload["manifestBuild"]["annotatedCases"], 1)
        self.assertEqual(len(manifest), 1)
        self.assertEqual(manifest[0]["family"], "vocadito")
        self.assertEqual(manifest[0]["path"], "vocadito_pack/audio/vocadito_1.wav")
        self.assertEqual(manifest[0]["expected_pitches"], [60, 62, 64])
        self.assertEqual(manifest[0]["expected_min_notes"], 3)
        self.assertEqual(
            manifest[0]["expected_pitch_sets"],
            [
                {"label": "A1", "pitches": [60, 62, 64]},
                {"label": "A1+12", "pitches": [72, 74, 76]},
                {"label": "A1-12", "pitches": [48, 50, 52]},
                {"label": "A2", "pitches": [60, 64]},
                {"label": "A2+12", "pitches": [72, 76]},
                {"label": "A2-12", "pitches": [48, 52]},
            ],
        )
        self.assertEqual(manifest[0]["tags"], ["real", "singing", "annotated", "a1"])
        self.assertEqual(manifest[0]["name"], "vocadito_pack/audio/vocadito_1")
        self.assertEqual(pitch_map["vocadito_1"], [60, 62, 64])

    def test_large_download_requires_explicit_opt_in(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "prepare_public_dataset.py"

        completed = subprocess.run(
            [sys.executable, str(tool), "humtrans", "--download"],
            cwd=worker_dir,
            capture_output=True,
            text=True,
        )

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("allow-large-download", completed.stderr or completed.stdout)

    def test_humtrans_split_can_stage_a_small_local_subset(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "prepare_public_dataset.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            source_root = tmp_path / "humtrans_full"
            audio_dir = source_root / "all_wav" / "train"
            audio_dir.mkdir(parents=True)
            stage_root = tmp_path / "humtrans_stage"
            manifest_out = tmp_path / "humtrans.local.json"
            pitch_map_out = tmp_path / "humtrans.local.pitch-map.json"
            split_keys = tmp_path / "train_valid_test_keys.json"

            self._write_wav(audio_dir / "hum_a.wav")
            self._write_wav(audio_dir / "hum_b.wav")
            self._write_wav(audio_dir / "hum_c.wav")
            split_keys.write_text(json.dumps({
                "train": ["hum_a", "hum_b"],
                "valid": ["hum_c"],
                "test": [],
            }))

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "humtrans",
                    "--root",
                    str(source_root),
                    "--manifest-out",
                    str(manifest_out),
                    "--pitch-map-out",
                    str(pitch_map_out),
                    "--split",
                    "train",
                    "--split-keys",
                    str(split_keys),
                    "--limit",
                    "1",
                    "--stage-root",
                    str(stage_root),
                    "--stage-clean",
                    "--name-mode",
                    "relative",
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(completed.stdout)
            manifest = json.loads(manifest_out.read_text())
            staged_file = stage_root / manifest[0]["path"]

            self.assertEqual(payload["splitSelection"]["split"], "train")
            self.assertEqual(payload["manifestBuild"]["sourceAudioCount"], 3)
            self.assertEqual(payload["manifestBuild"]["selectedBeforeLimit"], 2)
            self.assertEqual(payload["manifestBuild"]["count"], 1)
            self.assertEqual(payload["manifestBuild"]["stagedCount"], 1)
            self.assertEqual(payload["manifestBuild"]["split"], "train")
            self.assertTrue(staged_file.exists())
            self.assertIn(manifest[0]["path"], {"all_wav/train/hum_a.wav", "all_wav/train/hum_b.wav"})
            self.assertEqual(manifest[0]["family"], "humtrans")
            self.assertEqual(manifest[0]["tags"], ["real", "humming"])

    def test_humtrans_archive_can_stage_subset_without_full_extract(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "prepare_public_dataset.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            archive_path = tmp_path / "humtrans-all_wav.zip"
            midi_archive_path = tmp_path / "humtrans-all_midi.zip"
            source_payload = tmp_path / "payload" / "all_wav" / "valid"
            source_payload.mkdir(parents=True)
            midi_payload = tmp_path / "payload" / "all_midi" / "valid"
            midi_payload.mkdir(parents=True)
            split_keys = tmp_path / "train_valid_test_keys.json"
            stage_root = tmp_path / "humtrans_stage"
            manifest_out = tmp_path / "humtrans.local.json"
            pitch_map_out = tmp_path / "humtrans.local.pitch-map.json"

            self._write_wav(source_payload / "hum_v1.wav")
            self._write_wav(source_payload / "hum_v2.wav")
            self._write_wav(source_payload / "hum_t1.wav")
            self._write_midi(midi_payload / "hum_v1.mid", [60, 64])
            self._write_midi(midi_payload / "hum_v2.mid", [62, 65])
            self._write_midi(midi_payload / "hum_t1.mid", [67, 69])
            split_keys.write_text(json.dumps({
                "train": ["hum_t1"],
                "valid": ["hum_v1", "hum_v2"],
                "test": [],
            }))

            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.write(source_payload / "hum_v1.wav", arcname="all_wav/valid/hum_v1.wav")
                archive.write(source_payload / "hum_v2.wav", arcname="all_wav/valid/hum_v2.wav")
                archive.write(source_payload / "hum_t1.wav", arcname="all_wav/valid/hum_t1.wav")
            with zipfile.ZipFile(midi_archive_path, "w") as archive:
                archive.write(midi_payload / "hum_v1.mid", arcname="all_midi/valid/hum_v1.mid")
                archive.write(midi_payload / "hum_v2.mid", arcname="all_midi/valid/hum_v2.mid")
                archive.write(midi_payload / "hum_t1.mid", arcname="all_midi/valid/hum_t1.mid")

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "humtrans",
                    "--archive",
                    str(archive_path),
                    "--split",
                    "valid",
                    "--split-keys",
                    str(split_keys),
                    "--midi-archive",
                    str(midi_archive_path),
                    "--limit",
                    "1",
                    "--stage-root",
                    str(stage_root),
                    "--stage-clean",
                    "--manifest-out",
                    str(manifest_out),
                    "--pitch-map-out",
                    str(pitch_map_out),
                    "--name-mode",
                    "relative",
                ],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

            payload = json.loads(completed.stdout)
            manifest = json.loads(manifest_out.read_text())
            pitch_map = json.loads(pitch_map_out.read_text())
            staged_file = stage_root / manifest[0]["path"]

            self.assertEqual(payload["splitSelection"]["split"], "valid")
            self.assertEqual(payload["manifestBuild"]["sourceAudioCount"], 3)
            self.assertEqual(payload["manifestBuild"]["selectedBeforeLimit"], 2)
            self.assertEqual(payload["manifestBuild"]["count"], 1)
            self.assertTrue(payload["manifestBuild"]["sourceArchiveMode"])
            self.assertEqual(payload["manifestBuild"]["annotatedCases"], 1)
            self.assertEqual(payload["stagedMembers"], 1)
            self.assertTrue(staged_file.exists())
            self.assertIn(manifest[0]["path"], {"all_wav/valid/hum_v1.wav", "all_wav/valid/hum_v2.wav"})
            self.assertIn(manifest[0]["expected_pitches"], ([60, 64], [62, 65]))
            self.assertIn("midi_ref", manifest[0]["tags"])
            self.assertEqual(pitch_map[Path(manifest[0]["path"]).stem], manifest[0]["expected_pitches"])

    def test_remote_zip_reader_supports_standard_and_zip64_archives(self):
        for force_zip64 in (False, True):
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                archive_path = tmp_path / ("zip64.zip" if force_zip64 else "standard.zip")
                payload_path = tmp_path / "payload.mid"
                self._write_midi(payload_path, [60, 64, 67])

                with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    if force_zip64:
                        with archive.open("all_midi/valid/payload.mid", "w", force_zip64=True) as handle:
                            handle.write(payload_path.read_bytes())
                    else:
                        archive.write(payload_path, arcname="all_midi/valid/payload.mid")

                data = archive_path.read_bytes()
                reader = PREPARE_DATASET_MODULE.RemoteZipReader(
                    len(data),
                    lambda start, end, blob=data: blob[start:end + 1],
                )
                entries = reader.list_entries()
                self.assertEqual(len(entries), 1)
                entry = entries[0]
                extracted = reader.extract_entry(entry)
                self.assertEqual(extracted, payload_path.read_bytes())

    def test_fetch_remote_range_retries_ssl_eof_once(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return b"ok"

        attempts = {"count": 0}

        def fake_urlopen(_request):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise urllib.error.URLError(ssl.SSLEOFError(8, "EOF occurred in violation of protocol"))
            return FakeResponse()

        with patch.object(PREPARE_DATASET_MODULE.urllib.request, "urlopen", side_effect=fake_urlopen):
            payload = PREPARE_DATASET_MODULE.fetch_remote_range("https://example.com/archive.zip", 0, 10)

        self.assertEqual(payload, b"ok")
        self.assertEqual(attempts["count"], 2)

    @staticmethod
    def _write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(22050)
            handle.writeframes(b"\x00\x00" * 22050)

    @staticmethod
    def _write_midi(path: Path, notes: list[int]) -> None:
        def vlq(value: int) -> bytes:
            chunks = [value & 0x7F]
            value >>= 7
            while value:
                chunks.append(0x80 | (value & 0x7F))
                value >>= 7
            return bytes(reversed(chunks))

        track = bytearray()
        for note in notes:
            track.extend(vlq(0))
            track.extend([0x90, note, 64])
            track.extend(vlq(240))
            track.extend([0x80, note, 0])
        track.extend(vlq(0))
        track.extend([0xFF, 0x2F, 0x00])

        data = bytearray()
        data.extend(b"MThd")
        data.extend((6).to_bytes(4, "big"))
        data.extend((0).to_bytes(2, "big"))
        data.extend((1).to_bytes(2, "big"))
        data.extend((480).to_bytes(2, "big"))
        data.extend(b"MTrk")
        data.extend(len(track).to_bytes(4, "big"))
        data.extend(track)
        path.write_bytes(bytes(data))


if __name__ == "__main__":
    unittest.main()
