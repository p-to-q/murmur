from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TOOLS_DIR = Path(__file__).resolve().parent


def audio_audit_path() -> Path:
    override = os.environ.get("MURMUR_AUDIO_AUDIT_PATH")
    if override:
        return Path(override).resolve()
    return TOOLS_DIR / "audio_audit.py"


def load_config(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("closure config must be a JSON object")
    suites = payload.get("suites")
    if not isinstance(suites, list) or not suites:
        raise ValueError("closure config must contain a non-empty suites array")
    return payload


def manifest_has_cases(path: Path) -> bool:
    payload = json.loads(path.read_text())
    return isinstance(payload, list) and len(payload) > 0


def summarize_suite_output(payload: dict[str, Any]) -> dict[str, Any]:
    runs = payload.get("runs", [])
    if not isinstance(runs, list):
        runs = []
    provider_summaries: dict[str, Any] = {}
    families: dict[str, dict[str, Any]] = {}
    tags: dict[str, dict[str, Any]] = {}
    for run in runs:
        if not isinstance(run, dict):
            continue
        provider = str(run.get("provider") or "unknown")
        summary = run.get("summary", {})
        provider_summaries[provider] = summary
        if isinstance(summary, dict):
            for family, family_summary in (summary.get("families") or {}).items():
                if isinstance(family, str) and isinstance(family_summary, dict):
                    families[f"{provider}:{family}"] = family_summary
            for tag, tag_summary in (summary.get("tags") or {}).items():
                if isinstance(tag, str) and isinstance(tag_summary, dict):
                    tags[f"{provider}:{tag}"] = tag_summary

    gate = payload.get("gate")
    gate_ok = bool(gate.get("ok")) if isinstance(gate, dict) else True
    return {
        "providers": provider_summaries,
        "families": families,
        "tags": tags,
        "runs": runs,
        "gate": gate if isinstance(gate, dict) else None,
        "ok": gate_ok,
    }


def weak_bucket_entry(
    *,
    suite: str,
    scope: str,
    summary: dict[str, Any],
    priority: int = 0,
) -> dict[str, object] | None:
    avg_pitch = summary.get("avgPitchMatchScore")
    avg_feel = summary.get("avgMusicFeelScore")
    warn = int(summary.get("warn", 0)) if isinstance(summary.get("warn"), (int, float)) else 0
    fail = int(summary.get("fail", 0)) if isinstance(summary.get("fail"), (int, float)) else 0
    error = int(summary.get("error", 0)) if isinstance(summary.get("error"), (int, float)) else 0

    reasons: list[str] = []
    if error > 0:
        reasons.append("errors present")
    if fail > 0:
        reasons.append("failed cases present")
    if warn > 0:
        reasons.append("warn cases present")
    if isinstance(avg_pitch, (int, float)) and float(avg_pitch) < 0.8:
        reasons.append("pitch match is soft")
    if isinstance(avg_feel, (int, float)) and float(avg_feel) < 0.75:
        reasons.append("music feel is soft")

    if not reasons:
        return None

    return {
        "suite": suite,
        "scope": scope,
        "priority": priority,
        "avgPitchMatchScore": round(float(avg_pitch), 3) if isinstance(avg_pitch, (int, float)) else None,
        "avgMusicFeelScore": round(float(avg_feel), 3) if isinstance(avg_feel, (int, float)) else None,
        "warn": warn,
        "fail": fail,
        "error": error,
        "reasons": reasons,
    }


def weakness_sort_key(item: dict[str, object]) -> tuple[int, float, float, int, int, int, str]:
    pitch = item.get("avgPitchMatchScore")
    feel = item.get("avgMusicFeelScore")
    return (
        -int(item.get("priority", 0)),
        float(pitch) if isinstance(pitch, (int, float)) else 1.0,
        float(feel) if isinstance(feel, (int, float)) else 1.0,
        -int(item.get("error", 0)),
        -int(item.get("fail", 0)),
        -int(item.get("warn", 0)),
        str(item.get("scope", "")),
    )


def render_closure_markdown(payload: dict[str, Any]) -> str:
    lines: list[str] = []
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    ok = bool(payload.get("ok"))
    summary = payload.get("summary", {})
    suites = payload.get("suites", [])

    lines.append("# Murmur Audio Closure Report")
    lines.append("")
    lines.append(f"- Generated at: `{generated_at}`")
    lines.append(f"- Config: `{payload.get('config')}`")
    lines.append(f"- Overall status: `{'ok' if ok else 'failed'}`")
    lines.append("")

    if isinstance(summary, dict):
        real_data_suites = summary.get("realDataSuites") or []
        empty_optional = summary.get("emptyOptionalManifests") or []
        missing_optional = summary.get("missingOptionalManifests") or []
        lines.append("## Coverage")
        lines.append("")
        lines.append(f"- Real-data suites with cases: `{len(real_data_suites)}`")
        lines.append(f"- Optional manifests missing: `{len(missing_optional)}`")
        lines.append(f"- Optional manifests empty: `{len(empty_optional)}`")
        if real_data_suites:
            lines.append(f"- Real-data suite names: `{', '.join(str(item) for item in real_data_suites)}`")
        lines.append("")

    lines.append("## Suites")
    lines.append("")
    for suite in suites if isinstance(suites, list) else []:
        if not isinstance(suite, dict):
            continue
        name = str(suite.get("name") or "unknown_suite")
        status = str(suite.get("status") or "unknown")
        required = bool(suite.get("required", False))
        lines.append(f"### {name}")
        lines.append("")
        lines.append(f"- Required: `{'yes' if required else 'no'}`")
        lines.append(f"- Status: `{status}`")
        result = suite.get("result")
        if isinstance(result, dict):
            providers = result.get("providers", {})
            if isinstance(providers, dict) and providers:
                lines.append("- Providers:")
                for provider, provider_summary in providers.items():
                    if not isinstance(provider_summary, dict):
                        continue
                    lines.append(
                        "  - "
                        f"`{provider}` pitch `{provider_summary.get('avgPitchMatchScore', 'n/a')}` "
                        f"feel `{provider_summary.get('avgMusicFeelScore', 'n/a')}` "
                        f"warn `{provider_summary.get('warn', 0)}` "
                        f"fail `{provider_summary.get('fail', 0)}` "
                        f"p95PitchMs `{provider_summary.get('p95PitchMs', 'n/a')}`"
                    )
        lines.append("")

    if isinstance(summary, dict):
        weak_families = summary.get("weakFamilies") or []
        weak_tags = summary.get("weakTags") or []
        weak_cases = summary.get("weakCases") or []
        primary_slow_providers = summary.get("primaryPathSlowProviders") or []
        slow_providers = summary.get("slowProviders") or []
        slow_cases = summary.get("slowCases") or []
        latency_archetypes = summary.get("latencyArchetypes") or []
        engineering_tail_subfamilies = summary.get("engineeringTailSubfamilies") or []
        next_actions = summary.get("nextActions") or []

        lines.append("## Risks")
        lines.append("")
        if weak_families:
            lines.append("### Weak families")
            lines.append("")
            for item in weak_families:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('scope')}` in `{item.get('suite')}` "
                    f"(pitch `{item.get('avgPitchMatchScore')}`, feel `{item.get('avgMusicFeelScore')}`, "
                    f"warn `{item.get('warn')}`, fail `{item.get('fail')}`, error `{item.get('error')}`): "
                    f"{', '.join(str(reason) for reason in item.get('reasons', []))}"
                )
            lines.append("")
        if weak_tags:
            lines.append("### Weak tags")
            lines.append("")
            for item in weak_tags:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('scope')}` in `{item.get('suite')}` "
                    f"(pitch `{item.get('avgPitchMatchScore')}`, feel `{item.get('avgMusicFeelScore')}`, "
                    f"warn `{item.get('warn')}`, fail `{item.get('fail')}`, error `{item.get('error')}`): "
                    f"{', '.join(str(reason) for reason in item.get('reasons', []))}"
                )
            lines.append("")
        if weak_cases:
            lines.append("### Weak cases")
            lines.append("")
            for item in weak_cases:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('case')}` in `{item.get('suite')}` via `{item.get('provider')}` "
                    f"(status `{item.get('status')}`, pitch `{item.get('pitchMatchScore')}`, "
                    f"feel `{item.get('musicFeelScore')}`, hypothesis `{item.get('noteHypothesis')}`)"
                )
            lines.append("")
        if primary_slow_providers:
            lines.append("### Primary-path slow providers")
            lines.append("")
            for item in primary_slow_providers:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    f"- `{item.get('provider')}` in `{item.get('suite')}` with p95 pitch `{item.get('p95PitchMs')}` ms"
                )
            lines.append("")
        if slow_providers:
            lines.append("### Slow providers")
            lines.append("")
            for item in slow_providers:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    f"- `{item.get('provider')}` in `{item.get('suite')}` with p95 pitch `{item.get('p95PitchMs')}` ms"
                )
            lines.append("")
        if slow_cases:
            lines.append("### Slow cases")
            lines.append("")
            for item in slow_cases:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('case')}` in `{item.get('suite')}` "
                    f"(requested `{item.get('requestedProvider')}`, selected `{item.get('provider')}`, "
                    f"pitch `{item.get('pitchMs')}` ms, providerPitch `{item.get('providerPitchMs')}` ms, "
                    f"decision `{item.get('ensembleDecision')}`)"
                )
            lines.append("")
        if latency_archetypes:
            lines.append("### Latency archetypes")
            lines.append("")
            for item in latency_archetypes:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('kind')}` in `{item.get('suite')}` via `{item.get('case')}`: "
                    f"{item.get('summary')}"
                )
            lines.append("")
        if engineering_tail_subfamilies:
            lines.append("### Engineering-tail subfamilies")
            lines.append("")
            for item in engineering_tail_subfamilies:
                if not isinstance(item, dict):
                    continue
                lines.append(
                    "- "
                    f"`{item.get('kind')}` in `{item.get('suite')}` via `{item.get('case')}`: "
                    f"{item.get('summary')}"
                )
            lines.append("")

        lines.append("## Next actions")
        lines.append("")
        for action in next_actions:
            lines.append(f"- {action}")
        lines.append("")

    return "\n".join(lines)


def build_closure_summary(suites: list[dict[str, Any]]) -> dict[str, Any]:
    required_failed: list[str] = []
    missing_optional_manifests: list[str] = []
    empty_optional_manifests: list[str] = []
    real_data_suites: list[str] = []
    weak_families_by_scope: dict[tuple[str, str], dict[str, object]] = {}
    weak_tags_by_scope: dict[tuple[str, str], dict[str, object]] = {}
    weak_cases: list[dict[str, object]] = []
    primary_path_slow_providers: list[dict[str, object]] = []
    slow_providers: list[dict[str, object]] = []
    slow_cases: list[dict[str, object]] = []

    for suite in suites:
        name = str(suite.get("name") or "unknown_suite")
        status = str(suite.get("status") or "unknown")
        required = bool(suite.get("required", False))
        if required and not bool(suite.get("ok", False)):
            required_failed.append(name)
        if status == "skipped_missing_manifest" and isinstance(suite.get("manifest"), str):
            missing_optional_manifests.append(str(suite["manifest"]))
        if status == "skipped_empty_manifest" and isinstance(suite.get("manifest"), str):
            empty_optional_manifests.append(str(suite["manifest"]))

        suite_priority = int(suite.get("priority", 0)) if isinstance(suite.get("priority"), (int, float)) else 0

        result = suite.get("result")
        if not isinstance(result, dict):
            continue

        families_result = result.get("families", {})
        if isinstance(families_result, dict):
            family_keys = [str(key) for key in families_result.keys()]
            if any(
                not key.endswith(":synthetic")
                and "murmur_golden_seeded" not in key
                for key in family_keys
            ):
                real_data_suites.append(name)

        for provider, summary in result.get("providers", {}).items():
            if not isinstance(summary, dict):
                continue
            p95 = summary.get("p95PitchMs")
            if isinstance(p95, (int, float)) and float(p95) >= 120:
                provider_entry = {
                    "suite": name,
                    "provider": provider,
                    "p95PitchMs": round(float(p95), 3),
                    "priority": suite_priority,
                }
                slow_providers.append(provider_entry)
                if provider == "auto":
                    primary_path_slow_providers.append(provider_entry)

        for scoped_family, summary in result.get("families", {}).items():
            if not isinstance(summary, dict):
                continue
            provider_scope = str(scoped_family).split(":", 1)[0]
            weak_entry = weak_bucket_entry(
                suite=name,
                scope=str(scoped_family),
                summary=summary,
                priority=suite_priority,
            )
            if weak_entry is not None:
                existing = weak_families_by_scope.get((name, provider_scope))
                if existing is None or weakness_sort_key(weak_entry) < weakness_sort_key(existing):
                    weak_families_by_scope[(name, provider_scope)] = weak_entry

        for scoped_tag, summary in result.get("tags", {}).items():
            if not isinstance(summary, dict):
                continue
            provider_scope = str(scoped_tag).split(":", 1)[0]
            weak_entry = weak_bucket_entry(
                suite=name,
                scope=str(scoped_tag),
                summary=summary,
                priority=suite_priority,
            )
            if weak_entry is not None:
                existing = weak_tags_by_scope.get((name, provider_scope))
                if existing is None or weakness_sort_key(weak_entry) < weakness_sort_key(existing):
                    weak_tags_by_scope[(name, provider_scope)] = weak_entry

        runs = result.get("runs")
        if isinstance(runs, list):
            for run in runs:
                if not isinstance(run, dict):
                    continue
                requested_provider = str(run.get("provider") or "unknown")
                cases = run.get("cases")
                if not isinstance(cases, list):
                    continue
                run_weak_cases = [
                    case
                    for case in cases
                    if isinstance(case, dict)
                    and str(case.get("status") or "pass") in {"warn", "fail", "error"}
                ]
                run_weak_cases.sort(
                    key=lambda case: (
                        {"error": 0, "fail": 1, "warn": 2}.get(str(case.get("status")), 3),
                        float(case.get("pitchMatchScore", 1.0))
                        if isinstance(case.get("pitchMatchScore"), (int, float))
                        else 1.0,
                        float((case.get("musicFeel") or {}).get("score", 1.0))
                        if isinstance(case.get("musicFeel"), dict)
                        and isinstance((case.get("musicFeel") or {}).get("score"), (int, float))
                        else 1.0,
                        str(case.get("case") or ""),
                    )
                )
                for case in run_weak_cases[:2]:
                    diagnostics = case.get("diagnostics") if isinstance(case.get("diagnostics"), dict) else {}
                    weak_cases.append(
                        {
                            "suite": name,
                            "provider": requested_provider,
                            "case": str(case.get("case") or "unknown_case"),
                            "status": str(case.get("status") or "warn"),
                            "pitchMatchScore": case.get("pitchMatchScore"),
                            "musicFeelScore": (
                                (case.get("musicFeel") or {}).get("score")
                                if isinstance(case.get("musicFeel"), dict)
                                else None
                            ),
                            "noteHypothesis": diagnostics.get("noteHypothesis"),
                        }
                    )
                for case in cases:
                    if not isinstance(case, dict):
                        continue
                    diagnostics = case.get("diagnostics") if isinstance(case.get("diagnostics"), dict) else {}
                    pitch_ms = diagnostics.get("pitchMs")
                    if not isinstance(pitch_ms, (int, float)) or float(pitch_ms) < 250:
                        continue
                    slow_cases.append(
                        {
                            "suite": name,
                            "requestedProvider": requested_provider,
                            "provider": str(case.get("provider") or requested_provider),
                            "case": str(case.get("case") or "unknown_case"),
                            "status": str(case.get("status") or "pass"),
                            "pitchMs": round(float(pitch_ms), 3),
                            "providerPitchMs": (
                                round(float(diagnostics.get("providerPitchMs")), 3)
                                if isinstance(diagnostics.get("providerPitchMs"), (int, float))
                                else None
                            ),
                            "ensembleDecision": diagnostics.get("ensembleDecision"),
                            "pitchMatchScore": case.get("pitchMatchScore"),
                            "musicFeelScore": (
                                (case.get("musicFeel") or {}).get("score")
                                if isinstance(case.get("musicFeel"), dict)
                                else None
                            ),
                            "priority": suite_priority,
                            "alternateReviewMode": diagnostics.get("alternateReviewMode"),
                            "acceptanceScore": diagnostics.get("acceptanceScore"),
                            "firstOnsetLag": diagnostics.get("firstOnsetLag"),
                            "onsetFragmentation": diagnostics.get("onsetFragmentation"),
                            "rushedRatio": diagnostics.get("rushedRatio"),
                            "interiorHoldRatio": diagnostics.get("interiorHoldRatio"),
                            "excessiveHoldRatio": diagnostics.get("excessiveHoldRatio"),
                            "voicedRatio": diagnostics.get("voicedRatio"),
                        }
                    )

    weak_families = list(weak_families_by_scope.values())
    weak_tags = list(weak_tags_by_scope.values())
    weak_families.sort(key=weakness_sort_key)
    weak_tags.sort(key=weakness_sort_key)
    weak_cases.sort(
        key=lambda item: (
            {"error": 0, "fail": 1, "warn": 2}.get(str(item.get("status")), 3),
            float(item.get("pitchMatchScore", 1.0))
            if isinstance(item.get("pitchMatchScore"), (int, float))
            else 1.0,
            float(item.get("musicFeelScore", 1.0))
            if isinstance(item.get("musicFeelScore"), (int, float))
            else 1.0,
            str(item.get("case") or ""),
        )
    )
    primary_path_slow_providers.sort(
        key=lambda item: (
            -int(item.get("priority", 0)),
            -float(item["p95PitchMs"]),
            str(item["provider"]),
        )
    )
    slow_providers.sort(
        key=lambda item: (
            -int(item.get("priority", 0)),
            -float(item["p95PitchMs"]),
            str(item["provider"]),
        )
    )
    slow_cases.sort(
        key=lambda item: (
            -int(item.get("priority", 0)),
            -float(item.get("pitchMs", 0.0)),
            float(item.get("pitchMatchScore", 1.0))
            if isinstance(item.get("pitchMatchScore"), (int, float))
            else 1.0,
            str(item.get("case") or ""),
        )
    )
    real_data_suites = sorted(set(real_data_suites))

    latency_archetypes: list[dict[str, object]] = []
    engineering_tail_subfamilies: list[dict[str, object]] = []
    quality_tail = next(
        (
            item
            for item in slow_cases
            if item.get("requestedProvider") == "auto"
            and item.get("provider") == "pyin"
            and isinstance(item.get("pitchMatchScore"), (int, float))
            and float(item["pitchMatchScore"]) >= 0.82
        ),
        None,
    )
    if quality_tail is not None:
        latency_archetypes.append(
            {
                "kind": "quality_tail",
                "suite": quality_tail["suite"],
                "case": quality_tail["case"],
                "summary": "fallback quality tail where pYIN still wins decisively enough that latency is likely buying fidelity rather than waste.",
            }
        )

    engineering_tail = next(
        (
            item
            for item in slow_cases
            if item.get("requestedProvider") == "auto"
            and item.get("provider") == "swiftf0"
            and isinstance(item.get("providerPitchMs"), (int, float))
            and float(item.get("pitchMs", 0.0)) - float(item["providerPitchMs"]) >= 1200
        ),
        None,
    )
    if engineering_tail is not None:
        latency_archetypes.append(
            {
                "kind": "engineering_tail",
                "suite": engineering_tail["suite"],
                "case": engineering_tail["case"],
                "summary": "ensemble cost tail where SwiftF0 still wins, so most of the delay is comparison overhead rather than the final detector choice.",
            }
        )

    engineering_tail_cases = [
        item
        for item in slow_cases
        if item.get("requestedProvider") == "auto"
        and item.get("provider") == "swiftf0"
        and isinstance(item.get("providerPitchMs"), (int, float))
        and float(item.get("pitchMs", 0.0)) - float(item["providerPitchMs"]) >= 900
    ]

    def classify_engineering_tail_subfamily(item: dict[str, object]) -> tuple[str, str]:
        alternate_mode = str(item.get("alternateReviewMode") or "")
        first_onset_lag = float(item.get("firstOnsetLag", 0.0) or 0.0)
        onset_fragmentation = float(item.get("onsetFragmentation", 0.0) or 0.0)
        rushed_ratio = float(item.get("rushedRatio", 0.0) or 0.0)
        interior_hold = float(item.get("interiorHoldRatio", 0.0) or 0.0)
        excessive_hold = float(item.get("excessiveHoldRatio", 0.0) or 0.0)

        if alternate_mode == "light_no_repair_compact":
            return (
                "compact_review_tail",
                "SwiftF0 is already clearly stable enough that the remaining cost is mostly compact alternate sanity review.",
            )
        if first_onset_lag >= 0.16:
            return (
                "late_onset_tail",
                "The phrase starts late enough that alternate review is still paying to double-check onset placement.",
            )
        if interior_hold >= 0.12 or excessive_hold >= 0.08:
            return (
                "hold_repair_tail",
                "The phrase still carries enough interior hold / overhold risk that alternate review is spending time on repair-sensitive timing.",
            )
        if onset_fragmentation >= 0.24 or rushed_ratio >= 0.45:
            return (
                "fragmented_urgent_tail",
                "The phrase is fragmented or rushed enough that alternate review is still paying for timing-shape confirmation.",
            )
        return (
            "general_review_tail",
            "SwiftF0 wins, but the case still sits in the general ensemble-overhead bucket rather than a sharper repair subtype.",
        )

    subfamily_examples: dict[str, dict[str, object]] = {}
    for item in engineering_tail_cases:
        kind, summary = classify_engineering_tail_subfamily(item)
        if kind in subfamily_examples:
            continue
        subfamily_examples[kind] = {
            "kind": kind,
            "suite": item["suite"],
            "case": item["case"],
            "summary": summary,
        }
    engineering_tail_subfamilies = list(subfamily_examples.values())

    next_actions: list[str] = []
    if missing_optional_manifests:
        next_actions.append("Build at least one local public-dataset or Murmur-golden manifest and rerun closure.")
    if empty_optional_manifests:
        named_empty = [Path(path).name for path in empty_optional_manifests]
        if named_empty == ["humtrans.local.json"]:
            next_actions.append("Populate the HumTrans local manifest when you want a second real humming suite beyond vocadito.")
        else:
            next_actions.append("Populate the scaffolded local manifests with real audio cases before treating those suites as meaningful.")
    for manifest_path in empty_optional_manifests:
        if manifest_path.endswith("murmur-golden.local.json"):
            next_actions.append("Bootstrap the local Murmur golden suite with `bun run audit:audio:seed-golden`, then rerun closure.")
            break
    if required_failed:
        next_actions.append("Fix the required baseline suite before trusting any optional dataset results.")
    primary_slowest = primary_path_slow_providers[0] if primary_path_slow_providers else None
    slowest = slow_providers[0] if slow_providers else None
    weakest_family = weak_families[0] if weak_families else None
    weakest_tag = weak_tags[0] if weak_tags else None
    latency_focus = primary_slowest or slowest

    if latency_focus and (
        weakest_family is None
        or int(latency_focus.get("priority", 0)) > int(weakest_family.get("priority", 0))
    ):
        next_actions.append(
            f"Review pitch latency for provider {latency_focus['provider']} in suite {latency_focus['suite']}."
        )
    if weak_families:
        weakest_family = weak_families[0]
        next_actions.append(
            f"Inspect the weakest family bucket first: {weakest_family['scope']} in suite {weakest_family['suite']}."
        )
    if weak_tags:
        weakest = weak_tags[0]
        next_actions.append(
            f"Inspect the weakest tag bucket first: {weakest['scope']} in suite {weakest['suite']}."
        )
    if weak_cases:
        weakest_case = weak_cases[0]
        next_actions.append(
            f"Open the weakest concrete case next: {weakest_case['case']} in suite {weakest_case['suite']} via {weakest_case['provider']}."
        )
    if slow_cases:
        slowest_case = slow_cases[0]
        next_actions.append(
            f"Inspect the slowest concrete case next: {slowest_case['case']} in suite {slowest_case['suite']} ({slowest_case['requestedProvider']} -> {slowest_case['provider']})."
        )
    if quality_tail is not None:
        next_actions.append(
            f"Treat {quality_tail['case']} in suite {quality_tail['suite']} as a quality-tail case first; do not trim latency by removing the pYIN win path unless fidelity stays intact."
        )
    if engineering_tail is not None:
        next_actions.append(
            f"Treat {engineering_tail['case']} in suite {engineering_tail['suite']} as an engineering-tail case next; focus on reducing ensemble overhead while keeping SwiftF0's final choice unchanged."
        )
    for family in engineering_tail_subfamilies[:3]:
        next_actions.append(
            f"Use {family['case']} in suite {family['suite']} as the current {family['kind']} example when deciding the next narrow latency rule."
        )
    if latency_focus and weakest_family is not None and (
        int(latency_focus.get("priority", 0)) <= int(weakest_family.get("priority", 0))
    ):
        next_actions.append(
            f"Review pitch latency for provider {latency_focus['provider']} in suite {latency_focus['suite']}."
        )
    if not next_actions:
        next_actions.append("Closure looks healthy; the next meaningful step is to add more real humming data.")

    return {
        "requiredFailed": required_failed,
        "missingOptionalManifests": missing_optional_manifests,
        "emptyOptionalManifests": empty_optional_manifests,
        "realDataSuites": real_data_suites,
        "weakFamilies": weak_families[:8],
        "weakTags": weak_tags[:8],
        "weakCases": weak_cases[:8],
        "primaryPathSlowProviders": primary_path_slow_providers[:8],
        "slowProviders": slow_providers[:8],
        "slowCases": slow_cases[:8],
        "latencyArchetypes": latency_archetypes,
        "engineeringTailSubfamilies": engineering_tail_subfamilies[:8],
        "nextActions": next_actions,
    }


def run_suite(worker_dir: Path, suite: dict[str, Any]) -> dict[str, Any]:
    name = str(suite.get("name") or "unnamed_suite")
    required = bool(suite.get("required", False))
    strict = bool(suite.get("strict", False))
    pretty = bool(suite.get("pretty", False))
    all_providers = bool(suite.get("allProviders", True))
    manifest = suite.get("manifest")
    manifest_root = suite.get("manifestRoot")
    manifest_case_limit = suite.get("manifestCaseLimit")
    manifest_only = bool(suite.get("manifestOnly", False))

    manifest_path: Path | None = None
    if isinstance(manifest, str) and manifest.strip():
        manifest_path = (worker_dir / manifest).resolve()
        if not manifest_path.exists():
            if required:
                return {
                    "name": name,
                    "required": required,
                    "status": "missing_required_manifest",
                    "ok": False,
                    "manifest": str(manifest_path),
                }
            return {
                "name": name,
                "required": required,
                "status": "skipped_missing_manifest",
                "ok": True,
                "manifest": str(manifest_path),
            }
        if not manifest_has_cases(manifest_path):
            if required:
                return {
                    "name": name,
                    "required": required,
                    "status": "empty_required_manifest",
                    "ok": False,
                    "manifest": str(manifest_path),
                }
            return {
                "name": name,
                "required": required,
                "status": "skipped_empty_manifest",
                "ok": True,
                "manifest": str(manifest_path),
            }

    cmd = [sys.executable, str(audio_audit_path())]
    if all_providers:
        cmd.append("--all-providers")
    else:
        provider = str(suite.get("provider") or "auto")
        cmd.extend(["--provider", provider])
    if strict:
        cmd.append("--strict")
    if pretty:
        cmd.append("--pretty")
    if manifest_path is not None:
        cmd.extend(["--manifest", str(manifest_path)])
    if manifest_only:
        cmd.append("--manifest-only")
    if isinstance(manifest_root, str) and manifest_root.strip():
        cmd.extend(["--manifest-root", str((worker_dir / manifest_root).resolve())])
    if isinstance(manifest_case_limit, int) and manifest_case_limit > 0:
        cmd.extend(["--manifest-case-limit", str(manifest_case_limit)])

    completed = subprocess.run(
        cmd,
        cwd=worker_dir,
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        try:
            payload = json.loads(completed.stdout) if completed.stdout.strip() else None
        except json.JSONDecodeError:
            payload = None
        return {
            "name": name,
            "required": required,
            "status": "failed",
            "ok": False,
            "command": cmd,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "result": summarize_suite_output(payload) if isinstance(payload, dict) else None,
        }

    payload = json.loads(completed.stdout)
    return {
        "name": name,
        "required": required,
        "status": "ok",
        "ok": True,
        "manifest": str(manifest_path) if manifest_path is not None else None,
        "command": cmd,
        "priority": int(suite.get("priority", 0)) if isinstance(suite.get("priority"), (int, float)) else 0,
        "result": summarize_suite_output(payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run Murmur's local audio evaluation closure across baseline and optional dataset suites."
    )
    parser.add_argument(
        "--config",
        default=str(TOOLS_DIR / "audio_eval_closure.example.json"),
        help="JSON config describing evaluation suites",
    )
    parser.add_argument(
        "--markdown-out",
        help="Optional path for a concise markdown closure report",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the combined JSON report",
    )
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config = load_config(config_path)
    worker_dir = TOOLS_DIR.parent

    suites_out: list[dict[str, Any]] = []
    overall_ok = True
    for suite in config["suites"]:
        if not isinstance(suite, dict):
            raise ValueError("every suite entry must be an object")
        result = run_suite(worker_dir, suite)
        suites_out.append(result)
        if not result.get("ok", False):
            overall_ok = False

    payload = {
        "config": str(config_path),
        "ok": overall_ok,
        "suites": suites_out,
        "summary": build_closure_summary(suites_out),
    }
    if args.markdown_out:
        markdown_path = Path(args.markdown_out).resolve()
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(render_closure_markdown(payload))
    print(json.dumps(payload, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
