-- Garmin dashboard tables. Paste this whole file into your Supabase project's
-- SQL editor once. ADDITIVE ONLY: every object is garmin_-prefixed and
-- IF NOT EXISTS, so nothing here drops or alters your existing tables.
--
-- The ETL in etl/load_export.py writes to these tables; the dashboard reads
-- them server-side with GARMIN_SUPABASE_SECRET_KEY. No anon/authenticated
-- role can read anything here (see the revokes at the bottom).
--
-- Units are normalised by the ETL (grams->kg, ms->seconds) so columns are
-- already human-readable.

-- ===========================================================================
-- BODY COMPOSITION  (Garmin Index S2 scale, sourceType = INDEX_SCALE)
-- ===========================================================================
create table if not exists garmin_weigh_ins (
    measured_at      timestamptz primary key,
    measured_date    date not null,
    weight_kg        numeric(5,2) not null,
    bmi              numeric(4,1),
    body_fat_pct     numeric(4,1),
    body_water_pct   numeric(4,1),
    muscle_mass_kg   numeric(5,2),
    bone_mass_kg     numeric(4,2),
    raw_impedance    integer,
    source           text default 'INDEX_SCALE',
    created_at       timestamptz default now()
);
create index if not exists idx_garmin_weigh_ins_date on garmin_weigh_ins (measured_date desc);

-- ===========================================================================
-- ACTIVITIES (workouts)
-- ===========================================================================
create table if not exists garmin_activities (
    activity_id        bigint primary key,
    activity_date      date not null,
    started_at         timestamptz,
    activity_type      text,
    name               text,
    duration_s         integer,
    distance_m         numeric(10,2),
    avg_hr             integer,
    max_hr             integer,
    calories           integer,
    elevation_gain_m   numeric(8,2),
    aerobic_te         numeric(3,1),
    anaerobic_te       numeric(3,1),
    training_load      numeric(8,2),
    moderate_min       integer,
    vigorous_min       integer,
    created_at         timestamptz default now()
);
create index if not exists idx_garmin_activities_date on garmin_activities (activity_date desc);

-- ===========================================================================
-- SLEEP
-- ===========================================================================
create table if not exists garmin_sleep (
    sleep_date         date primary key,
    started_at         timestamptz,
    ended_at           timestamptz,
    total_sleep_s      integer,
    deep_s             integer,
    light_s            integer,
    rem_s              integer,
    awake_s            integer,
    sleep_score        integer,
    avg_respiration    numeric(4,1),
    avg_stress         integer,
    created_at         timestamptz default now()
);
create index if not exists idx_garmin_sleep_date on garmin_sleep (sleep_date desc);

-- ===========================================================================
-- DAILY SUMMARY (steps / calories / resting HR / intensity)
-- ===========================================================================
create table if not exists garmin_daily_summary (
    summary_date       date primary key,
    total_steps        integer,
    step_goal          integer,
    distance_m         numeric(10,2),
    total_calories     integer,
    active_calories    integer,
    resting_hr         integer,
    min_hr             integer,
    max_hr             integer,
    moderate_min       integer,
    vigorous_min       integer,
    floors_ascended    numeric(8,2),
    created_at         timestamptz default now()
);
create index if not exists idx_garmin_daily_summary_date on garmin_daily_summary (summary_date desc);

-- ===========================================================================
-- ROW LEVEL SECURITY. No policies are created: only the server-side secret
-- key (which bypasses RLS) may read these tables. The revokes at the bottom
-- make this explicit against anon / authenticated.
-- ===========================================================================
alter table garmin_weigh_ins      enable row level security;
alter table garmin_activities     enable row level security;
alter table garmin_sleep          enable row level security;
alter table garmin_daily_summary  enable row level security;

-- ===========================================================================
-- DEXA SCANS (optional) — reference body-composition scans the Body Comp page
-- pairs against the Index scale to measure the scale's bias. Add rows by hand.
-- ===========================================================================
create table if not exists dexa_scans (
    scan_date                date primary key,
    provider                 text,
    weight_kg                numeric(5,2),
    body_fat_pct             numeric(4,1),
    fat_mass_kg              numeric(5,2),
    lean_mass_kg             numeric(5,2),
    fat_free_mass_kg         numeric(5,2),
    bone_mineral_content_kg  numeric(4,2),
    bmi                      numeric(4,1),
    asm_kg                   numeric(5,2),
    asm_height2              numeric(5,2),
    bmd_total                numeric(5,3),
    t_score                  numeric(4,1),
    z_score                  numeric(4,1),
    vat_area_cm2             numeric(6,1),
    vat_mass_g               integer,
    sat_mass_g               integer,
    ag_ratio                 numeric(4,2),
    regional                 jsonb,
    notes                    text,
    created_at               timestamptz default now()
);
alter table dexa_scans enable row level security;
-- No anon policy on purpose: the dashboard reads it through /api/data with the
-- secret key. Blood panels live in sql/blood_panels.sql, same rule.

-- ===========================================================================
-- HRV (Garmin Personal API — /hrv-service/hrv/daily/{from}/{to}).
-- One row per calendar date. Baseline is the band Garmin derived from the
-- user's own history; status is the categorical label (BALANCED, UNBALANCED,
-- LOW, POOR, NO_STATUS).
-- ===========================================================================
create table if not exists garmin_hrv (
    hrv_date             date primary key,
    last_night_avg       integer,
    last_night_5min_high integer,
    weekly_avg           integer,
    baseline_low         integer,
    baseline_high        integer,
    status               text,
    created_at           timestamptz default now()
);
create index if not exists idx_garmin_hrv_date on garmin_hrv (hrv_date desc);
alter table garmin_hrv enable row level security;

-- ===========================================================================
-- Revoke all grants from anon + authenticated. RLS plus these revokes mean
-- only the secret key (which bypasses both) can read anything.
-- ===========================================================================
revoke all on garmin_weigh_ins     from anon, authenticated;
revoke all on garmin_activities    from anon, authenticated;
revoke all on garmin_sleep         from anon, authenticated;
revoke all on garmin_daily_summary from anon, authenticated;
revoke all on garmin_hrv           from anon, authenticated;
revoke all on dexa_scans           from anon, authenticated;
