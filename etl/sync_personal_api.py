#!/usr/bin/env python3
"""
Daily Garmin → Supabase sync via the Personal API.

Reads GARMIN_PERSONAL_API_KEY, exchanges it for a short-lived JWT, pulls the
last --days days of data, maps it to the existing Supabase tables, and upserts.

Units from the Personal API are already SI / human-readable (meters, seconds,
kilocalories) — do NOT reuse the GDPR export's centimetre / kilojoule
conversions.

Env (from .env or environment):
  GARMIN_PERSONAL_API_KEY       the Personal API key issued at
                                https://connect.garmin.com/app/settings/personalApiToken
  GARMIN_SUPABASE_URL           https://<ref>.supabase.co
  GARMIN_SUPABASE_SECRET_KEY    sb_secret_... server-side key

Flags:
  --days N      how many days back from today (default 3)
  --dry-run     fetch + map but do not upsert

Never prints the API key, the access token or raw health data.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Garmin's weight-service returns timestampGMT in epoch ms; the scale's "calendar
# date" must be the LOCAL date, else a post-midnight weigh-in lands on the
# previous day.
LOCAL_TZ = ZoneInfo("Europe/Paris")

API = "https://personal.connectapi.garmin.com"
TOKEN_URL = f"{API}/personalapitoken-service/personal-api/personal-api-key/token"


# ---- env / http helpers ---------------------------------------------------
def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            os.environ.setdefault(k.strip(), v.strip())


def http(method, url, headers=None, body=None):
    req = urllib.request.Request(url, method=method, headers=headers or {},
                                 data=body.encode() if body else None)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), (e.headers.get("Content-Type", "") if e.headers else "")


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# ---- auth ------------------------------------------------------------------
def exchange_token(api_key):
    # Raise RuntimeError rather than sys.exit so main() can record the failure
    # in garmin_sync_runs before the process dies.
    status, body, ctype = http("POST", TOKEN_URL, headers={"Authorization": f"ApiKey {api_key}"})
    if not (200 <= status < 300):
        snippet = body[:200].decode(errors="replace").strip()
        raise RuntimeError(f"token exchange HTTP {status}: {snippet}")
    # Personal API returns a raw JWT as text/plain.
    if "json" in (ctype or "").lower():
        try:
            d = json.loads(body)
            tok = d.get("access_token") or d.get("accessToken") or d.get("token")
            if tok: return tok
        except ValueError:
            pass
    raw = body.decode(errors="replace").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
        raw = raw[1:-1]
    if not raw:
        raise RuntimeError("empty token response")
    return raw


# ---- Garmin API calls ------------------------------------------------------
def api_get(token, path, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    status, body, _ = http("GET", url, headers={"Authorization": f"Bearer {token}"})
    if status == 204 or not body:
        return status, None
    if not (200 <= status < 300):
        return status, {"_error_snippet": body[:200].decode(errors="replace").strip()}
    try:
        return status, json.loads(body)
    except ValueError:
        return status, None


# ---- parsers (API shape → Supabase row) ------------------------------------
def _iso_from_space(dt_str):
    """Garmin's startTimeLocal / startTimeGMT come as 'YYYY-MM-DD HH:MM:SS'.
    Return ISO 8601 (treating GMT ones as UTC)."""
    if not isinstance(dt_str, str) or len(dt_str) < 19:
        return None
    try:
        dt = datetime.strptime(dt_str[:19], "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _ni(v):
    return int(round(v)) if isinstance(v, (int, float)) else None


def _rnd(v, n=1):
    return round(v, n) if isinstance(v, (int, float)) else None


def _g_to_kg(v):
    return round(v / 1000.0, 2) if isinstance(v, (int, float)) else None


def parse_activity(a):
    """Map one activity from /activitylist-service into a garmin_activities row.
    Skips multisport parents (parent==True) and transition legs. Returns None to skip."""
    atype = (a.get("activityType") or {}).get("typeKey")
    # The list endpoint can return multi_sport parents even with excludeChildren=true
    # (the parent IS included; only its legs are excluded). Drop them to avoid
    # double-counting against the separate swim/bike/run rows the dashboard already has.
    if a.get("parent") is True or atype in ("multi_sport", "transition_v2"):
        return None
    local_iso = a.get("startTimeLocal")
    activity_date = local_iso[:10] if isinstance(local_iso, str) and len(local_iso) >= 10 else None
    if not activity_date:
        return None
    # Units: distance=meters, duration=seconds, elevationGain=meters, calories=kcal — no conversion.
    return {
        "activity_id": a.get("activityId"),
        "activity_date": activity_date,
        "started_at": _iso_from_space(a.get("startTimeGMT")),
        "activity_type": atype,
        "name": a.get("activityName"),
        "duration_s": _ni(a.get("duration")),
        "distance_m": _rnd(a.get("distance"), 2),
        "avg_hr": _ni(a.get("averageHR")),
        "max_hr": _ni(a.get("maxHR")),
        "calories": _ni(a.get("calories")),
        "elevation_gain_m": _rnd(a.get("elevationGain"), 2),
        "aerobic_te": _rnd(a.get("aerobicTrainingEffect")),
        "anaerobic_te": _rnd(a.get("anaerobicTrainingEffect")),
        "training_load": _rnd(a.get("activityTrainingLoad"), 2),
        "moderate_min": _ni(a.get("moderateIntensityMinutes")),
        "vigorous_min": _ni(a.get("vigorousIntensityMinutes")),
    }


def parse_daily(u):
    """Map /usersummary-service/usersummary/daily payload into garmin_daily_summary."""
    if not isinstance(u, dict) or not u.get("calendarDate"):
        return None
    return {
        "summary_date": u["calendarDate"],
        "total_steps": _ni(u.get("totalSteps")),
        "step_goal": _ni(u.get("dailyStepGoal")),
        "distance_m": _rnd(u.get("totalDistanceMeters"), 2),
        "total_calories": _ni(u.get("totalKilocalories")),
        "active_calories": _ni(u.get("activeKilocalories")),
        "resting_hr": _ni(u.get("restingHeartRate")),
        "min_hr": _ni(u.get("minHeartRate")),
        "max_hr": _ni(u.get("maxHeartRate")),
        "moderate_min": _ni(u.get("moderateIntensityMinutes")),
        "vigorous_min": _ni(u.get("vigorousIntensityMinutes")),
        # Garmin reports floorsAscended as a count; floorsAscendedInMeters is the metric distance.
        # The column was always count+fractional in the GDPR loader (floors_ascended as numeric(8,2)),
        # so keep that meaning — use the count.
        "floors_ascended": _rnd(u.get("floorsAscended"), 2),
    }


def _ms_to_iso(ms):
    if not isinstance(ms, (int, float)) or ms == 0:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def parse_sleep(s):
    if not isinstance(s, dict) or not s.get("calendarDate"):
        return None
    scores = s.get("sleepScores") or {}
    overall = scores.get("overall") if isinstance(scores, dict) else None
    score = overall.get("value") if isinstance(overall, dict) else None
    return {
        "sleep_date": s["calendarDate"],
        "started_at": _ms_to_iso(s.get("sleepStartTimestampGMT")),
        "ended_at": _ms_to_iso(s.get("sleepEndTimestampGMT")),
        "total_sleep_s": _ni(s.get("sleepTimeSeconds")),
        "deep_s": _ni(s.get("deepSleepSeconds")),
        "light_s": _ni(s.get("lightSleepSeconds")),
        "rem_s": _ni(s.get("remSleepSeconds")),
        "awake_s": _ni(s.get("awakeSleepSeconds")),
        "sleep_score": _ni(score),
        "avg_respiration": _rnd(s.get("averageRespirationValue")),
        "avg_stress": _ni(s.get("avgSleepStress")),
    }


def parse_hrv(h):
    if not isinstance(h, dict) or not h.get("calendarDate"):
        return None
    bl = h.get("baseline") or {}
    return {
        "hrv_date": h["calendarDate"],
        "last_night_avg": _ni(h.get("lastNightAvg")),
        "last_night_5min_high": _ni(h.get("lastNight5MinHigh")),
        "weekly_avg": _ni(h.get("weeklyAvg")),
        # baseline.lowUpper is the UPPER bound of the "low" band (i.e. a
        # threshold inside the baseline, not the lower edge of the balanced
        # band). The balanced band itself is [balancedLow, balancedUpper].
        "baseline_low": _ni(bl.get("balancedLow")),
        "baseline_high": _ni(bl.get("balancedUpper")),
        "status": h.get("status"),
    }


def parse_weight(w):
    """Map one /weight-service/weight/all entry to a garmin_weigh_ins row.

    Shape confirmed from scripts/test_personal_api.py (data/raw/api-test/weight.json):
      timestampGMT / date  epoch ms (NOT the GDPR string form)
      weight               grams  — e.g. 80099 for 80.099 kg
      muscleMass, boneMass grams  (same convention as the GDPR export)
      bmi, bodyFat, bodyWater  dimensionless / percent
    Keeps only Index S2 scale readings, matching parse_weigh_ins() in
    etl/load_export.py (manual entries lack sourceType and fall through)."""
    if not isinstance(w, dict) or w.get("sourceType") != "INDEX_SCALE":
        return None
    ts_ms = w.get("timestampGMT") or w.get("date")
    if not isinstance(ts_ms, (int, float)) or ts_ms == 0:
        return None
    weight_kg = _g_to_kg(w.get("weight"))
    if weight_kg is None:
        return None
    dt_utc = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    return {
        "measured_at": dt_utc.isoformat(),
        "measured_date": dt_utc.astimezone(LOCAL_TZ).date().isoformat(),
        "weight_kg": weight_kg,
        "bmi": _rnd(w.get("bmi"), 1),
        "body_fat_pct": _rnd(w.get("bodyFat"), 1),
        "body_water_pct": _rnd(w.get("bodyWater"), 1),
        "muscle_mass_kg": _g_to_kg(w.get("muscleMass")),
        "bone_mass_kg": _g_to_kg(w.get("boneMass")),
        "raw_impedance": _ni(w.get("rawImpedance")),
    }


# ---- Supabase upsert -------------------------------------------------------
def upsert(url, key, table, rows, conflict):
    if not rows:
        return 0
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={conflict}"
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    sent = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        req = urllib.request.Request(endpoint, method="POST",
                                     headers=headers, data=json.dumps(chunk).encode())
        try:
            with urllib.request.urlopen(req) as r:
                if r.status >= 300:
                    raise RuntimeError(f"{table}: HTTP {r.status}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{table}: HTTP {e.code} {e.read()[:300].decode(errors='replace')}")
        sent += len(chunk)
    return sent


def sb_insert(url, key, table, row):
    """Plain INSERT (no on_conflict). garmin_sync_runs uses an identity PK so
    every run writes a fresh row."""
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    req = urllib.request.Request(endpoint, method="POST",
                                 headers=headers, data=json.dumps([row]).encode())
    try:
        with urllib.request.urlopen(req) as r:
            if r.status >= 300:
                raise RuntimeError(f"{table}: HTTP {r.status}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{table}: HTTP {e.code} {e.read()[:300].decode(errors='replace')}")


# Hitting this means the window is wider than our page-budget can cover; the
# user should rerun with a smaller --days instead of silently truncating.
MAX_ACTIVITY_PAGES = 40


# ---- main ------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Daily Garmin → Supabase sync")
    ap.add_argument("--days", type=int, default=3, help="how many days back from today (default 3)")
    ap.add_argument("--dry-run", action="store_true", help="fetch + map, no upsert")
    args = ap.parse_args()
    if args.days < 1:
        fail("--days must be >= 1")

    load_dotenv()
    key = os.environ.get("GARMIN_PERSONAL_API_KEY")
    sb_url = os.environ.get("GARMIN_SUPABASE_URL")
    sb_key = os.environ.get("GARMIN_SUPABASE_SECRET_KEY")
    missing = [n for n, v in (("GARMIN_PERSONAL_API_KEY", key),
                              ("GARMIN_SUPABASE_URL", sb_url),
                              ("GARMIN_SUPABASE_SECRET_KEY", sb_key)) if not v]
    if not args.dry_run and missing:
        fail(f"missing env: {', '.join(missing)}")
    if args.dry_run and not key:
        fail("missing env: GARMIN_PERSONAL_API_KEY")

    today = date.today()
    start = today - timedelta(days=args.days - 1)
    y_start, y_end = start.isoformat(), today.isoformat()
    print(f"window: {y_start} -> {y_end}  (days={args.days}, dry_run={args.dry_run})")

    errors = []   # (endpoint, detail) — populated per endpoint and by the outer except
    counts = {"activities": 0, "daily": 0, "sleep": 0, "weigh_ins": 0, "hrv": 0}

    # Wrap the whole sync body so a token-exchange RuntimeError, a URLError
    # (DNS / TLS), or any other exception still lands in garmin_sync_runs.
    try:
        print("Exchanging API key for access token...")
        token = exchange_token(key)
        print(f"  token acquired (length={len(token)})")

        # Activities — paginate /activitylist-service until a page is empty OR
        # its oldest activity (sorted startLocal desc) predates the window, with
        # a hard cap so a bad `oldest` comparator can't loop forever.
        # excludeChildren=false brings in multisport legs; parse_activity drops
        # the parent (parent==True) and transition_v2 so a tri day counts once
        # per sport.
        print("Fetching activities...")
        PAGE = 50
        acts_raw = []
        pages = 0
        start_idx = 0
        reached_window_edge = False
        while pages < MAX_ACTIVITY_PAGES:
            status, batch = api_get(token, "/activitylist-service/activities/search/activities",
                                    params={"start": start_idx, "limit": PAGE,
                                            "sortBy": "startLocal", "sortOrder": "desc",
                                            "excludeChildren": "false"})
            if status >= 300:
                errors.append(("activities", f"HTTP {status} at start={start_idx}"))
                break
            if not isinstance(batch, list) or not batch:
                reached_window_edge = True
                break
            acts_raw.extend(batch)
            pages += 1
            oldest = (batch[-1].get("startTimeLocal") or "")[:10]
            if oldest and oldest < y_start:
                reached_window_edge = True
                break
            start_idx += PAGE
        if not reached_window_edge and pages >= MAX_ACTIVITY_PAGES and not any(e[0] == "activities" for e in errors):
            errors.append(("activities", f"hit pagination cap of {MAX_ACTIVITY_PAGES} pages — rerun with a smaller --days"))
        activities = []
        skipped = 0
        for a in acts_raw:
            d = (a.get("startTimeLocal") or "")[:10]
            if d < y_start or d > y_end:
                continue
            row = parse_activity(a)
            if row is None:
                skipped += 1
                continue
            activities.append(row)
        counts["activities"] = len(activities)
        print(f"  activities: fetched={len(acts_raw)} pages={pages} kept={len(activities)} skipped_parent_or_transition={skipped}")

        # Daily summaries — one call per calendar date.
        print("Fetching daily summaries...")
        daily_rows = []
        for i in range(args.days):
            d = (start + timedelta(days=i)).isoformat()
            status, obj = api_get(token, "/usersummary-service/usersummary/daily",
                                  params={"calendarDate": d})
            # 3xx+ must be checked BEFORE the empty-body branch: a 4xx/5xx with
            # no response body would otherwise be silently treated as "no data".
            if status >= 300:
                errors.append(("daily", f"{d}: HTTP {status}"))
                continue
            if status == 204 or obj is None:
                continue
            row = parse_daily(obj)
            if row:
                daily_rows.append(row)
        counts["daily"] = len(daily_rows)
        print(f"  daily: kept={len(daily_rows)}")

        # Sleep (range call)
        print("Fetching sleep...")
        status, obj = api_get(token, "/sleep-service/sleep/dailySleepSummariesByDate",
                              params={"startDate": y_start, "endDate": y_end})
        sleep_rows = []
        if status >= 300:
            errors.append(("sleep", f"HTTP {status}"))
        elif status == 204 or obj is None:
            pass
        elif isinstance(obj, list):
            for s in obj:
                row = parse_sleep(s)
                if row: sleep_rows.append(row)
        counts["sleep"] = len(sleep_rows)
        print(f"  sleep: kept={len(sleep_rows)}")

        # Weigh-ins (range call) — INDEX_SCALE filter drops manual entries
        print("Fetching weigh-ins...")
        status, obj = api_get(token, f"/weight-service/weight/all/{y_start}/{y_end}")
        weigh_in_rows = []
        if status >= 300:
            errors.append(("weigh_ins", f"HTTP {status}"))
        elif status == 204 or obj is None:
            pass
        else:
            entries = obj if isinstance(obj, list) else (obj.get("weightEntries") or obj.get("dailyWeightSummaries") or [])
            for w in (entries if isinstance(entries, list) else []):
                row = parse_weight(w)
                if row: weigh_in_rows.append(row)
        counts["weigh_ins"] = len(weigh_in_rows)
        print(f"  weigh-ins: kept={len(weigh_in_rows)}")

        # HRV (range call, nested under hrvSummaries)
        print("Fetching HRV...")
        status, obj = api_get(token, f"/hrv-service/hrv/daily/{y_start}/{y_end}")
        hrv_rows = []
        if status >= 300:
            errors.append(("hrv", f"HTTP {status}"))
        elif status == 204 or obj is None:
            pass
        else:
            for h in (obj.get("hrvSummaries") if isinstance(obj, dict) else None) or []:
                row = parse_hrv(h)
                if row: hrv_rows.append(row)
        counts["hrv"] = len(hrv_rows)
        print(f"  hrv: kept={len(hrv_rows)}")

        if not args.dry_run:
            print("\nUpserting to Supabase...")
            tables = [
                ("garmin_activities",     activities,     "activity_id"),
                ("garmin_daily_summary",  daily_rows,     "summary_date"),
                ("garmin_sleep",          sleep_rows,     "sleep_date"),
                ("garmin_weigh_ins",      weigh_in_rows,  "measured_at"),
                ("garmin_hrv",            hrv_rows,       "hrv_date"),
            ]
            for table, rows, conflict in tables:
                try:
                    n = upsert(sb_url, sb_key, table, rows, conflict)
                    print(f"  {table:24s} upserted={n}")
                except RuntimeError as e:
                    # One table's HTTP failure must not take down the rest;
                    # record and keep going so the run row has full counts.
                    errors.append((table, str(e)))
    except Exception as e:
        errors.append(("fatal", f"{type(e).__name__}: {e}"))

    status_str = "failed" if errors else "ok"
    error_blob = "; ".join(f"{ep}: {detail}" for ep, detail in errors) or None

    # Dry runs touch no Supabase tables, including garmin_sync_runs.
    if not args.dry_run and sb_url and sb_key:
        run_row = {
            "run_at": datetime.now(tz=timezone.utc).isoformat(),
            "days": args.days,
            "status": status_str,
            "counts": counts,
            "error": error_blob,
        }
        try:
            sb_insert(sb_url, sb_key, "garmin_sync_runs", run_row)
        except Exception as e:
            print(f"  ! garmin_sync_runs insert failed: {e}", file=sys.stderr)

    if errors:
        for ep, detail in errors:
            print(f"  ! {ep}: {detail}", file=sys.stderr)
        print(f"\nFinished with {len(errors)} failure(s).")
        sys.exit(1)
    if args.dry_run:
        print("\nDry run — no upsert.")
    else:
        print("\nDone.")


if __name__ == "__main__":
    main()
