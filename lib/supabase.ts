import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Two separate Supabase projects back this server:
 *   - the "ledger" project: `threads` + `agent_health`
 *   - the "spend" project:  `spend_log`
 *
 * They can be the same project (point both URL/key pairs at it) or different
 * ones. Service-role keys are used; read-only intent is enforced by the tool
 * layer — every query is a SELECT. Keys live only in env, never in the repo.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let _ledger: SupabaseClient | null = null;
let _spend: SupabaseClient | null = null;

/** agent-state project — `threads`, `agent_health`. */
export function ledgerDb(): SupabaseClient {
  if (!_ledger) {
    _ledger = createClient(
      required("LEDGER_SUPABASE_URL"),
      required("LEDGER_SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } }
    );
  }
  return _ledger;
}

/** spend project — `spend_log`. */
export function spendDb(): SupabaseClient {
  if (!_spend) {
    _spend = createClient(
      required("SPEND_SUPABASE_URL"),
      required("SPEND_SUPABASE_SERVICE_KEY"),
      { auth: { persistSession: false } }
    );
  }
  return _spend;
}
