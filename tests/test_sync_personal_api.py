"""Parser tests for etl/sync_personal_api.py.

Fixtures are hand-trimmed from real responses in data/raw/api-test/ — only the
fields the parsers actually read are kept, so a schema regression here is a
real behaviour change.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from etl.sync_personal_api import (  # noqa: E402
    parse_activity, parse_daily, parse_sleep, parse_weight, parse_hrv,
)

FIX = Path(__file__).parent / "fixtures"


def _load(name):
    with open(FIX / name) as f:
        return json.load(f)


# ---- parse_activity --------------------------------------------------------

def test_parse_activity_uses_startTimeLocal_not_gmt():
    # startTimeLocal '2026-11-15 00:15' vs startTimeGMT '2026-11-14 23:15' —
    # a late-evening run must stay on the local day.
    row = parse_activity(_load("api_activities.json")[0])
    assert row["activity_date"] == "2026-11-15"


def test_parse_activity_coerces_float_integer_fields():
    row = parse_activity(_load("api_activities.json")[0])
    assert row["avg_hr"] == 176
    assert isinstance(row["avg_hr"], int)
    assert row["max_hr"] == 191
    assert row["calories"] == 800


def test_parse_activity_drops_multisport_parent():
    assert parse_activity(_load("api_activities.json")[1]) is None


def test_parse_activity_drops_transition_v2_leg():
    assert parse_activity(_load("api_activities.json")[2]) is None


def test_parse_activity_keeps_individual_leg_sports():
    row = parse_activity(_load("api_activities.json")[3])
    assert row is not None
    assert row["activity_type"] == "cycling"


# ---- parse_daily -----------------------------------------------------------

def test_parse_daily_floors_stored_as_count():
    # API's floorsAscended is a count; the parser must NOT convert from meters.
    row = parse_daily(_load("api_daily.json"))
    assert row["floors_ascended"] == 10.0
    assert row["total_steps"] == 8432
    assert isinstance(row["total_steps"], int)


# ---- parse_sleep -----------------------------------------------------------

def test_parse_sleep_score_from_nested_overall():
    row = parse_sleep(_load("api_sleep.json"))
    assert row["sleep_score"] == 82
    assert row["total_sleep_s"] == 30000


# ---- parse_weight ----------------------------------------------------------

def test_parse_weight_index_scale_converts_grams_to_kg():
    r = parse_weight(_load("api_weight.json")[0])
    assert r["weight_kg"] == 80.1          # 80099 g
    assert r["muscle_mass_kg"] == 62.0     # 62000 g
    assert r["bone_mass_kg"] == 3.2        # 3200 g


def test_parse_weight_measured_date_is_europe_paris_local():
    # timestampGMT 2026-11-15 23:25 UTC → Europe/Paris 2026-11-16 00:25
    r = parse_weight(_load("api_weight.json")[0])
    assert r["measured_date"] == "2026-11-16"


def test_parse_weight_manual_entry_dropped():
    assert parse_weight(_load("api_weight.json")[1]) is None


# ---- parse_hrv -------------------------------------------------------------

def test_parse_hrv_baseline_low_from_balancedLow_not_lowUpper():
    # baseline.lowUpper (50) is the TOP of the LOW band — using it as
    # baseline_low would be off by 5 bpm. Parser must use balancedLow (55).
    row = parse_hrv(_load("api_hrv.json")["hrvSummaries"][0])
    assert row["baseline_low"] == 55
    assert row["baseline_high"] == 75
    assert row["status"] == "BALANCED"
