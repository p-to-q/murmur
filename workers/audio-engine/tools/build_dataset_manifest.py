from __future__ import annotations

import argparse
import json
from pathlib import Path


SUPPORTED_AUDIO_SUFFIXES = {".wav", ".flac", ".ogg", ".aiff", ".aif"}


def is_metadata_path(path: Path) -> bool:
    return any(part == "__MACOSX" for part in path.parts) or path.name.startswith("._")


def load_expected_pitch_map(path: Path | None) -> dict[str, list[int]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("expected pitch map must be a JSON object")
    result: dict[str, list[int]] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            raise ValueError("expected pitch map keys must be strings")
        if not isinstance(value, list) or not all(isinstance(item, (int, float)) for item in value):
            raise ValueError(f"{key}: expected pitch map values must be numeric arrays")
        result[key] = [int(item) for item in value]
    return result


def collect_audio_files(root: Path, patterns: list[str]) -> list[Path]:
    matches: dict[Path, None] = {}
    for pattern in patterns:
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            if is_metadata_path(path):
                continue
            if path.suffix.lower() not in SUPPORTED_AUDIO_SUFFIXES:
                continue
            matches[path.resolve()] = None
    return sorted(matches.keys())


def build_manifest_items(
    *,
    root: Path,
    files: list[Path],
    family: str,
    source: str,
    tags: list[str],
    expected_min_notes: int,
    pitch_match_min: float | None,
    music_feel_min: float | None,
    expected_pitch_map: dict[str, list[int]],
    name_mode: str,
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for file_path in files:
        relative = file_path.relative_to(root).as_posix()
        stem = file_path.stem
        expected_pitches = (
            expected_pitch_map.get(relative)
            or expected_pitch_map.get(stem)
        )
        if name_mode == "relative":
            name = relative.rsplit(".", 1)[0]
        else:
            name = stem

        item: dict[str, object] = {
            "name": name,
            "family": family,
            "source": source,
            "path": relative,
            "expected_min_notes": expected_min_notes,
        }
        if expected_pitches is not None:
            item["expected_pitches"] = expected_pitches
        if pitch_match_min is not None:
            item["pitch_match_min"] = pitch_match_min
        if music_feel_min is not None:
            item["music_feel_min"] = music_feel_min
        if tags:
            item["tags"] = tags
        items.append(item)
    return items


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a Murmur audio-audit manifest from a local dataset directory."
    )
    parser.add_argument("--root", required=True, help="Dataset root directory")
    parser.add_argument("--out", required=True, help="Output manifest JSON path")
    parser.add_argument(
        "--glob",
        dest="globs",
        action="append",
        default=[],
        help="Glob pattern relative to --root (repeatable, defaults to **/*.wav and **/*.flac)",
    )
    parser.add_argument("--family", default="external", help="Dataset family label")
    parser.add_argument("--source", default="public_dataset", help="Dataset source label")
    parser.add_argument("--tag", dest="tags", action="append", default=[], help="Tag to attach (repeatable)")
    parser.add_argument("--expected-min-notes", type=int, default=1, help="Default expected_min_notes")
    parser.add_argument("--pitch-match-min", type=float, help="Optional default pitch_match_min")
    parser.add_argument("--music-feel-min", type=float, help="Optional default music_feel_min")
    parser.add_argument(
        "--expected-pitches-json",
        help="Optional JSON map from relative path or file stem to expected pitch arrays",
    )
    parser.add_argument(
        "--name-mode",
        choices=["stem", "relative"],
        default="stem",
        help="How to derive manifest case names",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"dataset root not found: {root}")

    patterns = args.globs or ["**/*.wav", "**/*.flac"]
    files = collect_audio_files(root, patterns)
    if not files:
        raise FileNotFoundError(f"no supported audio files found under {root} with patterns {patterns}")

    expected_pitch_map = load_expected_pitch_map(
        Path(args.expected_pitches_json).resolve() if args.expected_pitches_json else None
    )
    items = build_manifest_items(
        root=root,
        files=files,
        family=args.family,
        source=args.source,
        tags=args.tags,
        expected_min_notes=args.expected_min_notes,
        pitch_match_min=args.pitch_match_min,
        music_feel_min=args.music_feel_min,
        expected_pitch_map=expected_pitch_map,
        name_mode=args.name_mode,
    )

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "root": str(root),
                "out": str(out_path),
                "count": len(items),
                "family": args.family,
                "patterns": patterns,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
