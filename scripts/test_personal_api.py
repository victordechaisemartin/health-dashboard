#!/usr/bin/env python3
"""
Scout script for Garmin's Personal API.

What it does:
  1. Loads GARMIN_PERSONAL_API_KEY from .env (never prints it).
  2. Exchanges the key for a short-lived access token at
     POST https://personal.connectapi.garmin.com/personalapitoken-service
          /personal-api/personal-api-key/token
     with header "Authorization: ApiKey <key>".
  3. Calls each endpoint that could feed the dashboard for the last 7 days
     and saves the raw JSON to data/raw/api-test/<name>.json.

What it does NOT do:
  - print the key or the access token
  - write anything to Supabase

Endpoints exercised (OpenAPI spec is embedded in the developer-portal JS
bundle at /component---src-pages-gc-developer-program-personal-swagger-docs-*):

  activities        /activitylist-service/activities/search/activities
                    ?start=0&limit=50&sortBy=startLocal&sortOrder=desc
  daily summary     /usersummary-service/v2/dailysummaries
                    ?startDate=Y&endDate=Y
  sleep             /sleep-service/sleep/dailySleepSummariesByDate
                    ?startDate=Y&endDate=Y
  weight            /weight-service/weight/all/{startDate}/{endDate}
  HRV               /hrv-service/hrv/daily/{fromDate}/{toDate}
  body battery      /wellness-service/wellness/bodyBattery/reports/daily
                    ?startDate=Y&endDate=Y
  stress            /usersummary-service/stats/stress/daily/{startDate}/{endDate}
  steps             /usersummary-service/stats/steps/daily/{startDate}/{endDate}
  daily HR          /wellness-service/wellness/dailyHeartRate?date=Y (today only)
  fitness age       /fitnessage-service/fitnessage/v2/{calendarDate} (today only)
  user profile      /userprofile-service/userprofile/settings

Dates are ISO YYYY-MM-DD, timestamps in responses are epoch ms (GMT) and the
summary DTOs document meters / seconds / kilocalories — matching Supabase.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

BASE = "https://personal.connectapi.garmin.com"
TOKEN_URL = f"{BASE}/personalapitoken-service/personal-api/personal-api-key/token"
OUT = "data/raw/api-test"


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            # Strip surrounding whitespace, then any matching pair of quotes.
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            os.environ.setdefault(k.strip(), v.strip())


def http(method, url, headers=None, body=None):
    """Return (status, body_bytes, content_type)."""
    req = urllib.request.Request(url, method=method, headers=headers or {},
                                 data=body.encode() if body else None)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "") if e.headers else ""


def exchange_token(api_key):
    status, body, ctype = http("POST", TOKEN_URL, headers={"Authorization": f"ApiKey {api_key}"})

    # Metadata only — never dump the body at 2xx, it may be the token itself.
    print(f"  HTTP {status}  Content-Type={ctype!r}  body_bytes={len(body)}")

    if not (200 <= status < 300):
        snippet = body[:300].decode(errors="replace").strip()
        print(f"  server said: {snippet}")
        if status in (401, 403):
            print("  hint: check GARMIN_PERSONAL_API_KEY in .env: no quotes, no spaces, full key")
        sys.exit(1)

    token = None
    # Try JSON first
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        # Show which recognised fields are present without exposing values.
        present = [k for k in ("access_token", "accessToken", "token") if k in payload]
        extras = sorted(k for k in payload.keys() if k not in present)
        print(f"  json fields present: {present or 'NONE of (access_token, accessToken, token)'}")
        if extras:
            print(f"  other fields: {extras}")
        for k in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(k), str) and payload[k]:
                token = payload[k]
                break
    else:
        # Not JSON — some OAuth-ish endpoints return the raw token as text/plain.
        raw = body.decode(errors="replace").strip()
        # Strip surrounding quotes if the server returned a JSON-ish scalar
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
            raw = raw[1:-1]
        if raw:
            token = raw

    if not token:
        print("  could not find a token in the response")
        sys.exit(1)

    # Never log the token itself — only length + first 4 chars so you can tell
    # two different tokens apart without leaking the value.
    print(f"  token: acquired, length={len(token)}, starts_with={token[:4]!r}")
    return token


def call(name, token, path, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        status, body, _ctype = http("GET", url, headers={"Authorization": f"Bearer {token}"})
    except Exception as e:
        print(f"  {name:18s} ERROR  {type(e).__name__}: {e}")
        return None, None
    size = len(body)
    try:
        parsed = json.loads(body) if body else None
    except ValueError:
        parsed = None
    n = len(parsed) if isinstance(parsed, list) else (1 if isinstance(parsed, dict) else 0)
    print(f"  {name:18s} HTTP {status}  {size:>7d} B  rows~{n}")
    if 200 <= status < 300:
        os.makedirs(OUT, exist_ok=True)
        out_path = os.path.join(OUT, f"{name}.json")
        if parsed is not None:
            open(out_path, "w").write(json.dumps(parsed, indent=2))
        else:
            open(out_path, "wb").write(body)
    return status, parsed


def iso_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {s!r}")


def main():
    ap = argparse.ArgumentParser(description="Garmin Personal API scout")
    ap.add_argument("--start", type=iso_date, help="window start date (YYYY-MM-DD); defaults to 7 days before --end")
    ap.add_argument("--end", type=iso_date, help="window end date (YYYY-MM-DD); defaults to today")
    ap.add_argument("--activity-id", type=int, help="optional activity ID to probe via /activity-service/activity/{id}")
    args = ap.parse_args()

    load_dotenv()
    key = os.environ.get("GARMIN_PERSONAL_API_KEY")
    if not key:
        print("GARMIN_PERSONAL_API_KEY missing from env/.env")
        sys.exit(1)

    end = args.end or date.today()
    start = args.start or (end - timedelta(days=7))
    if start > end:
        print(f"--start {start} is after --end {end}")
        sys.exit(1)
    y7, y0 = start.isoformat(), end.isoformat()
    print(f"window: {y7} -> {y0}")

    print("Exchanging API key for access token...")
    token = exchange_token(key)

    print("Calling endpoints...")
    call("user_profile",     token, "/userprofile-service/userprofile/settings")
    call("activities",       token, "/activitylist-service/activities/search/activities",
         params={"start": 0, "limit": 50, "sortBy": "startLocal", "sortOrder": "desc"})
    # Multisport probe: do the legs come through when we ask Garmin NOT to exclude children?
    call("activities_with_children", token, "/activitylist-service/activities/search/activities",
         params={"start": 0, "limit": 50, "sortBy": "startLocal", "sortOrder": "desc",
                 "excludeChildren": "false"})
    if args.activity_id:
        call("activity_detail", token, f"/activity-service/activity/{args.activity_id}")
    call("daily_summaries",  token, "/usersummary-service/v2/dailysummaries",
         params={"startDate": y7, "endDate": y0})
    call("usersummary_today", token, "/usersummary-service/usersummary/daily",
         params={"calendarDate": y0})
    call("sleep",            token, "/sleep-service/sleep/dailySleepSummariesByDate",
         params={"startDate": y7, "endDate": y0})
    call("weight",           token, f"/weight-service/weight/all/{y7}/{y0}")
    call("hrv",              token, f"/hrv-service/hrv/daily/{y7}/{y0}")
    call("body_battery",     token, "/wellness-service/wellness/bodyBattery/reports/daily",
         params={"startDate": y7, "endDate": y0})
    call("stress",           token, f"/usersummary-service/stats/stress/daily/{y7}/{y0}")
    call("steps",            token, f"/usersummary-service/stats/steps/daily/{y7}/{y0}")
    call("daily_hr_today",   token, "/wellness-service/wellness/dailyHeartRate",
         params={"date": y0})
    call("fitness_age_today", token, f"/fitnessage-service/fitnessage/v2/{y0}")

    print(f"\nRaw JSON saved under {OUT}/")


if __name__ == "__main__":
    main()
