from __future__ import annotations

import argparse
import json
from pathlib import Path

import soundfile as sf

from audio_audit import AuditCase, SR, build_cases
from scaffold_audio_eval_workspace import GOLDEN_BUCKETS


CASE_BUCKETS = {
    "two_tigers_phrase": "familiar",
    "brightest_star_hook": "familiar",
    "pitch_weak_stable_phrase": "pitch-weak",
    "urgent_hook_fragment": "urgent",
    "overheld_middle_phrase": "repair",
    "glide_phrase": "glide",
    "vibrato_phrase": "wobble",
    "noisy_scale": "noisy",
    "clipped_scale": "clipped",
}

BUCKET_THRESHOLDS = {
    "familiar": {"pitch_match_min": 0.7, "music_feel_min": 0.5},
    "pitch-weak": {"pitch_match_min": 0.55, "music_feel_min": 0.42},
    "urgent": {"pitch_match_min": 0.62, "music_feel_min": 0.4},
    "repair": {"pitch_match_min": 0.62, "music_feel_min": 0.45},
    "glide": {"pitch_match_min": 0.58, "music_feel_min": 0.4},
    "wobble": {"pitch_match_min": 0.58, "music_feel_min": 0.4},
    "noisy": {"pitch_match_min": 0.45, "music_feel_min": 0.35},
    "clipped": {"pitch_match_min": 0.45, "music_feel_min": 0.35},
}


def dedupe(items: list[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item in seen:
            continue
        ordered.append(item)
        seen.add(item)
    return ordered


def build_seed_cases() -> list[tuple[str, AuditCase]]:
    by_name = {case.name: case for case in build_cases()}
    seeded: list[tuple[str, AuditCase]] = []
    for case_name, bucket in CASE_BUCKETS.items():
        case = by_name.get(case_name)
        if case is None:
            raise KeyError(f"seed case not found in audio_audit build_cases(): {case_name}")
        seeded.append((bucket, case))
    return seeded


def build_manifest_item(bucket: str, case: AuditCase) -> dict[str, object]:
    relative_path = f"{bucket}/{case.name}.wav"
    thresholds = BUCKET_THRESHOLDS[bucket]
    inherited_tags = [tag for tag in (case.tags or []) if tag != "synthetic"]
    tags = dedupe(["seeded", bucket, *inherited_tags])
    item: dict[str, object] = {
        "name": case.name,
        "family": "murmur_golden_seeded",
        "source": "repo_seeded_local",
        "path": relative_path,
        "expected_min_notes": case.expected_min_notes,
        "pitch_match_min": case.pitch_match_min if case.pitch_match_min is not None else thresholds["pitch_match_min"],
        "music_feel_min": case.music_feel_min if case.music_feel_min is not None else thresholds["music_feel_min"],
        "tags": tags,
    }
    if case.expected_pitches is not None:
        item["expected_pitches"] = case.expected_pitches
    return item


def main() -> int:
    tools_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Seed Murmur's local golden-set workspace with product-shaped synthetic humming fixtures."
    )
    parser.add_argument(
        "--root",
        default=str(tools_dir / "datasets" / "murmur-golden"),
        help="Dataset root directory for the local Murmur golden set",
    )
    parser.add_argument(
        "--manifest",
        default=str(tools_dir / "manifests" / "murmur-golden.local.json"),
        help="Output manifest path",
    )
    parser.add_argument(
        "--pitch-map",
        default=str(tools_dir / "pitch-maps" / "murmur-golden.local.json"),
        help="Output pitch-map path",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the resulting JSON summary",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    manifest_path = Path(args.manifest).resolve()
    pitch_map_path = Path(args.pitch_map).resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    pitch_map_path.parent.mkdir(parents=True, exist_ok=True)

    for bucket in GOLDEN_BUCKETS:
        (root / bucket).mkdir(parents=True, exist_ok=True)

    manifest_items: list[dict[str, object]] = []
    pitch_map: dict[str, list[int]] = {}
    bucket_counts = {bucket: 0 for bucket in GOLDEN_BUCKETS}

    for bucket, case in build_seed_cases():
        relative_path = f"{bucket}/{case.name}.wav"
        output_path = root / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), case.signal, SR, subtype="PCM_16")
        manifest_items.append(build_manifest_item(bucket, case))
        if case.expected_pitches is not None:
            pitch_map[relative_path] = case.expected_pitches
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1

    manifest_path.write_text(json.dumps(manifest_items, indent=2, ensure_ascii=False) + "\n")
    pitch_map_path.write_text(json.dumps(pitch_map, indent=2, ensure_ascii=False) + "\n")

    summary = {
        "root": str(root),
        "manifest": str(manifest_path),
        "pitchMap": str(pitch_map_path),
        "count": len(manifest_items),
        "bucketCounts": bucket_counts,
        "family": "murmur_golden_seeded",
        "source": "repo_seeded_local",
    }
    print(json.dumps(summary, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
