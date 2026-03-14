#!/usr/bin/env node
/**
 * One-time cleanup: remove E2E test data from Supabase.
 * - Reset GUHUCB tier to free
 * - Delete iap_entitlements with test/e2e order refs
 * - Delete iap_webhook_events with test/e2e event IDs
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-test-data.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const sb = createClient(url, key);

async function main() {
  console.log("=== Cleanup Test Data ===\n");

  // 1. Reset GUHUCB
  const { data: user } = await sb.from("users").select("code, tier, tier_expires_at").eq("code", "GUHUCB").single();
  if (user) {
    console.log(`GUHUCB current: tier=${user.tier}, expires=${user.tier_expires_at}`);
    const { error } = await sb.from("users").update({ tier: "free", tier_expires_at: null }).eq("code", "GUHUCB");
    if (error) console.error("  Failed to reset:", error.message);
    else console.log("  Reset to free tier");
  }

  // 2. Delete test entitlements
  const { data: ents, error: entErr } = await sb.from("iap_entitlements").select("id, provider_ref").or("provider_ref.like.e2e_%,provider_ref.like.test_%");
  if (entErr) {
    console.error("Error querying entitlements:", entErr.message);
  } else {
    console.log(`\nFound ${ents?.length || 0} test entitlements`);
    if (ents?.length > 0) {
      const ids = ents.map((e) => e.id);
      const { error: delErr } = await sb.from("iap_entitlements").delete().in("id", ids);
      if (delErr) console.error("  Delete error:", delErr.message);
      else console.log(`  Deleted ${ids.length} entitlements`);
    }
  }

  // 3. Delete test webhook events
  const { data: events, error: evtErr } = await sb.from("iap_webhook_events").select("id, event_id").or("event_id.like.e2e_%,event_id.like.test_%");
  if (evtErr) {
    console.error("Error querying webhook events:", evtErr.message);
  } else {
    console.log(`\nFound ${events?.length || 0} test webhook events`);
    if (events?.length > 0) {
      const ids = events.map((e) => e.id);
      const { error: delErr } = await sb.from("iap_webhook_events").delete().in("id", ids);
      if (delErr) console.error("  Delete error:", delErr.message);
      else console.log(`  Deleted ${ids.length} webhook events`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
