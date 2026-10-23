"""Tests for app.analysis.study_dataset - the Study A long-format CSV loader."""
import hashlib

import pytest

from app.analysis.study_dataset import StudyDatasetError, load_study_dataset

HEADER = "subject_id,trial,metric_key,side,unit,system_value,reference_value,reference_instrument,excluded_reason\n"


def write_csv(tmp_path, body: str, name="study.csv"):
    path = tmp_path / name
    path.write_text(HEADER + body)
    return str(path)


def row(
    subject="s1",
    trial="t1",
    metric="static.trunk_inclination",
    side="",
    unit="deg",
    system="1.0",
    reference="1.5",
    instrument="universal_goniometer",
    excluded="",
) -> str:
    return f"{subject},{trial},{metric},{side},{unit},{system},{reference},{instrument},{excluded}\n"


def test_loads_a_valid_minimal_dataset(tmp_path):
    csv_path = write_csv(tmp_path, row())
    dataset = load_study_dataset(csv_path)
    assert len(dataset.rows) == 1
    r = dataset.rows[0]
    assert r.subject_id == "s1" and r.metric_key == "static.trunk_inclination"
    assert r.system_value == 1.0 and r.reference_value == 1.5
    assert r.side is None
    assert r.included is True


def test_records_the_csv_sha256(tmp_path):
    csv_path = write_csv(tmp_path, row())
    dataset = load_study_dataset(csv_path)
    expected = hashlib.sha256((HEADER + row()).encode("utf-8")).hexdigest()
    assert dataset.sha256 == expected


def test_rejects_an_unknown_metric_key(tmp_path):
    csv_path = write_csv(tmp_path, row(metric="static.not_a_real_metric"))
    with pytest.raises(StudyDatasetError, match="not in the live metric catalog"):
        load_study_dataset(csv_path)


def test_rejects_a_unit_mismatch_with_the_catalog(tmp_path):
    csv_path = write_csv(tmp_path, row(unit="cm"))
    with pytest.raises(StudyDatasetError, match="does not match the catalog unit"):
        load_study_dataset(csv_path)


def test_rejects_an_unknown_reference_instrument(tmp_path):
    csv_path = write_csv(tmp_path, row(instrument="laser_scanner"))
    with pytest.raises(StudyDatasetError, match="reference_instrument"):
        load_study_dataset(csv_path)


def test_rejects_an_invalid_side(tmp_path):
    csv_path = write_csv(tmp_path, row(side="upside_down"))
    with pytest.raises(StudyDatasetError, match="side"):
        load_study_dataset(csv_path)


def test_rejects_a_duplicate_key(tmp_path):
    body = row(subject="s1", trial="t1") + row(subject="s1", trial="t1")
    csv_path = write_csv(tmp_path, body)
    with pytest.raises(StudyDatasetError, match="duplicate"):
        load_study_dataset(csv_path)


def test_an_included_row_needs_both_values(tmp_path):
    csv_path = write_csv(tmp_path, row(system="", excluded=""))
    with pytest.raises(StudyDatasetError, match="needs both system_value and reference_value"):
        load_study_dataset(csv_path)


def test_an_excluded_row_may_leave_values_blank(tmp_path):
    csv_path = write_csv(tmp_path, row(system="", reference="", excluded="pipeline_unsupported"))
    dataset = load_study_dataset(csv_path)
    r = dataset.rows[0]
    assert r.included is False
    assert r.system_value is None and r.reference_value is None
    assert r.excluded_reason == "pipeline_unsupported"


def test_rejects_a_non_finite_value(tmp_path):
    csv_path = write_csv(tmp_path, row(system="nan"))
    with pytest.raises(StudyDatasetError, match="finite"):
        load_study_dataset(csv_path)


def test_rejects_a_missing_required_column(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("subject_id,trial,metric_key\ns1,t1,static.trunk_inclination\n")
    with pytest.raises(StudyDatasetError, match="missing required column"):
        load_study_dataset(str(path))


def test_rejects_an_empty_dataset(tmp_path):
    path = tmp_path / "empty.csv"
    path.write_text(HEADER)
    with pytest.raises(StudyDatasetError, match="no data rows"):
        load_study_dataset(str(path))
