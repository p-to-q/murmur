"""NDJSON-free bridge used by the Bun cross-language Gate contract test."""

import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from quality_gate import analyze_wav


def main() -> None:
    requests = json.load(sys.stdin)
    results = [
        analyze_wav(base64.b64decode(item["audioBase64"]), item["expectedDuration"])
        for item in requests
    ]
    json.dump(results, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
