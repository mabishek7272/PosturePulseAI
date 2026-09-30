"""CLI entry point for Study A (docs/phase4/statistical-analysis-plan.md).

Usage:
    python3 -m app.analysis.run_technical_feasibility --csv paired_angles.csv

Expects a CSV with columns `system_degrees,reference_degrees` - one paired
sample per row, produced by whatever pipeline pairs this system's output
with the reference instrument's (calibrated optical motion capture or
goniometry) reading for the same joint at the same instant. Column pairing
and time-synchronization are the clinical/measurement team's responsibility
(study-charter-skeleton.md, Study A) - this script only computes the
prespecified statistics from an already-paired file; it never guesses a
pairing.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys

from app.analysis.technical_feasibility import (
    compute_angle_error_summary,
    compute_bland_altman,
)


def load_paired_csv(path: str) -> tuple[list[float], list[float]]:
    system_degrees: list[float] = []
    reference_degrees: list[float] = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or {"system_degrees", "reference_degrees"} - set(reader.fieldnames):
            raise ValueError("CSV must have columns 'system_degrees' and 'reference_degrees'.")
        for row in reader:
            system_degrees.append(float(row["system_degrees"]))
            reference_degrees.append(float(row["reference_degrees"]))
    return system_degrees, reference_degrees


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="Path to a paired system_degrees,reference_degrees CSV.")
    args = parser.parse_args()

    system_degrees, reference_degrees = load_paired_csv(args.csv)
    error_summary = compute_angle_error_summary(system_degrees, reference_degrees)
    bland_altman = compute_bland_altman(system_degrees, reference_degrees)

    print(
        json.dumps(
            {
                "n": error_summary.n,
                "angleError": {
                    "medianAbsErrorDegrees": error_summary.median_abs_error_degrees,
                    "p95AbsErrorDegrees": error_summary.p95_abs_error_degrees,
                    "meanAbsErrorDegrees": error_summary.mean_abs_error_degrees,
                    "maxAbsErrorDegrees": error_summary.max_abs_error_degrees,
                },
                "blandAltman": {
                    "biasDegrees": bland_altman.bias_degrees,
                    "sdDiffDegrees": bland_altman.sd_diff_degrees,
                    "upperLoaDegrees": bland_altman.upper_loa_degrees,
                    "lowerLoaDegrees": bland_altman.lower_loa_degrees,
                },
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
