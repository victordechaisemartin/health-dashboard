"""Parser tests for etl/load_export.py (GDPR bulk importer).

The parsers find their files by glob under a root dir, so the fixtures live in
tests/fixtures/gdpr/ with the real filename patterns (userBioMetrics,
summarizedActivities, sleepData, UDSFile_*).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from etl.load_export import (  # noqa: E402
    parse_weigh_ins, parse_activities, parse_sleep, parse_daily,
)

GDPR_ROOT = str(Path(__file__).parent / "fixtures" / "gdpr")


# ---- parse_weigh_ins -------------------------------------------------------

def test_parse_weigh_ins_filters_to_index_scale():
    rows = parse_weigh_ins(GDPR_ROOT)
    assert len(rows) == 1  # MANUAL dropped


def test_parse_weigh_ins_converts_grams_to_kg():
    r = parse_weigh_ins(GDPR_ROOT)[0]
    assert r["weight_kg"] == 80.1
    assert r["muscle_mass_kg"] == 62.0
    assert r["bone_mass_kg"] == 3.2


def test_parse_weigh_ins_measured_date_is_europe_paris_local():
    # timestampGMT 2026-11-15 23:25 UTC → Paris 2026-11-16 00:25.
    # Old code used ts[:10] (the GMT date), landing the reading on the previous day.
    r = parse_weigh_ins(GDPR_ROOT)[0]
    assert r["measured_date"] == "2026-11-16"


# ---- parse_activities ------------------------------------------------------

def test_parse_activities_distance_cm_to_m():
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    assert rows[100]["distance_m"] == 10222.51  # 1022251 cm → 10222.51 m


def test_parse_activities_elevation_cm_to_m():
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    assert rows[100]["elevation_gain_m"] == 50.51  # 5051 cm → 50.51 m


def test_parse_activities_calories_kj_to_kcal():
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    # 3348.8 kJ / 4.184 = 800.38... → round to 800 kcal
    assert rows[100]["calories"] == 800


def test_parse_activities_duration_ms_to_s():
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    assert rows[100]["duration_s"] == 3600


def test_parse_activities_activity_date_from_startTimeLocal_not_gmt():
    # startTimeGmt is 2026-11-14 23:00 UTC (date = 2026-11-14) and
    # startTimeLocal is wall-clock 2026-11-15 00:00 (date = 2026-11-15).
    # The local date must win.
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    assert rows[100]["activity_date"] == "2026-11-15"


def test_parse_activities_parent_and_transition_skipped():
    ids = {r["activity_id"] for r in parse_activities(GDPR_ROOT)}
    assert 100 in ids
    assert 101 not in ids   # multi_sport parent
    assert 102 not in ids   # transition_v2 leg


def test_parse_activities_coerces_float_integer_fields():
    rows = {r["activity_id"]: r for r in parse_activities(GDPR_ROOT)}
    assert rows[100]["avg_hr"] == 176
    assert isinstance(rows[100]["avg_hr"], int)
    assert rows[100]["max_hr"] == 191


# ---- parse_sleep -----------------------------------------------------------

def test_parse_sleep_total_sums_the_three_stage_seconds():
    rows = parse_sleep(GDPR_ROOT)
    assert len(rows) == 1
    # GDPR exports lack a total field, so parser sums deep + light + rem
    # (awake time excluded, by design).
    assert rows[0]["total_sleep_s"] == 5000 + 15000 + 7000


# ---- parse_daily -----------------------------------------------------------

def test_parse_daily_floors_meters_converted_to_count():
    rows = parse_daily(GDPR_ROOT)
    assert len(rows) == 1
    # 30.48 m / 3.048 m per floor = 10 floors
    assert rows[0]["floors_ascended"] == 10.0
