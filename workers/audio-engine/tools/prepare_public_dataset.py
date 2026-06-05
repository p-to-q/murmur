from __future__ import annotations

import argparse
import csv
import json
import math
import ssl
import shutil
import struct
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path

from build_dataset_manifest import build_manifest_items, collect_audio_files, is_metadata_path


TOOLS_DIR = Path(__file__).resolve().parent

DATASET_PRESETS: dict[str, dict[str, object]] = {
    "humtrans": {
        "family": "humtrans",
        "source": "public_dataset",
        "tags": ["real", "humming"],
        "expected_min_notes": 3,
        "pitch_match_min": 0.65,
        "music_feel_min": 0.48,
        "download_url": "https://huggingface.co/datasets/dadinghh2/HumTrans/resolve/main/all_wav.zip",
        "archive_name": "humtrans-all_wav.zip",
        "midi_download_url": "https://huggingface.co/datasets/dadinghh2/HumTrans/resolve/main/all_midi.zip",
        "midi_archive_name": "humtrans-all_midi.zip",
        "split_keys_url": "https://huggingface.co/datasets/dadinghh2/HumTrans/resolve/main/train_valid_test_keys.json",
        "split_keys_name": "humtrans-train_valid_test_keys.json",
        "size_bytes": 14_685_583_595,
        "large_download": True,
        "notes": [
            "HumTrans audio is a large archive. Prefer reusing a local subset if one already exists.",
            "Download only when you explicitly want the full archive on disk.",
        ],
    },
    "vocadito": {
        "family": "vocadito",
        "source": "public_dataset",
        "tags": ["real", "singing"],
        "expected_min_notes": 3,
        "pitch_match_min": 0.72,
        "music_feel_min": 0.52,
        "download_url": "https://zenodo.org/api/records/5578807/files/vocadito.zip/content",
        "archive_name": "vocadito.zip",
        "size_bytes": 58_492_257,
        "large_download": False,
        "notes": [
            "vocadito is small enough to fetch directly for a local smoke evaluation.",
        ],
    },
}


def dataset_root_path(name: str) -> Path:
    return TOOLS_DIR / "datasets" / name


def manifest_path(name: str) -> Path:
    return TOOLS_DIR / "manifests" / f"{name}.local.json"


def pitch_map_path(name: str) -> Path:
    return TOOLS_DIR / "pitch-maps" / f"{name}.local.json"


def format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    unit_index = 0
    while value >= 1024.0 and unit_index < len(units) - 1:
        value /= 1024.0
        unit_index += 1
    if unit_index == 0:
        return f"{int(value)} {units[unit_index]}"
    return f"{value:.1f} {units[unit_index]}"


def is_retryable_network_error(exc: Exception) -> bool:
    if isinstance(exc, ssl.SSLEOFError):
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        return isinstance(reason, ssl.SSLEOFError)
    return False


def urlopen_with_retries(request_or_url, *, attempts: int = 3, backoff_seconds: float = 0.35):
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return urllib.request.urlopen(request_or_url)
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts or not is_retryable_network_error(exc):
                raise
            time.sleep(backoff_seconds * attempt)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("urlopen_with_retries exhausted without exception")


