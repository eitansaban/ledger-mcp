import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { ledgerDb, spendDb } from "@/lib/supabase";

export const maxDuration = 30;

// Per-agent staleness budgets: hours of silence before an agent is considered
// stale. Customize for your own scheduled jobs, or override at runtime by
// setting SILENCE_BUDGETS_JSON (a JSON object of { "agent-name": hours }).
// Agents not listed here simply report their last run without a stale verdict.
const DEFAULT_SILENCE_BUDGET_HOURS: Record<string, number> = {
  "hourly-job": 3,
  "daily-job": 30,
  "weekday-job": 84,
  "weekly-job": 192,
};

const SILENCE_BUDGET_HOURS: Record<string, number> = (() => {
  try {
    if (process.env.SILENCE_BUDGETS_JSON) {
      return JSON.parse(process.env.SILENCE_BUDGETS_JSON);
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SILENCE_BUDGET_HOURS;
})();

const WEEKLY_BUDGET_USD = Number(process.env.WEEKLY_BUDGET_USD) || 10;

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function mostRecentMondayUtc(): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const dow = d.getUTCDay(); // 0 = Sun
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const handler = createMcpHandler(
  (server) => {
    // ─── 1. What's being built ───────────────────────────────────────────
    server.registerTool(
      "whats_being_built",
      {
        title: "What's being built",
        description:
          "The projects currently being built across the workspace — an " +
          "auto-derived inventory (refreshed daily) with language, deploy, and " +
          "tooling flags. Use to answer 'what am I building right now?' or " +
          "'does something for this already exist?' before starting new work.",
        inputSchema: {
          include_archived: z
            .boolean()
            .optional()
            .describe("Include archived projects. Default false."),
        },
      },
      async ({ include_archived }) => {
        const { data, error } = await ledgerDb()
          .from("portfolio_snapshot")
          .select(
            "dir_name,language,last_modified_at,has_vercel,vercel_project_name,anthropic_sdk_present,spend_logging_wired,watchdog_registered,is_archived,notes,scanned_at"
          )
          .order("last_modified_at", { ascending: false });
        if (error) throw new Error(`portfolio_snapshot query failed: ${error.message}`);
        const rows = (data ?? []).filter((r) => include_archived || !r.is_archived);
        return text({
          project_count: rows.length,
          as_of: data?.[0]?.scanned_at ?? null,
          projects: rows.map((r) => ({
            project: r.dir_name,
            language: r.language,
            last_modified: r.last_modified_at?.slice(0, 10) ?? null,
            deployed: r.has_vercel ? r.vercel_project_name || true : false,
            uses_anthropic: r.anthropic_sdk_present,
            spend_logged: r.anthropic_sdk_present ? r.spend_logging_wired : null,
            watchdog: r.watchdog_registered,
            archived: r.is_archived,
            notes: r.notes || undefined,
          })),
        });
      }
    );

    // ─── 2. Agent ops health ─────────────────────────────────────────────
    server.registerTool(
      "agent_health",
      {
        title: "Agent fleet health",
        description:
          "Latest run status for every scheduled agent in the fleet, with a " +
          "staleness verdict against each agent's silence budget. Use to answer " +
          "'are my agents healthy / is anything stuck?'",
      },
      async () => {
        const { data, error } = await ledgerDb()
          .from("agent_health")
          .select("agent_name,run_at,status,duration_sec,spend_usd")
          .order("run_at", { ascending: false })
          .limit(1000);
        if (error) throw new Error(`agent_health query failed: ${error.message}`);

        const latest = new Map<string, (typeof data)[number]>();
        for (const row of data ?? []) {
          if (!latest.has(row.agent_name)) latest.set(row.agent_name, row);
        }

        const agents = [...latest.values()].map((r) => {
          const hrs = hoursAgo(r.run_at);
          const budget = SILENCE_BUDGET_HOURS[r.agent_name];
          const stale = budget !== undefined ? hrs > budget : null;
          return {
            agent: r.agent_name,
            last_run_at: r.run_at,
            hours_ago: Math.round(hrs * 10) / 10,
            last_status: r.status,
            silence_budget_hours: budget ?? null,
            stale,
          };
        });
        agents.sort((a, b) => (b.hours_ago ?? 0) - (a.hours_ago ?? 0));

        const stale = agents.filter((a) => a.stale === true);
        return text({
          summary: {
            agents_seen: agents.length,
            stale_count: stale.length,
            stale_agents: stale.map((a) => a.agent),
          },
          agents,
        });
      }
    );

    // ─── 3. Weekly spend ─────────────────────────────────────────────────
    server.registerTool(
      "weekly_spend",
      {
        title: "Weekly Anthropic spend",
        description:
          "Anthropic API spend for the current week (since Monday 00:00 UTC), " +
          `broken down by project, against the $${WEEKLY_BUDGET_USD}/wk budget. ` +
          "Also returns trailing-7-day total.",
      },
      async () => {
        const weekStart = mostRecentMondayUtc().toISOString();
        const sevenDaysAgo = new Date(
          Date.now() - 7 * 24 * 3_600_000
        ).toISOString();

        const { data, error } = await spendDb()
          .from("spend_log")
          .select("script_name,est_cost_usd,occurred_at")
          .gte("occurred_at", sevenDaysAgo)
          .order("occurred_at", { ascending: false });
        if (error) throw new Error(`spend_log query failed: ${error.message}`);

        const rows = data ?? [];
        let weekTotal = 0;
        let sevenDayTotal = 0;
        const byProject: Record<string, number> = {};
        for (const r of rows) {
          const cost = Number(r.est_cost_usd) || 0;
          sevenDayTotal += cost;
          if (r.occurred_at >= weekStart) {
            weekTotal += cost;
            const project = (r.script_name ?? "unknown").split(".")[0];
            byProject[project] = (byProject[project] ?? 0) + cost;
          }
        }
        const round = (n: number) => Math.round(n * 1e4) / 1e4;
        return text({
          week_start_utc: weekStart,
          week_to_date_usd: round(weekTotal),
          budget_usd: WEEKLY_BUDGET_USD,
          pct_of_budget: Math.round((weekTotal / WEEKLY_BUDGET_USD) * 100),
          over_budget: weekTotal > WEEKLY_BUDGET_USD,
          trailing_7d_usd: round(sevenDayTotal),
          week_by_project: Object.fromEntries(
            Object.entries(byProject)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => [k, round(v)])
          ),
        });
      }
    );
  },
  {},
  { basePath: "/api" }
);

// ─── Auth wrapper ──────────────────────────────────────────────────────────
// claude.ai custom connectors don't expose a static-token field, so the secret
// rides in the URL (?key=…) or an Authorization: Bearer header. Data here is
// low-sensitivity (titles, health, spend totals — no encrypted notes), so a
// long unguessable secret is sufficient for a personal connector.
function authorized(req: Request): boolean {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false; // fail closed if misconfigured
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("key");
  const fromHeader = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  return fromQuery === secret || fromHeader === secret;
}

function guard(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
  }
  return handler(req);
}

export { guard as GET, guard as POST, guard as DELETE };
