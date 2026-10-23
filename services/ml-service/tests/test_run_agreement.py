"""Tests for the run_agreement CLI (app.analysis.run_agreement)."""
import json

import pytest

from app.analysis.run_agreement import main

HEADER = "subject_id,trial,metric_key,side,unit,system_value,reference_value,reference_instrument,excluded_reason\n"


def make_dataset_csv(tmp_path) -> str:
    rows = []
    for i in range(6):
        rows.append(f"s{i},t1,static.trunk_inclination,,deg,{1.0 + i},{1.2 + i},universal_goniometer,\n")
    rows.append("s0,t2,static.trunk_inclination,,deg,,,universal_goniometer,pipeline_unsupported\n")
    path = tmp_path / "study_a.csv"
    path.write_text(HEADER + "".join(rows))
    return str(path)


def test_cli_writes_a_markdown_report_naming_the_dataset_hash_and_versions(tmp_path, capsys):
    csv_path = make_dataset_csv(tmp_path)
    out_path = tmp_path / "report.md"
    rc = main(["--csv", csv_path, "--out", str(out_path)])
    assert rc == 0

    report = out_path.read_text()
    assert "static.trunk_inclination" in report
    assert "universal_goniometer" in report
    assert "not set" in report  # thresholdStatus
    assert "repeated_measures" in report  # which method was used, stated explicitly
    # Header must name the dataset hash so the artefact is self-describing.
    import hashlib

    expected_sha = hashlib.sha256(open(csv_path, "rb").read()).hexdigest()
    assert expected_sha in report


def test_cli_wording_never_claims_validation_or_accuracy(tmp_path):
    csv_path = make_dataset_csv(tmp_path)
    out_path = tmp_path / "report.md"
    main(["--csv", csv_path, "--out", str(out_path)])
    report = out_path.read_text()
    # "validation"/"accuracy" may appear only inside the report's own explicit
    # disclaimer that this is NOT a validation/accuracy report - never as an
    # unqualified claim (ADR-018's wording guard).
    for line in report.lower().splitlines():
        if ".md" in line:
            continue  # a reference to a doc filename, not a claim about this report
        if "validation" in line or "accuracy" in line:
            assert "not" in line, f"Unqualified validation/accuracy wording: {line!r}"


def test_cli_exits_non_zero_on_an_invalid_dataset(tmp_path, capsys):
    bad_path = tmp_path / "bad.csv"
    bad_path.write_text("subject_id,trial\ns1,t1\n")
    rc = main(["--csv", str(bad_path)])
    assert rc == 1
    assert "failed validation" in capsys.readouterr().err


def test_cli_also_writes_json_when_requested(tmp_path):
    csv_path = make_dataset_csv(tmp_path)
    md_path = tmp_path / "report.md"
    json_path = tmp_path / "report.json"
    rc = main(["--csv", csv_path, "--out", str(md_path), "--json-out", str(json_path)])
    assert rc == 0
    payload = json.loads(json_path.read_text())
    assert payload["header"]["repeatedMeasuresMethod"] == "repeated_measures"
    assert len(payload["strata"]) == 1
    assert payload["strata"][0]["thresholdStatus"] == "not set"


@pytest.mark.parametrize("method", ["repeated_measures", "subject_means"])
def test_cli_respects_the_repeated_measures_method_flag(tmp_path, method):
    csv_path = make_dataset_csv(tmp_path)
    json_path = tmp_path / "report.json"
    rc = main(["--csv", csv_path, "--json-out", str(json_path), "--repeated-measures-method", method, "--out", str(tmp_path / "r.md")])
    assert rc == 0
    payload = json.loads(json_path.read_text())
    assert payload["header"]["repeatedMeasuresMethod"] == method
    assert payload["strata"][0]["repeatedMeasuresMethod"] == method
