import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Two separate Supabase projects back this server:
 *   - agent-state project (rnycgzofwpuhjjxdywjd): `threads` + `agent_health`
 *   - spend project (kqdnoxujhgbszkysehbu): `spend_log`
 *
 * Service-role keys are used (read-only intent enforced by the tool layer —
 * every query is a SELECT). Keys live only in Vercel env, never in the repo.
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
