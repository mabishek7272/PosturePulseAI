"""Study A long-format dataset loader (docs/phase4/technical-validation-study-protocol.md).

A Study A pairing is per subject, per trial, per metric, per side, per
reference instrument - one physiotherapist measurement lined up against one
of this system's own estimates. This module turns a long-format CSV of those
pairings into validated rows for app.analysis.agreement; it has no opinion on
bias, limits of agreement or ICC - that is agreement.py's job.

Validation happens here, not there, so a malformed CSV fails loudly (an
exception naming the row and the problem) rather than producing a
statistically-plausible-looking number from bad input - the same reasoning
CLAUDE.md rule 3 applies to a single measurement applies to a whole study
dataset.
"""
from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass

from app.metrics.static_metrics import STATIC_METRICS

REQUIRED_COLUMNS = {
    "subject_id",
    "trial",
    "metric_key",
    "side",
    "unit",
    "system_value",
    "reference_value",
    "reference_instrument",
    "excluded_reason",
}

REFERENCE_INSTRUMENTS = {
    "universal_goniometer",
    "digital_inclinometer",
    "plumb_line_photo",
    "anthropometric_tape",
}

_VALID_SIDES = {"left", "right", "bilateral"}


class StudyDatasetError(ValueError):
    """Raised for a malformed Study A dataset - always names the offending row."""


@dataclass(frozen=True)
class StudyRow:
    line_no: int  # 1-based, including the header, so it matches a text editor
    subject_id: str
    trial: str
    metric_key: str
    side: str | None
    unit: str
    system_value: float | None
    reference_value: float | None
    reference_instrument: str
    excluded_reason: str | None

    @property
    def included(self) -> bool:
        return self.excluded_reason is None


@dataclass(frozen=True)
class StudyDataset:
    rows: list[StudyRow]
    sha256: str
    source_path: str


def _parse_optional_float(raw: str, line_no: int, field: str) -> float | None:
    raw = raw.strip()
    if raw == "":
        return None
    try:
        value = float(raw)
    except ValueError as exc:
        raise StudyDatasetError(f"line {line_no}: {field!r} is not a number: {raw!r}") from exc
    if not (value == value and abs(value) != float("inf")):  # NaN or +/-inf
        raise StudyDatasetError(f"line {line_no}: {field!r} must be finite, got {raw!r}")
    return value


def load_study_dataset(path: str) -> StudyDataset:
    """Loads and validates a long-format Study A CSV; raises StudyDatasetError on the first problem found."""
    with open(path, newline="", encoding="utf-8") as f:
        raw_bytes = f.read().encode("utf-8")
    sha256 = hashlib.sha256(raw_bytes).hexdigest()

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise StudyDatasetError("CSV has no header row.")
        missing = REQUIRED_COLUMNS - set(reader.fieldnames)
        if missing:
            raise StudyDatasetError(f"CSV is missing required column(s): {sorted(missing)}")

        rows: list[StudyRow] = []
        seen_keys: dict[tuple, int] = {}
        for i, raw_row in enumerate(reader):
            line_no = i + 2  # header is line 1
            metric_key = raw_row["metric_key"].strip()
            metric = STATIC_METRICS.get(metric_key)
            if metric is None:
                raise StudyDatasetError(
                    f"line {line_no}: metric_key {metric_key!r} is not in the live metric catalog "
                    f"(app.metrics.static_metrics.STATIC_METRICS) - no alias layer; use the real key."
                )

            unit = raw_row["unit"].strip()
            if unit != metric.unit:
                raise StudyDatasetError(
                    f"line {line_no}: unit {unit!r} for {metric_key!r} does not match the catalog unit "
                    f"{metric.unit!r} - a stratum must never mix units."
                )

            side_raw = raw_row["side"].strip()
            side: str | None = side_raw or None
            if side is not None and side not in _VALID_SIDES:
                raise StudyDatasetError(f"line {line_no}: side {side_raw!r} must be one of {sorted(_VALID_SIDES)} or empty.")

            instrument = raw_row["reference_instrument"].strip()
            if instrument not in REFERENCE_INSTRUMENTS:
                raise StudyDatasetError(
                    f"line {line_no}: reference_instrument {instrument!r} must be one of {sorted(REFERENCE_INSTRUMENTS)}."
                )

            subject_id = raw_row["subject_id"].strip()
            trial = raw_row["trial"].strip()
            if not subject_id or not trial:
                raise StudyDatasetError(f"line {line_no}: subject_id and trial must both be non-empty.")

            excluded_reason = raw_row["excluded_reason"].strip() or None

            key = (subject_id, trial, metric_key, side, instrument)
            if key in seen_keys:
                raise StudyDatasetError(
                    f"line {line_no}: duplicate (subject_id, trial, metric_key, side, reference_instrument) "
                    f"{key} - first seen at line {seen_keys[key]}."
                )
            seen_keys[key] = line_no

            system_value = _parse_optional_float(raw_row["system_value"], line_no, "system_value")
            reference_value = _parse_optional_float(raw_row["reference_value"], line_no, "reference_value")

            if excluded_reason is None:
                if system_value is None or reference_value is None:
                    raise StudyDatasetError(
                        f"line {line_no}: an included row (no excluded_reason) needs both system_value and "
                        f"reference_value; a missing value is never silently zero-filled - either supply both "
                        f"or set excluded_reason."
                    )
            rows.append(
                StudyRow(
                    line_no=line_no,
                    subject_id=subject_id,
                    trial=trial,
                    metric_key=metric_key,
                    side=side,
                    unit=unit,
                    system_value=system_value,
                    reference_value=reference_value,
                    reference_instrument=instrument,
                    excluded_reason=excluded_reason,
                )
            )

    if not rows:
        raise StudyDatasetError("CSV has a valid header but no data rows.")

    return StudyDataset(rows=rows, sha256=sha256, source_path=path)