def download_file(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen_with_retries(url) as response, out_path.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def remote_content_length(url: str) -> int:
    request = urllib.request.Request(url, method="HEAD")
    with urlopen_with_retries(request) as response:
        length = response.headers.get("Content-Length")
    if length is None:
        raise ValueError(f"remote archive did not provide Content-Length for {url}")
    return int(length)


def fetch_remote_range(url: str, start: int, end: int) -> bytes:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urlopen_with_retries(request) as response:
        return response.read()


def extract_archive(archive_path: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            destination = (out_dir / member.filename).resolve()
            if out_dir.resolve() not in destination.parents and destination != out_dir.resolve():
                raise ValueError(f"archive entry escapes destination: {member.filename}")
        archive.extractall(out_dir)


def stage_zip_subset(
    *,
    archive_path: Path,
    allowed_stems: set[str] | None,
    limit: int | None,
    stage_root: Path,
    clean: bool,
) -> tuple[Path, list[Path], int, int]:
    if clean and stage_root.exists():
        shutil.rmtree(stage_root)
    stage_root.mkdir(parents=True, exist_ok=True)

    staged_files: list[Path] = []
    source_audio_count = 0
    selected_before_limit = 0

    with zipfile.ZipFile(archive_path) as archive:
        audio_members = [
            member for member in archive.infolist()
            if not member.is_dir()
            and not is_metadata_path(Path(member.filename))
            and Path(member.filename).suffix.lower() in {".wav", ".flac", ".ogg", ".aiff", ".aif"}
        ]
        source_audio_count = len(audio_members)
        if allowed_stems is not None:
            audio_members = [
                member for member in audio_members
                if Path(member.filename).stem in allowed_stems
            ]
        selected_before_limit = len(audio_members)
        if limit is not None:
            audio_members = audio_members[:limit]

        for member in audio_members:
            destination = stage_root / member.filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            staged_files.append(destination)

    return stage_root.resolve(), staged_files, source_audio_count, selected_before_limit


@dataclass
class ZipEntryRecord:
    filename: str
    compress_type: int
    compressed_size: int
    uncompressed_size: int
    local_header_offset: int


class RemoteZipReader:
    def __init__(self, size: int, fetch_range: callable):
        self.size = size
        self.fetch_range = fetch_range

    def read_range(self, start: int, end: int) -> bytes:
        if start < 0 or end < start:
            raise ValueError("invalid range")
        if end >= self.size:
            end = self.size - 1
        return self.fetch_range(start, end)

    def _read_zip64_end_of_central_directory(self, offset: int) -> tuple[int, int]:
        record = self.read_range(offset, offset + 55)
        if len(record) < 56 or record[:4] != b"PK\x06\x06":
            raise ValueError("invalid ZIP64 EOCD record")
        central_directory_size = struct.unpack_from("<Q", record, 40)[0]
        central_directory_offset = struct.unpack_from("<Q", record, 48)[0]
        return central_directory_size, central_directory_offset

    def central_directory_bounds(self) -> tuple[int, int]:
        tail_window = min(self.size, 131_072)
        tail_start = self.size - tail_window
        tail = self.read_range(tail_start, self.size - 1)
        eocd_index = tail.rfind(b"PK\x05\x06")
        if eocd_index < 0:
            raise ValueError("EOCD not found in remote zip")

        central_directory_size = struct.unpack_from("<I", tail, eocd_index + 12)[0]
        central_directory_offset = struct.unpack_from("<I", tail, eocd_index + 16)[0]
        needs_zip64 = (
            central_directory_size == 0xFFFFFFFF
            or central_directory_offset == 0xFFFFFFFF
        )
        if needs_zip64:
            locator_index = tail.rfind(b"PK\x06\x07", 0, eocd_index)
            if locator_index < 0:
                raise ValueError("ZIP64 locator not found")
            zip64_eocd_offset = struct.unpack_from("<Q", tail, locator_index + 8)[0]
            central_directory_size, central_directory_offset = self._read_zip64_end_of_central_directory(zip64_eocd_offset)

        return central_directory_offset, central_directory_size

    def list_entries(self) -> list[ZipEntryRecord]:
        central_directory_offset, central_directory_size = self.central_directory_bounds()
        directory = self.read_range(
            central_directory_offset,
            central_directory_offset + central_directory_size - 1,
        )
        entries: list[ZipEntryRecord] = []
        index = 0
        while index + 46 <= len(directory):
            if directory[index:index + 4] != b"PK\x01\x02":
                break
            compress_type = struct.unpack_from("<H", directory, index + 10)[0]
            compressed_size = struct.unpack_from("<I", directory, index + 20)[0]
            uncompressed_size = struct.unpack_from("<I", directory, index + 24)[0]
            filename_length = struct.unpack_from("<H", directory, index + 28)[0]
            extra_length = struct.unpack_from("<H", directory, index + 30)[0]
            comment_length = struct.unpack_from("<H", directory, index + 32)[0]
            local_header_offset = struct.unpack_from("<I", directory, index + 42)[0]
            filename_start = index + 46
            filename_end = filename_start + filename_length
            extra_start = filename_end
            extra_end = extra_start + extra_length
            filename = directory[filename_start:filename_end].decode("utf-8", errors="replace")
            extra = directory[extra_start:extra_end]

            if (
                compressed_size == 0xFFFFFFFF
                or uncompressed_size == 0xFFFFFFFF
                or local_header_offset == 0xFFFFFFFF
            ):
                compressed_size, uncompressed_size, local_header_offset = read_zip64_extra(
                    extra,
                    compressed_size=compressed_size,
                    uncompressed_size=uncompressed_size,
                    local_header_offset=local_header_offset,
                )

            entries.append(
                ZipEntryRecord(
                    filename=filename,
                    compress_type=compress_type,
                    compressed_size=compressed_size,
                    uncompressed_size=uncompressed_size,
                    local_header_offset=local_header_offset,
                )
            )
            index = extra_end + comment_length

        return entries

    def extract_entry(self, entry: ZipEntryRecord) -> bytes:
        header = self.read_range(entry.local_header_offset, entry.local_header_offset + 255)
        if len(header) < 30 or header[:4] != b"PK\x03\x04":
            raise ValueError(f"invalid local file header for {entry.filename}")
        filename_length = struct.unpack_from("<H", header, 26)[0]
        extra_length = struct.unpack_from("<H", header, 28)[0]
        data_offset = entry.local_header_offset + 30 + filename_length + extra_length
        compressed = self.read_range(data_offset, data_offset + entry.compressed_size - 1)
        if entry.compress_type == 0:
            return compressed
        if entry.compress_type == 8:
            return zlib.decompress(compressed, -15)
        raise ValueError(f"unsupported ZIP compression method {entry.compress_type} for {entry.filename}")


def read_zip64_extra(
    extra: bytes,
    *,
    compressed_size: int,
    uncompressed_size: int,
    local_header_offset: int,
) -> tuple[int, int, int]:
    index = 0
    while index + 4 <= len(extra):
        header_id, data_size = struct.unpack_from("<HH", extra, index)
        data_start = index + 4
        data_end = data_start + data_size
        if data_end > len(extra):
            break
        if header_id == 0x0001:
            cursor = data_start
            if uncompressed_size == 0xFFFFFFFF and cursor + 8 <= data_end:
                uncompressed_size = struct.unpack_from("<Q", extra, cursor)[0]
                cursor += 8
            if compressed_size == 0xFFFFFFFF and cursor + 8 <= data_end:
                compressed_size = struct.unpack_from("<Q", extra, cursor)[0]
                cursor += 8
            if local_header_offset == 0xFFFFFFFF and cursor + 8 <= data_end:
                local_header_offset = struct.unpack_from("<Q", extra, cursor)[0]
            return compressed_size, uncompressed_size, local_header_offset
        index = data_end
    raise ValueError("ZIP64 extra field missing required values")


def hz_to_midi(hz: float) -> int | None:
    if hz <= 0:
        return None
    midi = int(round(69 + 12 * math.log2(hz / 440.0)))
    if midi < 0 or midi > 127:
        return None
    return midi


def read_midi_vlq(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    while True:
        if offset >= len(data):
            raise ValueError("unexpected end of MIDI data while reading VLQ")
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if byte < 0x80:
            return value, offset


def extract_midi_note_sequence(data: bytes) -> list[int]:
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError("invalid MIDI header")
    header_length = int.from_bytes(data[4:8], "big")
    if header_length < 6:
        raise ValueError("invalid MIDI header length")
    track_count = int.from_bytes(data[10:12], "big")
    offset = 8 + header_length
    sequence: list[int] = []

    for _ in range(track_count):
        if offset + 8 > len(data) or data[offset:offset + 4] != b"MTrk":
            raise ValueError("missing MIDI track chunk")
        track_length = int.from_bytes(data[offset + 4:offset + 8], "big")
        track = data[offset + 8:offset + 8 + track_length]
        offset += 8 + track_length
        index = 0
        running_status: int | None = None

        while index < len(track):
            _, index = read_midi_vlq(track, index)
            if index >= len(track):
                break
            status = track[index]
            if status < 0x80:
                if running_status is None:
                    raise ValueError("running status used before any status byte")
                status = running_status
            else:
                index += 1
                if status < 0xF0:
                    running_status = status

            if status == 0xFF:
                if index >= len(track):
                    break
                index += 1  # meta type
                meta_length, index = read_midi_vlq(track, index)
                index += meta_length
                continue

            if status in (0xF0, 0xF7):
                sysex_length, index = read_midi_vlq(track, index)
                index += sysex_length
                continue

            event_type = status & 0xF0
            if event_type in (0xC0, 0xD0):
                index += 1
                continue

            if index + 2 > len(track):
                break
            note = track[index]
            velocity = track[index + 1]
            index += 2

            if event_type == 0x90 and velocity > 0:
                sequence.append(note)

    return sequence


def expected_min_notes_from_reference(note_count: int) -> int:
    if note_count <= 0:
        return 1
    return max(3, int(math.floor(note_count * 0.4)))


def build_humtrans_pitch_map_from_midi_root(root: Path) -> dict[str, list[int]]:
    midi_root = choose_root_for_patterns(root, ["*.mid", "*.midi"])
    midi_files = collect_audio_files(midi_root, ["**/*.mid", "**/*.midi"])
    pitch_map: dict[str, list[int]] = {}
    for midi_path in midi_files:
        try:
            sequence = extract_midi_note_sequence(midi_path.read_bytes())
        except ValueError:
            continue
        if sequence:
            pitch_map[midi_path.stem] = sequence
    return pitch_map


def build_humtrans_pitch_map_from_midi_archive(
    archive_path: Path,
    *,
    allowed_stems: set[str] | None,
    limit: int | None,
) -> tuple[dict[str, list[int]], int, int]:
    pitch_map: dict[str, list[int]] = {}
    with zipfile.ZipFile(archive_path) as archive:
        midi_members = [
            member for member in archive.infolist()
            if not member.is_dir()
            and not is_metadata_path(Path(member.filename))
            and Path(member.filename).suffix.lower() in {".mid", ".midi"}
        ]
        source_count = len(midi_members)
        if allowed_stems is not None:
            midi_members = [
                member for member in midi_members
                if Path(member.filename).stem in allowed_stems
            ]
        selected_before_limit = len(midi_members)
        if limit is not None:
            midi_members = midi_members[:limit]

        for member in midi_members:
            try:
                with archive.open(member) as handle:
                    sequence = extract_midi_note_sequence(handle.read())
            except ValueError:
                continue
            if sequence:
                pitch_map[Path(member.filename).stem] = sequence
    return pitch_map, source_count, selected_before_limit


def build_humtrans_pitch_map_from_remote_midi_archive(
    url: str,
    *,
    allowed_stems: set[str] | None,
    limit: int | None,
) -> tuple[dict[str, list[int]], int, int]:
    reader = RemoteZipReader(
        remote_content_length(url),
        lambda start, end: fetch_remote_range(url, start, end),
    )
    entries = [
        entry for entry in reader.list_entries()
        if not is_metadata_path(Path(entry.filename))
        and Path(entry.filename).suffix.lower() in {".mid", ".midi"}
    ]
    source_count = len(entries)
    if allowed_stems is not None:
        entries = [entry for entry in entries if Path(entry.filename).stem in allowed_stems]
    selected_before_limit = len(entries)
    if limit is not None:
        entries = entries[:limit]

    pitch_map: dict[str, list[int]] = {}
    for entry in entries:
        try:
            sequence = extract_midi_note_sequence(reader.extract_entry(entry))
        except ValueError:
            continue
        if sequence:
            pitch_map[Path(entry.filename).stem] = sequence
    return pitch_map, source_count, selected_before_limit


def locate_unique_subdir(root: Path, suffix_parts: tuple[str, ...]) -> Path | None:
    suffix = Path(*suffix_parts)
    matches = [
        candidate for candidate in root.rglob(suffix.name)
        if candidate.is_dir()
        and not is_metadata_path(candidate)
        and candidate.parts[-len(suffix.parts):] == suffix.parts
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def parse_vocadito_annotations(root: Path, annotator: str) -> dict[str, list[int]]:
    notes_dir = locate_unique_subdir(root, ("Annotations", "Notes"))
    if notes_dir is None:
        return {}

    pitch_map: dict[str, list[int]] = {}
    for csv_path in sorted(notes_dir.glob(f"vocadito_*_notes{annotator}.csv")):
        stem = csv_path.name.removesuffix(f"_notes{annotator}.csv")
        pitches: list[int] = []
        with csv_path.open(newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if len(row) < 3:
                    continue
                try:
                    hz = float(row[1])
                    duration = float(row[2])
                except ValueError:
                    continue
                if duration <= 0:
                    continue
                midi = hz_to_midi(hz)
                if midi is None:
                    continue
                pitches.append(midi)
        if pitches:
            pitch_map[stem] = pitches
    return pitch_map


def build_vocadito_reference_sets(root: Path) -> dict[str, list[dict[str, object]]]:
    def add_reference_with_octave_variants(
        target: list[dict[str, object]],
        *,
        label: str,
        pitches: list[int],
    ) -> None:
        seen_signatures = {
            tuple(int(value) for value in item.get("pitches", []))
            for item in target
            if isinstance(item, dict)
        }

        for variant_label, semitones in (
            (label, 0),
            (f"{label}+12", 12),
            (f"{label}-12", -12),
        ):
            shifted = [int(value) + semitones for value in pitches]
            if not shifted or any(value < 0 or value > 127 for value in shifted):
                continue
            signature = tuple(shifted)
            if signature in seen_signatures:
                continue
            target.append({"label": variant_label, "pitches": shifted})
            seen_signatures.add(signature)

    a1_map = parse_vocadito_annotations(root, "A1")
    a2_map = parse_vocadito_annotations(root, "A2")
    stems = sorted(set(a1_map) | set(a2_map))
    reference_sets: dict[str, list[dict[str, object]]] = {}
    for stem in stems:
        sets: list[dict[str, object]] = []
        if stem in a1_map:
            add_reference_with_octave_variants(target=sets, label="A1", pitches=a1_map[stem])
        if stem in a2_map:
            add_reference_with_octave_variants(target=sets, label="A2", pitches=a2_map[stem])
        if sets:
            reference_sets[stem] = sets
    return reference_sets


def build_reference_metadata(dataset: str, root: Path, *, vocadito_annotator: str) -> dict[str, dict[str, object]]:
    if dataset != "vocadito":
        return {}

    expected_pitch_map = parse_vocadito_annotations(root, vocadito_annotator)
    reference_sets = build_vocadito_reference_sets(root)
    return {
        stem: {
            "expected_pitches": pitches,
            "expected_min_notes": expected_min_notes_from_reference(len(pitches)),
            "expected_pitch_sets": reference_sets.get(stem, [{"label": vocadito_annotator, "pitches": pitches}]),
        }
        for stem, pitches in expected_pitch_map.items()
    }


def choose_root_for_patterns(root: Path, patterns: list[str]) -> Path:
    direct_audio_files = collect_audio_files(root, patterns)
    if direct_audio_files:
        return root
    subdirs = sorted(
        path for path in root.iterdir()
        if path.is_dir() and not is_metadata_path(path)
    )
    viable_roots: list[Path] = []
    for subdir in subdirs:
        try:
            viable_roots.append(choose_root_for_patterns(subdir, patterns))
        except FileNotFoundError:
            continue
    if len(viable_roots) == 1:
        return viable_roots[0]
    recursive_patterns = [
        pattern if pattern.startswith("**/") else f"**/{pattern.removeprefix('*')}"
        for pattern in patterns
    ]
    audio_files = collect_audio_files(root, recursive_patterns)
    if audio_files:
        return root
    raise FileNotFoundError(f"no supported audio files found under {root}")


def choose_audio_root(root: Path) -> Path:
    return choose_root_for_patterns(root, ["*.wav", "*.flac", "*.ogg", "*.aiff", "*.aif"])


def load_split_keys(
    *,
    dataset: str,
    split: str,
    split_keys_path: Path | None,
    download_dir: Path | None,
) -> tuple[set[str], Path]:
    preset = DATASET_PRESETS[dataset]
    resolved_path = split_keys_path
    if resolved_path is None:
        split_keys_name = str(preset.get("split_keys_name") or f"{dataset}-split-keys.json")
        base_dir = download_dir if download_dir is not None else dataset_root_path(dataset)
        resolved_path = (base_dir / split_keys_name).resolve()
        if not resolved_path.exists():
            split_keys_url = preset.get("split_keys_url")
            if not isinstance(split_keys_url, str) or not split_keys_url:
                raise FileNotFoundError(f"no split-keys source configured for {dataset}")
            download_file(split_keys_url, resolved_path)

    payload = json.loads(resolved_path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("split keys file must be a JSON object")
    raw_values = payload.get(split)
    if not isinstance(raw_values, list):
        raw_values = payload.get(split.upper())
    if not isinstance(raw_values, list):
        raw_values = payload.get(split.capitalize())
    if not isinstance(raw_values, list) or not raw_values:
        raise ValueError(f"split '{split}' is missing or empty in {resolved_path}")

    keys: set[str] = set()
    for value in raw_values:
        if not isinstance(value, str):
            continue
        stem = Path(value).stem if Path(value).suffix else value
        stem = stem.strip()
        if stem:
            keys.add(stem)
    if not keys:
        raise ValueError(f"split '{split}' did not yield any usable keys in {resolved_path}")
    return keys, resolved_path


def stage_remote_zip_subset(
    *,
    url: str,
    allowed_stems: set[str] | None,
    limit: int | None,
    stage_root: Path,
    clean: bool,
) -> tuple[Path, list[Path], int, int]:
    if clean and stage_root.exists():
        shutil.rmtree(stage_root)
    stage_root.mkdir(parents=True, exist_ok=True)

    reader = RemoteZipReader(
        remote_content_length(url),
        lambda start, end: fetch_remote_range(url, start, end),
    )
    entries = [
        entry for entry in reader.list_entries()
        if not is_metadata_path(Path(entry.filename))
        and Path(entry.filename).suffix.lower() in {".wav", ".flac", ".ogg", ".aiff", ".aif"}
    ]
    source_audio_count = len(entries)
    if allowed_stems is not None:
        entries = [entry for entry in entries if Path(entry.filename).stem in allowed_stems]
    selected_before_limit = len(entries)
    if limit is not None:
        entries = entries[:limit]

    staged_files: list[Path] = []
    for entry in entries:
        destination = stage_root / entry.filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(reader.extract_entry(entry))
        staged_files.append(destination)

    return stage_root.resolve(), staged_files, source_audio_count, selected_before_limit


def stage_audio_subset(
    *,
    dataset_root: Path,
    files: list[Path],
    stage_root: Path,
    clean: bool,
) -> tuple[Path, list[Path]]:
    if clean and stage_root.exists():
        shutil.rmtree(stage_root)
    stage_root.mkdir(parents=True, exist_ok=True)

    staged_files: list[Path] = []
    for file_path in files:
        relative = file_path.relative_to(dataset_root)
        destination = stage_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file_path, destination)
        staged_files.append(destination)
    return stage_root.resolve(), staged_files


def build_manifest_from_root(
    *,
    dataset: str,
    root: Path,
    out_path: Path,
    pitch_map_out: Path | None,
    limit: int | None,
    name_mode: str,
    vocadito_annotator: str,
    allowed_stems: set[str] | None,
    split_name: str | None,
    split_keys_source: Path | None,
    stage_root: Path | None,
    stage_clean: bool,
    humtrans_pitch_map: dict[str, list[int]] | None,
) -> dict[str, object]:
    preset = DATASET_PRESETS[dataset]
    dataset_root = root.resolve()
    source_dataset_root = dataset_root
    audio_root = choose_audio_root(dataset_root)
    files = collect_audio_files(audio_root, ["**/*.wav", "**/*.flac", "**/*.ogg", "**/*.aiff", "**/*.aif"])
    source_count = len(files)
    if allowed_stems is not None:
        files = [file_path for file_path in files if file_path.stem in allowed_stems]
    selected_before_limit = len(files)
    if limit is not None:
        files = files[:limit]
    final_stems = {file_path.stem for file_path in files}
    staged_root: Path | None = None
    if stage_root is not None:
        staged_root, files = stage_audio_subset(
            dataset_root=source_dataset_root,
            files=files,
            stage_root=stage_root.resolve(),
            clean=stage_clean,
        )
        dataset_root = staged_root
        audio_root = choose_audio_root(dataset_root)
    reference_metadata = build_reference_metadata(
        dataset,
        source_dataset_root,
        vocadito_annotator=vocadito_annotator,
    )
    expected_pitch_map = {
        stem: metadata["expected_pitches"]
        for stem, metadata in reference_metadata.items()
        if isinstance(metadata.get("expected_pitches"), list)
    }
    if dataset == "humtrans" and humtrans_pitch_map:
        expected_pitch_map = {
            stem: pitches
            for stem, pitches in humtrans_pitch_map.items()
            if stem in final_stems
        }
    items: list[dict[str, object]] = []
    for file_path in files:
        stem = file_path.stem
        item = build_manifest_items(
            root=dataset_root,
            files=[file_path],
            family=str(preset["family"]),
            source=str(preset["source"]),
            tags=[str(tag) for tag in preset["tags"]],
            expected_min_notes=int(preset["expected_min_notes"]),
            pitch_match_min=float(preset["pitch_match_min"]),
            music_feel_min=float(preset["music_feel_min"]),
            expected_pitch_map=expected_pitch_map,
            name_mode=name_mode,
        )[0]
        metadata = reference_metadata.get(stem)
        if metadata is not None:
            item["expected_min_notes"] = int(metadata["expected_min_notes"])
            item["expected_pitch_sets"] = metadata["expected_pitch_sets"]
            item.setdefault("tags", [])
            if isinstance(item["tags"], list):
                item["tags"] = [*item["tags"], "annotated", vocadito_annotator.lower()]
        elif dataset == "humtrans" and stem in expected_pitch_map:
            pitches = expected_pitch_map[stem]
            item["expected_pitches"] = pitches
            item["expected_min_notes"] = expected_min_notes_from_reference(len(pitches))
            item.setdefault("tags", [])
            if isinstance(item["tags"], list):
                item["tags"] = [*item["tags"], "annotated", "midi_ref"]
        items.append(item)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    if pitch_map_out is not None:
        pitch_map_out.parent.mkdir(parents=True, exist_ok=True)
        pitch_map_out.write_text(json.dumps(expected_pitch_map, indent=2, ensure_ascii=False) + "\n")
    summary: dict[str, object] = {
        "dataset": dataset,
        "datasetRoot": str(dataset_root),
        "sourceDatasetRoot": str(source_dataset_root),
        "audioRoot": str(audio_root),
        "manifest": str(out_path.resolve()),
        "pitchMap": str(pitch_map_out.resolve()) if pitch_map_out is not None else None,
        "count": len(items),
        "limit": limit,
        "annotatedCases": len(expected_pitch_map),
        "sourceAudioCount": source_count,
        "selectedBeforeLimit": selected_before_limit,
    }
    if split_name is not None:
        summary["split"] = split_name
    if split_keys_source is not None:
        summary["splitKeys"] = str(split_keys_source.resolve())
    if staged_root is not None:
        summary["stagedRoot"] = str(staged_root)
        summary["stagedCount"] = len(files)
    return summary


def build_manifest_from_stage(
    *,
    dataset: str,
    stage_root: Path,
    out_path: Path,
    pitch_map_out: Path | None,
    limit: int | None,
    name_mode: str,
    split_name: str | None,
    split_keys_source: Path | None,
    source_audio_count: int,
    selected_before_limit: int,
    humtrans_pitch_map: dict[str, list[int]] | None,
) -> dict[str, object]:
    preset = DATASET_PRESETS[dataset]
    dataset_root = stage_root.resolve()
    audio_root = choose_audio_root(dataset_root)
    files = collect_audio_files(audio_root, ["**/*.wav", "**/*.flac", "**/*.ogg", "**/*.aiff", "**/*.aif"])
    final_stems = {file_path.stem for file_path in files}
    filtered_pitch_map = {
        stem: pitches
        for stem, pitches in (humtrans_pitch_map or {}).items()
        if stem in final_stems
    }
    items = build_manifest_items(
        root=dataset_root,
        files=files,
        family=str(preset["family"]),
        source=str(preset["source"]),
        tags=[str(tag) for tag in preset["tags"]],
        expected_min_notes=int(preset["expected_min_notes"]),
        pitch_match_min=float(preset["pitch_match_min"]),
        music_feel_min=float(preset["music_feel_min"]),
        expected_pitch_map=filtered_pitch_map,
        name_mode=name_mode,
    )
    if filtered_pitch_map:
        for item in items:
            pitches = filtered_pitch_map.get(Path(str(item["path"])).stem)
            if pitches:
                item["expected_min_notes"] = expected_min_notes_from_reference(len(pitches))
                item.setdefault("tags", [])
                if isinstance(item["tags"], list):
                    item["tags"] = [*item["tags"], "annotated", "midi_ref"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    if pitch_map_out is not None:
        pitch_map_out.parent.mkdir(parents=True, exist_ok=True)
        pitch_map_out.write_text(json.dumps(filtered_pitch_map, indent=2, ensure_ascii=False) + "\n")

    summary: dict[str, object] = {
        "dataset": dataset,
        "datasetRoot": str(dataset_root),
        "sourceDatasetRoot": None,
        "audioRoot": str(audio_root),
        "manifest": str(out_path.resolve()),
        "pitchMap": str(pitch_map_out.resolve()) if pitch_map_out is not None else None,
        "count": len(items),
        "limit": limit,
        "annotatedCases": len(filtered_pitch_map),
        "sourceAudioCount": source_audio_count,
        "selectedBeforeLimit": selected_before_limit,
        "stagedRoot": str(dataset_root),
        "stagedCount": len(items),
        "sourceArchiveMode": True,
    }
    if split_name is not None:
        summary["split"] = split_name
    if split_keys_source is not None:
        summary["splitKeys"] = str(split_keys_source.resolve())
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare a public audio-eval dataset preset for Murmur's local closure."
    )
    parser.add_argument("dataset", choices=sorted(DATASET_PRESETS.keys()))
    parser.add_argument("--describe", action="store_true", help="Print preset metadata and exit")
    parser.add_argument("--download", action="store_true", help="Download the preset archive if supported")
    parser.add_argument("--extract", action="store_true", help="Extract the preset archive into the local dataset workspace")
    parser.add_argument("--allow-large-download", action="store_true", help="Required for very large preset downloads")
    parser.add_argument("--archive", help="Use an existing archive path instead of downloading")
    parser.add_argument("--root", help="Use an existing extracted dataset directory")
    parser.add_argument("--download-dir", help="Directory where downloaded archives should be stored")
    parser.add_argument("--manifest-out", help="Override the manifest output path")
    parser.add_argument("--pitch-map-out", help="Override the pitch-map output path")
    parser.add_argument("--limit", type=int, help="Limit the number of audio files added to the manifest")
    parser.add_argument("--remote-subset", action="store_true", help="Stage a bounded subset directly from the preset remote archive instead of downloading or extracting the full zip")
    parser.add_argument("--split", choices=["train", "valid", "test"], help="Filter to an official dataset split when supported")
    parser.add_argument("--split-keys", help="Path to a local JSON file containing official split keys")
    parser.add_argument("--stage-root", help="Copy the selected audio files into a smaller local workspace before building the manifest")
    parser.add_argument("--stage-clean", action="store_true", help="Delete the stage root before copying the selected subset")
    parser.add_argument("--midi-root", help="Path to extracted MIDI references for datasets that ship note files separately")
    parser.add_argument("--midi-archive", help="Path to a MIDI archive that matches the audio dataset")
    parser.add_argument("--include-midi-ref", action="store_true", help="When using --remote-subset, also fetch matching MIDI references from the preset remote MIDI archive when available")
    parser.add_argument("--name-mode", choices=["stem", "relative"], default="stem")
    parser.add_argument("--vocadito-annotator", choices=["A1", "A2"], default="A1")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print the JSON summary")
    args = parser.parse_args()

    preset = DATASET_PRESETS[args.dataset]
    summary: dict[str, object] = {
        "dataset": args.dataset,
        "preset": {
            "family": preset["family"],
            "source": preset["source"],
            "tags": preset["tags"],
            "expectedMinNotes": preset["expected_min_notes"],
            "pitchMatchMin": preset["pitch_match_min"],
            "musicFeelMin": preset["music_feel_min"],
            "downloadUrl": preset["download_url"],
            "archiveName": preset["archive_name"],
            "sizeBytes": preset["size_bytes"],
            "sizeHuman": format_bytes(int(preset["size_bytes"])),
            "largeDownload": preset["large_download"],
            "notes": preset["notes"],
        },
    }
    if args.describe:
        print(json.dumps(summary, indent=2 if args.pretty else None, ensure_ascii=False))
        return 0

    dataset_root = Path(args.root).resolve() if args.root else dataset_root_path(args.dataset).resolve()
    archive_path: Path | None = Path(args.archive).resolve() if args.archive else None
    split_keys_source: Path | None = None
    allowed_stems: set[str] | None = None
    download_dir = Path(args.download_dir).resolve() if args.download_dir else None
    humtrans_pitch_map: dict[str, list[int]] | None = None

    if args.download:
        if bool(preset["large_download"]) and not args.allow_large_download:
            raise SystemExit(
                "refusing large dataset download without --allow-large-download"
            )
        resolved_download_dir = download_dir if download_dir is not None else dataset_root.parent
        archive_path = resolved_download_dir / str(preset["archive_name"])
        if not archive_path.exists():
            download_file(str(preset["download_url"]), archive_path)
        summary["downloadedArchive"] = str(archive_path)

    if args.split:
        allowed_stems, split_keys_source = load_split_keys(
            dataset=args.dataset,
            split=args.split,
            split_keys_path=Path(args.split_keys).resolve() if args.split_keys else None,
            download_dir=download_dir,
        )
        summary["splitSelection"] = {
            "split": args.split,
            "splitKeys": str(split_keys_source),
            "selectedKeys": len(allowed_stems),
        }

    if args.midi_root:
        humtrans_pitch_map = build_humtrans_pitch_map_from_midi_root(Path(args.midi_root).resolve())
        summary["midiReference"] = {
            "mode": "root",
            "path": str(Path(args.midi_root).resolve()),
            "annotatedCases": len(humtrans_pitch_map),
        }
    elif args.midi_archive and not args.remote_subset and not (args.archive and args.stage_root):
        humtrans_pitch_map, midi_source_count, midi_selected_before_limit = build_humtrans_pitch_map_from_midi_archive(
            Path(args.midi_archive).resolve(),
            allowed_stems=allowed_stems,
            limit=None,
        )
        summary["midiReference"] = {
            "mode": "archive",
            "path": str(Path(args.midi_archive).resolve()),
            "annotatedCases": len(humtrans_pitch_map),
            "sourceMidiCount": midi_source_count,
            "selectedBeforeLimit": midi_selected_before_limit,
        }

    if args.extract:
        if archive_path is None:
            raise SystemExit("--extract requires --archive or --download")
        extract_archive(archive_path, dataset_root)
        summary["extractedTo"] = str(dataset_root)

    if args.root or args.extract:
        if args.stage_root and args.dataset != "humtrans":
            raise SystemExit("--stage-root is currently supported only for the humtrans preset")
        manifest_out = Path(args.manifest_out).resolve() if args.manifest_out else manifest_path(args.dataset).resolve()
        resolved_pitch_map_out = (
            Path(args.pitch_map_out).resolve()
            if args.pitch_map_out
            else pitch_map_path(args.dataset).resolve()
        )
        summary["manifestBuild"] = build_manifest_from_root(
            dataset=args.dataset,
            root=dataset_root,
            out_path=manifest_out,
            pitch_map_out=resolved_pitch_map_out,
            limit=args.limit,
            name_mode=args.name_mode,
            vocadito_annotator=args.vocadito_annotator,
            allowed_stems=allowed_stems,
            split_name=args.split,
            split_keys_source=split_keys_source,
            stage_root=Path(args.stage_root).resolve() if args.stage_root else None,
            stage_clean=args.stage_clean,
            humtrans_pitch_map=humtrans_pitch_map,
        )
    elif args.archive and args.stage_root:
        if args.dataset != "humtrans":
            raise SystemExit("--archive + --stage-root direct staging is currently supported only for the humtrans preset")
        if allowed_stems is None:
            raise SystemExit("--archive + --stage-root requires --split so the helper can choose a bounded subset")
        manifest_out = Path(args.manifest_out).resolve() if args.manifest_out else manifest_path(args.dataset).resolve()
        resolved_pitch_map_out = (
            Path(args.pitch_map_out).resolve()
            if args.pitch_map_out
            else pitch_map_path(args.dataset).resolve()
        )
        staged_root, staged_files, source_audio_count, selected_before_limit = stage_zip_subset(
            archive_path=archive_path,
            allowed_stems=allowed_stems,
            limit=args.limit,
            stage_root=Path(args.stage_root).resolve(),
            clean=args.stage_clean,
        )
        if args.midi_archive:
            selected_stage_stems = {path.stem for path in staged_files}
            humtrans_pitch_map, midi_source_count, midi_selected_before_limit = build_humtrans_pitch_map_from_midi_archive(
                Path(args.midi_archive).resolve(),
                allowed_stems=selected_stage_stems,
                limit=None,
            )
            summary["midiReference"] = {
                "mode": "archive",
                "path": str(Path(args.midi_archive).resolve()),
                "annotatedCases": len(humtrans_pitch_map),
                "sourceMidiCount": midi_source_count,
                "selectedBeforeLimit": midi_selected_before_limit,
            }
        summary["manifestBuild"] = build_manifest_from_stage(
            dataset=args.dataset,
            stage_root=staged_root,
            out_path=manifest_out,
            pitch_map_out=resolved_pitch_map_out,
            limit=args.limit,
            name_mode=args.name_mode,
            split_name=args.split,
            split_keys_source=split_keys_source,
            source_audio_count=source_audio_count,
            selected_before_limit=selected_before_limit,
            humtrans_pitch_map=humtrans_pitch_map,
        )
        summary["stagedFromArchive"] = str(archive_path)
        summary["stagedMembers"] = len(staged_files)
    elif args.remote_subset:
        if args.dataset != "humtrans":
            raise SystemExit("--remote-subset is currently supported only for the humtrans preset")
        if not args.split:
            raise SystemExit("--remote-subset requires --split so the helper can bound the selected subset")
        if not args.stage_root:
            raise SystemExit("--remote-subset requires --stage-root")
        manifest_out = Path(args.manifest_out).resolve() if args.manifest_out else manifest_path(args.dataset).resolve()
        resolved_pitch_map_out = (
            Path(args.pitch_map_out).resolve()
            if args.pitch_map_out
            else pitch_map_path(args.dataset).resolve()
        )
        staged_root, staged_files, source_audio_count, selected_before_limit = stage_remote_zip_subset(
            url=str(preset["download_url"]),
            allowed_stems=allowed_stems,
            limit=args.limit,
            stage_root=Path(args.stage_root).resolve(),
            clean=args.stage_clean,
        )
        if args.include_midi_ref:
            selected_stage_stems = {path.stem for path in staged_files}
            midi_url = preset.get("midi_download_url")
            if not isinstance(midi_url, str) or not midi_url:
                raise SystemExit("this preset does not define a remote MIDI archive")
            humtrans_pitch_map, midi_source_count, midi_selected_before_limit = build_humtrans_pitch_map_from_remote_midi_archive(
                midi_url,
                allowed_stems=selected_stage_stems,
                limit=None,
            )
            summary["midiReference"] = {
                "mode": "remote_archive",
                "path": midi_url,
                "annotatedCases": len(humtrans_pitch_map),
                "sourceMidiCount": midi_source_count,
                "selectedBeforeLimit": midi_selected_before_limit,
            }
        summary["manifestBuild"] = build_manifest_from_stage(
            dataset=args.dataset,
            stage_root=staged_root,
            out_path=manifest_out,
            pitch_map_out=resolved_pitch_map_out,
            limit=args.limit,
            name_mode=args.name_mode,
            split_name=args.split,
            split_keys_source=split_keys_source,
            source_audio_count=source_audio_count,
            selected_before_limit=selected_before_limit,
            humtrans_pitch_map=humtrans_pitch_map,
        )
        summary["stagedFromRemoteArchive"] = str(preset["download_url"])
        summary["stagedMembers"] = len(staged_files)

    print(json.dumps(summary, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
