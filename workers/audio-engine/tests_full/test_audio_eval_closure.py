import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class AudioEvalClosureTests(unittest.TestCase):
    def test_closure_runs_required_baseline_and_skips_missing_optional_suite(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "synthetic_baseline",
                        "required": True,
                        "strict": True,
                        "allProviders": True,
                    },
                    {
                        "name": "missing_optional_manifest",
                        "required": False,
                        "strict": False,
                        "allProviders": True,
                        "manifest": "tools/manifests/does-not-exist.json",
                    },
                ]
            }))

            completed = subprocess.run(
                [sys.executable, str(tool), "--config", str(config_path)],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=True,
            )

        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(len(payload["suites"]), 2)
        self.assertIn("summary", payload)
        baseline = next(item for item in payload["suites"] if item["name"] == "synthetic_baseline")
        self.assertEqual(baseline["status"], "ok")
        self.assertTrue(baseline["result"]["ok"])
        optional = next(item for item in payload["suites"] if item["name"] == "missing_optional_manifest")
        self.assertEqual(optional["status"], "skipped_missing_manifest")
        self.assertTrue(optional["ok"])
        self.assertTrue(payload["summary"]["missingOptionalManifests"])
        self.assertTrue(payload["summary"]["nextActions"])

    def test_closure_fails_on_missing_required_manifest(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "required_manifest",
                        "required": True,
                        "strict": False,
                        "allProviders": True,
                        "manifest": "tools/manifests/does-not-exist.json",
                    }
                ]
            }))

            completed = subprocess.run(
                [sys.executable, str(tool), "--config", str(config_path)],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(completed.returncode, 1)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["suites"][0]["status"], "missing_required_manifest")
        self.assertEqual(payload["summary"]["requiredFailed"], ["required_manifest"])

    def test_closure_skips_empty_optional_manifest(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"
        manifest_dir = worker_dir / "tools" / "manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / "murmur-golden.local.json"
        original_contents = manifest_path.read_text() if manifest_path.exists() else None

        try:
            manifest_path.write_text("[]\n")
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                config_path = tmp_path / "closure.json"
                config_path.write_text(json.dumps({
                    "suites": [
                        {
                            "name": "empty_optional_manifest",
                            "required": False,
                            "strict": False,
                            "allProviders": True,
                            "manifest": "tools/manifests/murmur-golden.local.json",
                        }
                    ]
                }))

                completed = subprocess.run(
                    [sys.executable, str(tool), "--config", str(config_path)],
                    cwd=worker_dir,
                    capture_output=True,
                    text=True,
                    check=True,
                )

            payload = json.loads(completed.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["suites"][0]["status"], "skipped_empty_manifest")
            self.assertTrue(payload["summary"]["emptyOptionalManifests"])
            self.assertTrue(
                any(
                    "seed-golden" in action
                    for action in payload["summary"]["nextActions"]
                )
            )
        finally:
            if original_contents is None:
                manifest_path.unlink(missing_ok=True)
            else:
                manifest_path.write_text(original_contents)

    def test_closure_mentions_humtrans_when_it_is_the_only_empty_optional_manifest(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"
        manifest_dir = worker_dir / "tools" / "manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / "humtrans.local.json"
        original_contents = manifest_path.read_text() if manifest_path.exists() else None

        try:
            manifest_path.write_text("[]\n")
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                config_path = tmp_path / "closure.json"
                config_path.write_text(json.dumps({
                    "suites": [
                        {
                            "name": "humtrans_optional_manifest",
                            "required": False,
                            "strict": False,
                            "allProviders": True,
                            "manifest": "tools/manifests/humtrans.local.json",
                        }
                    ]
                }))

                completed = subprocess.run(
                    [sys.executable, str(tool), "--config", str(config_path)],
                    cwd=worker_dir,
                    capture_output=True,
                    text=True,
                    check=True,
                )

            payload = json.loads(completed.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["suites"][0]["status"], "skipped_empty_manifest")
            self.assertTrue(
                any(
                    "HumTrans" in action
                    for action in payload["summary"]["nextActions"]
                )
            )
        finally:
            if original_contents is None:
                manifest_path.unlink(missing_ok=True)
            else:
                manifest_path.write_text(original_contents)

    def test_closure_passes_manifest_case_limit_through_to_audio_audit(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"
        manifest_dir = worker_dir / "tools" / "manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / "limited.local.json"

        manifest_path.write_text(json.dumps([
            {
                "name": "one",
                "path": "missing-a.wav",
            },
            {
                "name": "two",
                "path": "missing-b.wav",
            },
        ]))

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "limited_suite",
                        "required": False,
                        "strict": False,
                        "allProviders": True,
                        "manifest": "tools/manifests/limited.local.json",
                        "manifestCaseLimit": 1,
                    }
                ]
            }))

            completed = subprocess.run(
                [sys.executable, str(tool), "--config", str(config_path)],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=False,
            )

        payload = json.loads(completed.stdout)
        self.assertEqual(completed.returncode, 1)
        suite = payload["suites"][0]
        self.assertEqual(suite["status"], "failed")
        self.assertIn("--manifest-case-limit", suite["command"])
        self.assertIn("missing-a.wav", suite["stderr"])

    def test_closure_passes_manifest_only_through_to_audio_audit(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"
        manifest_dir = worker_dir / "tools" / "manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_dir / "manifest-only.local.json"

        manifest_path.write_text(json.dumps([
            {
                "name": "one",
                "path": "missing-a.wav",
            }
        ]))

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "manifest_only_suite",
                        "required": False,
                        "strict": False,
                        "allProviders": True,
                        "manifest": "tools/manifests/manifest-only.local.json",
                        "manifestOnly": True,
                    }
                ]
            }))

            completed = subprocess.run(
                [sys.executable, str(tool), "--config", str(config_path)],
                cwd=worker_dir,
                capture_output=True,
                text=True,
                check=False,
            )

        payload = json.loads(completed.stdout)
        self.assertEqual(completed.returncode, 1)
        suite = payload["suites"][0]
        self.assertEqual(suite["status"], "failed")
        self.assertIn("--manifest-only", suite["command"])
        self.assertIn("missing-a.wav", suite["stderr"])

    def test_closure_marks_soft_pitch_families_as_weak(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            report_path = tmp_path / "closure.md"
            stub_audit = tmp_path / "stub_audit.py"
            stub_audit.write_text(
                "import json\n"
                "print(json.dumps({\n"
                "  'runs': [{\n"
                "    'provider': 'auto',\n"
                "    'cases': [{\n"
                "      'case': 'humtrans_warn_case',\n"
                "      'provider': 'pyin',\n"
                "      'status': 'warn',\n"
                "      'pitchMatchScore': 0.83,\n"
                "      'musicFeel': {'score': 0.83},\n"
                "      'diagnostics': {\n"
                "        'noteHypothesis': 'balanced',\n"
                "        'pitchMs': 412.0,\n"
                "        'providerPitchMs': 380.0,\n"
                "        'ensembleDecision': 'highest_score',\n"
                "        'acceptanceScore': 0.83,\n"
                "        'firstOnsetLag': 0.0,\n"
                "        'onsetFragmentation': 0.12,\n"
                "        'rushedRatio': 0.18,\n"
                "        'interiorHoldRatio': 0.0,\n"
                "        'excessiveHoldRatio': 0.0,\n"
                "        'voicedRatio': 0.88\n"
                "      }\n"
                "    }],\n"
                "    'summary': {\n"
                "      'families': {\n"
                "        'humtrans': {\n"
                "          'cases': 4,\n"
                "          'pass': 3,\n"
                "          'warn': 1,\n"
                "          'fail': 0,\n"
                "          'error': 0,\n"
                "          'avgPitchMatchScore': 0.74,\n"
                "          'avgMusicFeelScore': 0.83\n"
                "        }\n"
                "      },\n"
                "      'tags': {\n"
                "        'real': {\n"
                "          'cases': 4,\n"
                "          'pass': 3,\n"
                "          'warn': 1,\n"
                "          'fail': 0,\n"
                "          'error': 0,\n"
                "          'avgPitchMatchScore': 0.74,\n"
                "          'avgMusicFeelScore': 0.83\n"
                "        }\n"
                "      },\n"
                "      'avgPitchMatchScore': 0.74,\n"
                "      'avgMusicFeelScore': 0.83,\n"
                "      'warn': 1,\n"
                "      'fail': 0,\n"
                "      'error': 0,\n"
                "      'p95PitchMs': 140.0\n"
                "    }\n"
                "  }],\n"
                "  'gate': {'ok': True}\n"
                "}))\n"
            )
            manifest_path = tmp_path / "manifest.json"
            manifest_path.write_text('[{"name":"sample","path":"sample.wav"}]\n')
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "humtrans_local",
                        "required": False,
                        "strict": False,
                        "allProviders": True,
                        "manifest": str(manifest_path),
                    }
                ]
            }))

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--config",
                    str(config_path),
                    "--markdown-out",
                    str(report_path),
                ],
                cwd=worker_dir,
                env={
                    **os.environ,
                    "MURMUR_AUDIO_AUDIT_PATH": str(stub_audit),
                },
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertTrue(report_path.exists())
            report = report_path.read_text()

        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["summary"]["realDataSuites"], ["humtrans_local"])
        self.assertTrue(payload["summary"]["weakFamilies"])
        self.assertEqual(payload["summary"]["weakFamilies"][0]["scope"], "auto:humtrans")
        self.assertTrue(payload["summary"]["weakCases"])
        self.assertEqual(payload["summary"]["weakCases"][0]["case"], "humtrans_warn_case")
        self.assertTrue(payload["summary"]["slowCases"])
        self.assertEqual(payload["summary"]["slowCases"][0]["case"], "humtrans_warn_case")
        self.assertTrue(payload["summary"]["latencyArchetypes"])
        self.assertEqual(payload["summary"]["latencyArchetypes"][0]["kind"], "quality_tail")
        self.assertEqual(payload["summary"]["engineeringTailSubfamilies"], [])
        self.assertTrue(payload["summary"]["primaryPathSlowProviders"])
        self.assertEqual(payload["summary"]["primaryPathSlowProviders"][0]["provider"], "auto")
        self.assertTrue(
            any(
                action == "Review pitch latency for provider auto in suite humtrans_local."
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertTrue(
            any(
                "weakest concrete case" in action
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertTrue(
            any(
                "slowest concrete case" in action
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertTrue(
            any(
                "quality-tail case" in action
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertIn("pitch match is soft", payload["summary"]["weakFamilies"][0]["reasons"])
        self.assertIn("Primary-path slow providers", report)
        self.assertIn("Weak families", report)
        self.assertIn("Weak cases", report)
        self.assertIn("Slow cases", report)
        self.assertIn("Latency archetypes", report)
        self.assertIn("auto:humtrans", report)

    def test_closure_classifies_engineering_tail_subfamilies(self):
        worker_dir = Path(__file__).resolve().parents[1]
        tool = worker_dir / "tools" / "audio_eval_closure.py"

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            config_path = tmp_path / "closure.json"
            report_path = tmp_path / "closure.md"
            stub_audit = tmp_path / "stub_audit.py"
            stub_audit.write_text(
                "import json\n"
                "print(json.dumps({\n"
                "  'runs': [{\n"
                "    'provider': 'auto',\n"
                "    'cases': [\n"
                "      {\n"
                "        'case': 'vocadito_compact',\n"
                "        'provider': 'swiftf0',\n"
                "        'status': 'pass',\n"
                "        'pitchMatchScore': 0.84,\n"
                "        'musicFeel': {'score': 0.78},\n"
                "        'diagnostics': {\n"
                "          'pitchMs': 1650.0,\n"
                "          'providerPitchMs': 180.0,\n"
                "          'ensembleDecision': 'highest_score',\n"
                "          'alternateReviewMode': 'light_no_repair_compact',\n"
                "          'acceptanceScore': 0.81,\n"
                "          'firstOnsetLag': 0.0,\n"
                "          'onsetFragmentation': 0.2,\n"
                "          'rushedRatio': 0.41,\n"
                "          'interiorHoldRatio': 0.02,\n"
                "          'excessiveHoldRatio': 0.0,\n"
                "          'voicedRatio': 0.72\n"
                "        }\n"
                "      },\n"
                "      {\n"
                "        'case': 'vocadito_late_onset',\n"
                "        'provider': 'swiftf0',\n"
                "        'status': 'pass',\n"
                "        'pitchMatchScore': 0.78,\n"
                "        'musicFeel': {'score': 0.74},\n"
                "        'diagnostics': {\n"
                "          'pitchMs': 1725.0,\n"
                "          'providerPitchMs': 210.0,\n"
                "          'ensembleDecision': 'highest_score',\n"
                "          'acceptanceScore': 0.74,\n"
                "          'firstOnsetLag': 0.22,\n"
                "          'onsetFragmentation': 0.18,\n"
                "          'rushedRatio': 0.33,\n"
                "          'interiorHoldRatio': 0.01,\n"
                "          'excessiveHoldRatio': 0.0,\n"
                "          'voicedRatio': 0.7\n"
                "        }\n"
                "      },\n"
                "      {\n"
                "        'case': 'vocadito_holdy',\n"
                "        'provider': 'swiftf0',\n"
                "        'status': 'pass',\n"
                "        'pitchMatchScore': 0.82,\n"
                "        'musicFeel': {'score': 0.77},\n"
                "        'diagnostics': {\n"
                "          'pitchMs': 2140.0,\n"
                "          'providerPitchMs': 330.0,\n"
                "          'ensembleDecision': 'highest_score',\n"
                "          'acceptanceScore': 0.83,\n"
                "          'firstOnsetLag': 0.02,\n"
                "          'onsetFragmentation': 0.18,\n"
                "          'rushedRatio': 0.22,\n"
                "          'interiorHoldRatio': 0.19,\n"
                "          'excessiveHoldRatio': 0.11,\n"
                "          'voicedRatio': 0.81\n"
                "        }\n"
                "      },\n"
                "      {\n"
                "        'case': 'vocadito_fragmented',\n"
                "        'provider': 'swiftf0',\n"
                "        'status': 'pass',\n"
                "        'pitchMatchScore': 0.8,\n"
                "        'musicFeel': {'score': 0.72},\n"
                "        'diagnostics': {\n"
                "          'pitchMs': 1860.0,\n"
                "          'providerPitchMs': 240.0,\n"
                "          'ensembleDecision': 'highest_score',\n"
                "          'acceptanceScore': 0.76,\n"
                "          'firstOnsetLag': 0.03,\n"
                "          'onsetFragmentation': 0.31,\n"
                "          'rushedRatio': 0.52,\n"
                "          'interiorHoldRatio': 0.02,\n"
                "          'excessiveHoldRatio': 0.0,\n"
                "          'voicedRatio': 0.75\n"
                "        }\n"
                "      },\n"
                "      {\n"
                "        'case': 'vocadito_general',\n"
                "        'provider': 'swiftf0',\n"
                "        'status': 'pass',\n"
                "        'pitchMatchScore': 0.85,\n"
                "        'musicFeel': {'score': 0.82},\n"
                "        'diagnostics': {\n"
                "          'pitchMs': 2080.0,\n"
                "          'providerPitchMs': 250.0,\n"
                "          'ensembleDecision': 'highest_score',\n"
                "          'alternateReviewMode': 'light_no_repair_general',\n"
                "          'acceptanceScore': 0.84,\n"
                "          'firstOnsetLag': 0.06,\n"
                "          'onsetFragmentation': 0.16,\n"
                "          'rushedRatio': 0.34,\n"
                "          'interiorHoldRatio': 0.03,\n"
                "          'excessiveHoldRatio': 0.01,\n"
                "          'voicedRatio': 0.82\n"
                "        }\n"
                "      }\n"
                "    ],\n"
                "    'summary': {\n"
                "      'families': {\n"
                "        'vocadito': {\n"
                "          'cases': 5,\n"
                "          'pass': 5,\n"
                "          'warn': 0,\n"
                "          'fail': 0,\n"
                "          'error': 0,\n"
                "          'avgPitchMatchScore': 0.818,\n"
                "          'avgMusicFeelScore': 0.764\n"
                "        }\n"
                "      },\n"
                "      'tags': {},\n"
                "      'avgPitchMatchScore': 0.818,\n"
                "      'avgMusicFeelScore': 0.764,\n"
                "      'warn': 0,\n"
                "      'fail': 0,\n"
                "      'error': 0,\n"
                "      'p95PitchMs': 2400.0\n"
                "    }\n"
                "  }],\n"
                "  'gate': {'ok': True}\n"
                "}))\n"
            )
            manifest_path = tmp_path / "manifest.json"
            manifest_path.write_text('[{"name":"sample","path":"sample.wav"}]\n')
            config_path.write_text(json.dumps({
                "suites": [
                    {
                        "name": "vocadito_report",
                        "required": False,
                        "strict": False,
                        "allProviders": True,
                        "manifest": str(manifest_path),
                    }
                ]
            }))

            completed = subprocess.run(
                [
                    sys.executable,
                    str(tool),
                    "--config",
                    str(config_path),
                    "--markdown-out",
                    str(report_path),
                ],
                cwd=worker_dir,
                env={
                    **os.environ,
                    "MURMUR_AUDIO_AUDIT_PATH": str(stub_audit),
                },
                capture_output=True,
                text=True,
                check=False,
            )
            report = report_path.read_text()

        self.assertEqual(completed.returncode, 0, msg=completed.stderr or completed.stdout)
        payload = json.loads(completed.stdout)
        subfamilies = payload["summary"]["engineeringTailSubfamilies"]
        self.assertEqual(
            {item["kind"] for item in subfamilies},
            {
                "compact_review_tail",
                "late_onset_tail",
                "hold_repair_tail",
                "fragmented_urgent_tail",
                "general_review_tail",
            },
        )
        self.assertTrue(
            any(
                "hold_repair_tail example" in action
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertTrue(
            any(
                "general_review_tail example" in action
                for action in payload["summary"]["nextActions"]
            )
        )
        self.assertIn("Engineering-tail subfamilies", report)
        self.assertIn("compact_review_tail", report)
        self.assertIn("general_review_tail", report)


if __name__ == "__main__":
    unittest.main()
