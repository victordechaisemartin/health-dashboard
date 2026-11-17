import { ACTIVITY_BUCKETS, BUCKET_META } from "../lib/metrics";
import { logout, type SyncRun } from "../lib/data";

export type NavItem = { path: string; label: string; icon: string; color?: string };

const STALE_HOURS = 36;

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = diffMs / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function SyncBadge({ lastSync }: { lastSync: SyncRun | null }) {
  if (!lastSync) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        No sync yet
      </span>
    );
  }
  const ageH = (Date.now() - new Date(lastSync.run_at).getTime()) / 3_600_000;
  const warn = lastSync.status !== "ok" || ageH > STALE_HOURS;
  const wrap = warn
    ? "bg-amber-500/15 text-amber-300"
    : "bg-emerald-500/15 text-emerald-300";
  const dot = warn ? "bg-amber-400" : "bg-emerald-400";
  const label = lastSync.status === "ok" ? "ok" : "failed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${wrap}`}
      title={lastSync.error || undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      Last sync {relTime(lastSync.run_at)} · {label}
    </span>
  );
}

export const NAV_SECTIONS: { heading?: string; items: NavItem[] }[] = [
  { items: [
    { path: "/", label: "Overview", icon: "📊" },
    { path: "/health", label: "Health", icon: "❤️", color: "#6ee7b7" },
    { path: "/body", label: "Body Comp", icon: "🧬", color: "#38bdf8" },
    { path: "/bloods", label: "Bloods", icon: "🩸", color: "#f472b6" },
  ] },
  {
    heading: "Activities",
    items: [
      ...ACTIVITY_BUCKETS.map((b) =>
        b === "walking"
          ? { path: "/activity/walking", label: "Steps", icon: "👟", color: BUCKET_META.walking.color }
          : { path: `/activity/${b}`, label: BUCKET_META[b].label, icon: BUCKET_META[b].icon, color: BUCKET_META[b].color }
      ),
      { path: "/sleep", label: "Sleep", icon: BUCKET_META.sleep.icon, color: BUCKET_META.sleep.color },
    ],
  },
  { heading: "Recovery", items: [
    { path: "/recovery", label: "Recovery", icon: "🌙", color: "#38bdf8" },
    { path: "/load", label: "Load", icon: "⚡", color: "#fbbf24" },
  ] },
  { heading: "Plan", items: [
    { path: "/race", label: "Race Plan", icon: "🏁", color: "#fbbf24" },
    { path: "/plan", label: "Training Plan", icon: "🎯", color: "#34d399" },
  ] },
];

function isActive(current: string, path: string) {
  if (path === "/") return current === "/" || current === "/overview";
  return current === path;
}

export default function Nav({ route, go, lastSync }: {
  route: string; go: (p: string) => void; lastSync: SyncRun | null;
}) {
  return (
    <>
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-slate-800 bg-slate-950/60 px-3 py-5 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/15 text-lg">⌚</span>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold text-white">Garmin</div>
            <div className="text-[10px] text-slate-500">Health &amp; Fitness</div>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto">
          {NAV_SECTIONS.map((sec, i) => (
            <div key={i}>
              {sec.heading && <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{sec.heading}</div>}
              <div className="space-y-0.5">
                {sec.items.map((it) => (
                  <button
                    key={it.path}
                    onClick={() => go(it.path)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive(route, it.path) ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                    }`}
                  >
                    <span className="text-base" style={isActive(route, it.path) && it.color ? { filter: "saturate(1.4)" } : undefined}>{it.icon}</span>
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-4 space-y-2 px-3">
          <SyncBadge lastSync={lastSync} />
          <button
            onClick={async () => { await logout(); window.location.reload(); }}
            className="w-full rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/85 backdrop-blur md:hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {NAV_SECTIONS.flatMap((s) => s.items).map((it) => (
              <button
                key={it.path}
                onClick={() => go(it.path)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  isActive(route, it.path) ? "bg-slate-800 text-white" : "bg-slate-900/60 text-slate-400"
                }`}
              >
                <span>{it.icon}</span>{it.label}
              </button>
            ))}
          </div>
          <div className="shrink-0">
            <SyncBadge lastSync={lastSync} />
          </div>
        </div>
      </div>
    </>
  );
}
