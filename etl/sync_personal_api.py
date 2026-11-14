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
    status, body, ctype = http("POST", TOKEN_URL, headers={"Authorization": f"ApiKey {api_key}"})
    if not (200 <= status < 300):
        snippet = body[:200].decode(errors="replace").strip()
        fail(f"token exchange HTTP {status}: {snippet}")
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
        fail("empty token response")
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
        "baseline_low": _ni(bl.get("lowUpper")),
        "baseline_high": _ni(bl.get("balancedUpper")),
        "status": h.get("status"),
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
                    fail(f"{table}: HTTP {r.status}")
        except urllib.error.HTTPError as e:
            fail(f"{table}: HTTP {e.code} {e.read()[:300].decode(errors='replace')}")
        sent += len(chunk)
    return sent


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

    print("Exchanging API key for access token...")
    token = exchange_token(key)
    print(f"  token acquired (length={len(token)})")

    # Activities — pagination by start/limit. Pull enough to cover the window
    # then filter locally by activity_date ∈ [start, today].
    print("Fetching activities...")
    acts_raw = []
    want = max(50, args.days * 5)   # heuristic: ~5 activities/day safety margin
    status, batch = api_get(token, "/activitylist-service/activities/search/activities",
                            params={"start": 0, "limit": min(99, want),
                                    "sortBy": "startLocal", "sortOrder": "desc"})
    if status >= 300 or not isinstance(batch, list):
        fail(f"activity list HTTP {status}")
    acts_raw = batch
    activities = []
    skipped = 0
    for a in acts_raw:
        local_iso = a.get("startTimeLocal") or ""
        d = local_iso[:10]
        if d < y_start or d > y_end:
            continue
        row = parse_activity(a)
        if row is None:
            skipped += 1
            continue
        activities.append(row)
    print(f"  activities: fetched={len(acts_raw)} in_window={len(activities)+skipped} kept={len(activities)} skipped_parent_or_transition={skipped}")

    # Daily summaries — one call per calendar date
    print("Fetching daily summaries...")
    daily_rows = []
    for i in range(args.days):
        d = (start + timedelta(days=i)).isoformat()
        status, obj = api_get(token, "/usersummary-service/usersummary/daily",
                              params={"calendarDate": d})
        if status >= 300:
            print(f"  daily {d}: HTTP {status}, skipping")
            continue
        row = parse_daily(obj)
        if row:
            daily_rows.append(row)
    print(f"  daily: kept={len(daily_rows)}")

    # Sleep (range call)
    print("Fetching sleep...")
    status, obj = api_get(token, "/sleep-service/sleep/dailySleepSummariesByDate",
                         params={"startDate": y_start, "endDate": y_end})
    sleep_rows = []
    if status >= 300:
        print(f"  sleep: HTTP {status}, skipping")
    elif isinstance(obj, list):
        for s in obj:
            row = parse_sleep(s)
            if row: sleep_rows.append(row)
    print(f"  sleep: kept={len(sleep_rows)}")

    # HRV (range call, nested under hrvSummaries)
    print("Fetching HRV...")
    status, obj = api_get(token, f"/hrv-service/hrv/daily/{y_start}/{y_end}")
    hrv_rows = []
    if status == 204 or obj is None:
        pass
    elif status >= 300:
        print(f"  hrv: HTTP {status}, skipping")
    else:
        for h in (obj.get("hrvSummaries") if isinstance(obj, dict) else None) or []:
            row = parse_hrv(h)
            if row: hrv_rows.append(row)
    print(f"  hrv: kept={len(hrv_rows)}")

    if args.dry_run:
        print("\nDry run — no upsert.")
        return

    print("\nUpserting to Supabase...")
    counts = [
        ("garmin_activities",     activities, "activity_id"),
        ("garmin_daily_summary",  daily_rows, "summary_date"),
        ("garmin_sleep",          sleep_rows, "sleep_date"),
        ("garmin_hrv",            hrv_rows,   "hrv_date"),
    ]
    for table, rows, conflict in counts:
        n = upsert(sb_url, sb_key, table, rows, conflict)
        print(f"  {table:24s} upserted={n}")

    print("\nDone.")


if __name__ == "__main__":
    main()
