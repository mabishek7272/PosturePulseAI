"""CLI entry point for Study A's agreement-with-a-reference-method analysis
(ADR-018, docs/phase4/technical-validation-study-protocol.md).

Usage:
    python3 -m app.analysis.run_agreement --csv study_a_pairings.csv [--out report.md]
                                           [--json-out report.json]
                                           [--repeated-measures-method subject_means]

Expects the long-format CSV documented in app.analysis.study_dataset
(subject_id, trial, metric_key, side, unit, system_value, reference_value,
reference_instrument, excluded_reason). Exits non-zero, with no report
written, on a dataset that fails validation - this script never produces a
plausible-looking number from bad input.

Every report - JSON or Markdown - is stamped with the dataset's own sha256,
METRICS_VERSION and the current git commit, so the artefact names exactly
what produced it (docs/traceability-matrix.md). This script computes
agreement with a reference method; it never writes the words "validation"
or "accuracy", and every stratum carries thresholdStatus: "not set" until a
clinical lead fills the threshold table.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import subprocess
import sys
from datetime import datetime, timezone

from app.analysis.agreement import AgreementStratum, compute_agreement
from app.analysis.study_dataset import StudyDatasetError, load_study_dataset
from app.versioning import METRICS_VERSION


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5, check=True
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def _to_camel_case(snake: str) -> str:
    head, *tail = snake.split("_")
    return head + "".join(word.capitalize() for word in tail)


def _camel_case_keys(value):
    if isinstance(value, dict):
        return {_to_camel_case(k): _camel_case_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_camel_case_keys(v) for v in value]
    return value


def _stratum_to_dict(s: AgreementStratum) -> dict:
    """Snake_case dataclass fields -> camelCase, matching this codebase's JSON convention elsewhere (packages/schemas)."""
    return _camel_case_keys(dataclasses.asdict(s))


def _render_markdown(strata: list[AgreementStratum], header: dict) -> str:
    lines = [
        "# Study A: agreement with a reference method",
        "",
        "This is **not** a validation or accuracy report - it describes how closely this",
        'system\'s estimates agree with a physiotherapist\'s manual measurement (the',
        "reference method), stratum by stratum. Every row's `thresholdStatus` is",
        '"not set" until a clinical lead signs off on the threshold table',
        "(docs/phase4/technical-validation-study-protocol.md section 9).",
        "",
        f"- Dataset: `{header['sourcePath']}` (sha256 `{header['datasetSha256']}`)",
        f"- Metrics version: `{header['metricsVersion']}`",
        f"- Git commit: `{header['gitCommit']}`",
        f"- Generated at: {header['generatedAt']}",
        f"- Repeated-measures method used: `{header['repeatedMeasuresMethod']}`",
        "",
    ]
    for s in strata:
        side = s.side or "—"
        lines += [
            f"## {s.metric_key} ({side}) vs {s.reference_instrument}",
            "",
            f"- n pairs / n subjects: {s.n_pairs} / {s.n_subjects}",
            f"- Valid-sample rate: {s.valid_sample_rate:.1%}",
            f"- Bias: {s.bias:.3f} {s.unit} (95% CI {s.bias_ci_low:.3f} to {s.bias_ci_high:.3f}, {s.ci_method})",
            f"- 95% limits of agreement: {s.lower_loa:.3f} to {s.upper_loa:.3f} {s.unit}"
            f" (± {s.loa_ci_half_width:.3f} CI half-width)",
            f"- RMSE: {s.rmse:.3f} {s.unit}",
            f"- ICC(2,1): {s.icc:.3f} (95% CI {s.icc_ci_low:.3f} to {s.icc_ci_high:.3f}, {s.ci_method})",
            f"- Pearson r (system vs reference): {s.pearson_r:.3f}"
            + (" — **possible sign inversion**" if s.sign_inversion_suspected else ""),
            f"- Proportional bias: slope {s.proportional_bias.slope:.4f}, r {s.proportional_bias.pearson_r:.3f}"
            + (" — **detected**" if s.proportional_bias.detected else " — not detected"),
        ]
        if s.reference_repeatability is not None:
            rr = s.reference_repeatability
            lines.append(
                f"- Reference repeatability: within-subject SD {rr.within_subject_sd:.3f} {s.unit}, "
                f"coefficient of repeatability {rr.coefficient_of_repeatability:.3f} {s.unit} "
                f"({rr.n_subjects} subjects, {rr.n_observations} repeat observations)"
            )
        else:
            lines.append("- Reference repeatability: not computable (no subject has 2+ reference measurements)")
        lines += [f"- Threshold status: **{s.threshold_status}**", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", required=True, help="Path to the long-format Study A pairings CSV.")
    parser.add_argument("--out", help="Path to write the Markdown report. Prints to stdout if omitted.")
    parser.add_argument("--json-out", help="Optional path to also write the machine-readable JSON report.")
    parser.add_argument(
        "--repeated-measures-method",
        choices=["repeated_measures", "subject_means"],
        default="repeated_measures",
        help="Which of the two repeated-measures handling methods to use (ADR-018 Part 3). Default: repeated_measures.",
    )
    parser.add_argument("--confidence", type=float, default=0.95, help="Confidence level for intervals (default 0.95).")
    args = parser.parse_args(argv)

    try:
        dataset = load_study_dataset(args.csv)
    except StudyDatasetError as exc:
        print(f"Dataset failed validation: {exc}", file=sys.stderr)
        return 1

    strata = compute_agreement(
        dataset.rows, confidence=args.confidence, repeated_measures_method=args.repeated_measures_method
    )

    header = {
        "sourcePath": dataset.source_path,
        "datasetSha256": dataset.sha256,
        "metricsVersion": METRICS_VERSION,
        "gitCommit": _git_commit(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "repeatedMeasuresMethod": args.repeated_measures_method,
    }

    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump({"header": header, "strata": [_stratum_to_dict(s) for s in strata]}, f, indent=2)

    report = _render_markdown(strata, header)
    if args.out:
        with open(args.out, "w") as f:
            f.write(report)
    else:
        print(report)

    return 0


if __name__ == "__main__":
    sys.exit(main())
