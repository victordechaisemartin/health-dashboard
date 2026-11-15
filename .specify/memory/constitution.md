<!--
SYNC IMPACT REPORT (remove before committing)
=============================================
Version change: 1.0.0 → 1.1.0
Modified principles:
  - III. Minimal Footprint: replaced TypeScript-only quality gate with
    vitest unit tests for src/lib/ pure functions + npm test command
Added principles:
  - VI. Never Invent a Number (NON-NEGOTIABLE)
  - VII. Local Time Is Truth
  - VIII. Explicit Coaching Rules
Modified sections:
  - Development Workflow: added npm test to quality gate commands
Removed sections: N/A
Follow-up TODOs: none
-->

# Health Dashboard Constitution

## Core Principles

### I. Privacy-First (NON-NEGOTIABLE)

Health data is personal and sensitive. The architecture MUST ensure no data ever
reaches the browser directly from Supabase. All reads go through server-side API
routes authenticated with the secret key. The anon/publishable key MUST NOT be
able to read any data (RLS enabled, grants revoked). Secrets MUST never carry a
`VITE_` prefix — anything so prefixed is inlined into the public bundle.

### II. Single-Source Data Flow

Data flows in one direction only:
`Supabase → api/_bundle.js → api/data.js → /api/data → src/lib/data.ts → Bundle`.
`App.tsx` loads the Bundle once at startup and passes it down via props. Pages
and components MUST NOT trigger additional fetches or maintain their own data
state. All transformations and type mappings happen in `src/lib/` before data
reaches a page.

### III. Minimal Footprint

The codebase MUST stay as small as the problem requires. Prefer raw `fetch` over
SDK libraries when the savings are a few lines. No sample/fallback data: a missing
config renders a setup screen, not fake data. Pure metric/KPI functions in
`src/lib/` MUST have unit tests (vitest is the one approved test dependency).
Components and API routes stay type-check only. Quality gate = `npx tsc --noEmit`
+ `npm test`. New dependencies require explicit justification; a few lines never
warrant a new package.

### IV. Shared Visual Language

Every Recharts chart MUST use `AXIS_TICK`, `TOOLTIP`, and `GRID` from `src/ui.tsx`.
Per-chart style overrides are not permitted unless they serve a data-accuracy
purpose (e.g. a secondary axis with a different scale). Visual consistency takes
precedence over per-page customisation.

### V. Typed Boundaries

Every Supabase row shape MUST have a TypeScript type in `src/lib/data.ts`.
API handlers return raw JSON; `loadData()` is the single point where that JSON
is validated and typed into `Bundle`. Pages receive a fully-typed `Bundle` and
MUST NOT re-derive or re-cast data downstream.

### VI. Never Invent a Number (NON-NEGOTIABLE)

Missing or insufficient data MUST render "–" accompanied by a one-line reason
(e.g. "no HRV last night – watch not worn?"). No interpolation, no placeholder
values, no silent fallbacks to older data presented as current. Displaying a stale
or derived number without attribution is a data integrity violation.

### VII. Local Time Is Truth

Every date, day, and week calculation MUST use local fields via `parseLocalDate`
/ `monthKey` — never `toISOString()`. Weeks run Monday 00:00 to Sunday 23:59
local time. "Today" is the real calendar date in Europe/Paris, not the newest
data point in the dataset.

### VIII. Explicit Coaching Rules

Every KPI MUST display: value, target, status (`ok` / `watch` / `act` / `n/a`),
and a plain-language rule the user can act on. All thresholds MUST live in
`src/lib/targets.ts`, each with a comment citing its source (`coaching-method.md`
or `"default"`). No threshold may be inlined in a component or page.

## Security Constraints

- `GARMIN_SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` live in server env only;
  never in client code or `VITE_`-prefixed vars.
- The password gate (`GH_PASSWORD` / `GH_SESSION_TOKEN`) is REQUIRED on Vercel.
  Deploying without it MUST fail or warn explicitly.
- All `/api/*` routes MUST check the session cookie before returning data.
- Supabase RLS MUST remain enabled; anon and authenticated roles MUST NOT have
  read grants on any health table.

## Development Workflow

- Local dev: `npm run dev` (Vite dev server at `http://localhost:5173`; `/api/*`
  handled by the same handler files via `vite.config.ts` shim — no Vercel CLI needed).
- Build: `npm run build` (tsc + vite).
- Quality gate: `npx tsc --noEmit` (type-check all code) + `npm test` (vitest unit
  tests for pure `src/lib/` functions). Both MUST pass before merge.
- ETL: `etl/sync_personal_api.py` for daily sync (also runs via GitHub Actions cron at
  05:15 UTC); `etl/load_export.py` for one-off GDPR bulk import.
- `data/raw/` and `data/*.json` are gitignored; never commit personal health data.

## Governance

This constitution supersedes all other practices documented in this repository.
When a practice described elsewhere conflicts with a principle here, the constitution wins.

**Amendment procedure:**
1. Identify the principle or section requiring change.
2. Draft the amended text and determine the version bump type (MAJOR/MINOR/PATCH per
   semantic versioning: MAJOR = principle removal or redefinition; MINOR = new principle
   or material expansion; PATCH = wording/typo/clarification).
3. Update `LAST_AMENDED_DATE` to today and increment `CONSTITUTION_VERSION`.
4. Include a Sync Impact Report comment at the top (remove before committing).

**Compliance review:** Every PR MUST be checked against these principles before merge.
When a shortcut is taken (e.g. a temporary direct Supabase call), it MUST be tagged
`shortcut: <limit>, <when to upgrade>` in the code and tracked until resolved.

**Version**: 1.1.0 | **Ratified**: 2026-11-15 | **Last Amended**: 2026-11-15
