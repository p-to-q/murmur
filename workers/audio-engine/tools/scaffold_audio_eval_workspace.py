from __future__ import annotations

import argparse
import json
from pathlib import Path


GOLDEN_BUCKETS = [
    "familiar",
    "pitch-weak",
    "urgent",
    "repair",
    "glide",
    "wobble",
    "noisy",
    "clipped",
]


def ensure_text(path: Path, contents: str) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents)


def scaffold_dataset_dir(root: Path, name: str) -> dict[str, str]:
    dataset_dir = root / name
    dataset_dir.mkdir(parents=True, exist_ok=True)

    if name == "murmur-golden":
        for bucket in GOLDEN_BUCKETS:
            (dataset_dir / bucket).mkdir(parents=True, exist_ok=True)

    readme = (
        f"# {name}\n\n"
        "Local-only audio evaluation workspace.\n\n"
        "Put raw audio files here and keep them out of Git.\n"
    )
    ensure_text(dataset_dir / "README.md", readme)
    return {
        "datasetDir": str(dataset_dir),
        "readme": str(dataset_dir / "README.md"),
    }


def scaffold_manifest_and_pitch_map(tools_dir: Path, name: str) -> dict[str, str]:
    manifests_dir = tools_dir / "manifests"
    pitch_maps_dir = tools_dir / "pitch-maps"
    manifest_path = manifests_dir / f"{name}.local.json"
    pitch_map_path = pitch_maps_dir / f"{name}.local.json"

    ensure_text(manifest_path, "[]\n")
    ensure_text(pitch_map_path, "{}\n")
    return {
        "manifest": str(manifest_path),
        "pitchMap": str(pitch_map_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scaffold Murmur's local audio-eval workspace for public datasets and the internal golden set."
    )
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent / "datasets"),
        help="Root directory for local-only audio datasets",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the resulting JSON summary",
    )
    args = parser.parse_args()

    tools_dir = Path(__file__).resolve().parent
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    summary = {
        "root": str(root),
        "datasets": {
            "humtrans": {
                **scaffold_dataset_dir(root, "humtrans"),
                **scaffold_manifest_and_pitch_map(tools_dir, "humtrans"),
            },
            "vocadito": {
                **scaffold_dataset_dir(root, "vocadito"),
                **scaffold_manifest_and_pitch_map(tools_dir, "vocadito"),
            },
            "murmur-golden": {
                **scaffold_dataset_dir(root, "murmur-golden"),
                **scaffold_manifest_and_pitch_map(tools_dir, "murmur-golden"),
                "buckets": GOLDEN_BUCKETS,
            },
        },
    }
    print(json.dumps(summary, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
