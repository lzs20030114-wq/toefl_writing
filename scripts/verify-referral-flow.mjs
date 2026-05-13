// One-shot end-to-end verification for the referral activity.
// Creates 2 test users + walks the full bind → activate → grant flow,
// then cleans up. Run with: node scripts/verify-referral-flow.mjs
//
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
// and the dev server running at http://localhost:3000.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Minimal .env.local loader (no dotenv dep needed)
function loadEnv() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* fall through */ }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE         = process.env.TEST_BASE_URL || "http://localhost:3000";
const INVITER      = "INVTST";
const INVITEE      = "NEWTST";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function pretty(o) { return JSON.stringify(o, null, 2); }
const log = (i, label, v) => console.log(`${i}. ${label}`, v === undefined ? "" : pretty(v));

async function api(path, init) {
  const url = `${BASE}${path}`;
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function teardown() {
  await supabase.from("referrals").delete().eq("invitee_code", INVITEE);
  await supabase.from("sessions").delete().in("user_code", [INVITER, INVITEE]);
  await supabase.from("users").delete().in("code", [INVITER, INVITEE]);
}

(async () => {
  let pass = true;
  const fail = (m) => { pass = false; console.error("  ✗", m); };

  // ── 1. referrals table exists? (probe with insert+delete; SELECT head can
  //         silently succeed against PostgREST even when the table is missing) ─
  const probeId = `_probe_${Date.now()}`;
  const { error: probeErr } = await supabase
    .from("referrals")
    .insert({ inviter_code: probeId.slice(0, 6).toUpperCase(), invitee_code: probeId.slice(-6).toUpperCase(), status: "rejected" });
  // Clean up no matter what
  await supabase.from("referrals").delete().like("invitee_code", "%PROBE%").or("invitee_code.eq." + probeId.slice(-6).toUpperCase());
  if (probeErr) {
    if (probeErr.code === "PGRST205" || /schema cache/i.test(probeErr.message || "")) {
      console.error("✗ referrals table missing — run scripts/sql/referrals.sql in Supabase SQL Editor first.");
      console.error("  Also append: NOTIFY pgrst, 'reload schema';");
      process.exit(2);
    }
    console.error("✗ referrals probe failed:", probeErr.message);
    process.exit(2);
  }
  log(1, "referrals table:", "✓ exists & writable");

  // ── 2. Clean prior runs, then create test users ────────
  await teardown();
  const { error: insUserErr } = await supabase.from("users").upsert([
    { code: INVITER, tier: "free", tier_expires_at: null },
    { code: INVITEE, tier: "free", tier_expires_at: null },
  ], { onConflict: "code" });
  if (insUserErr) { console.error("✗ user setup:", insUserErr.message); await teardown(); process.exit(3); }
  log(2, "test users created:", { INVITER, INVITEE });

  try {
    // ── 3. bind ─────────────────────────────────────────
    const bind = await api("/api/referral/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviterCode: INVITER, inviteeCode: INVITEE, source: "link" }),
    });
    log(3, "POST /api/referral/bind ->", bind);
    if (bind.body.ok !== true || bind.body.status !== "pending") fail("expected ok=true status=pending");

    // ── 4. self-ref should be rejected ──────────────────
    const selfRef = await api("/api/referral/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviterCode: INVITER, inviteeCode: INVITER, source: "manual" }),
    });
    log(4, "self-referral rejected?", selfRef);
    if (selfRef.body.reason !== "self_ref") fail("expected self_ref rejection");

    // ── 5. activate before any practice → no_practice_yet ─
    const earlyAct = await api("/api/referral/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeCode: INVITEE }),
    });
    log(5, "activate before practice ->", earlyAct);
    if (earlyAct.body.reason !== "no_practice_yet") fail("expected no_practice_yet");

    // ── 6. snapshot inviter tier before grant ───────────
    const { data: before } = await supabase.from("users").select("tier, tier_expires_at").eq("code", INVITER).maybeSingle();
    log(6, "inviter before activation:", before);

    // ── 7. insert 1 practice session for invitee ────────
    await supabase.from("sessions").insert({
      user_code: INVITEE, type: "build", date: new Date().toISOString(), score: {},
    });
    log(7, "session inserted for invitee:", "✓");

    // ── 8. activate → expect granted ────────────────────
    const grant = await api("/api/referral/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeCode: INVITEE }),
    });
    log(8, "activate after practice ->", grant);
    if (grant.body.ok !== true || grant.body.granted !== true) fail("expected granted=true");
    if (grant.body.daysAdded !== 3) fail("expected daysAdded=3");

    // ── 9. inviter tier should be 'pro' with expiry ~3d ─
    const { data: after } = await supabase.from("users").select("tier, tier_expires_at").eq("code", INVITER).maybeSingle();
    log(9, "inviter after activation:", after);
    if (after.tier !== "pro") fail("expected tier=pro");
    if (!after.tier_expires_at) fail("expected tier_expires_at to be set");
    const daysLeft = (new Date(after.tier_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    log(9.5, `days remaining for inviter: ${daysLeft.toFixed(2)}`, daysLeft >= 2.9 && daysLeft <= 3.1 ? "✓ ~3 days" : "✗ out of range");
    if (daysLeft < 2.9 || daysLeft > 3.1) fail("expected ~3 days");

    // ── 10. stats endpoint ──────────────────────────────
    const stats = await api(`/api/referral/stats?code=${INVITER}`, { method: "GET" });
    log(10, "GET /api/referral/stats ->", stats);
    if (stats.body.grantedCount !== 1) fail("expected grantedCount=1");
    if (stats.body.daysEarned !== 3) fail("expected daysEarned=3");

    // ── 11. idempotent: activate again → already_granted ─
    const reAct = await api("/api/referral/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeCode: INVITEE }),
    });
    log(11, "activate again (idempotent) ->", reAct);
    if (reAct.body.reason !== "already_granted") fail("expected already_granted");

    // ── 12. double-bind: 2nd bind on same invitee → already_bound ─
    const reBind = await api("/api/referral/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviterCode: INVITER, inviteeCode: INVITEE, source: "manual" }),
    });
    log(12, "re-bind same invitee ->", reBind);
    if (reBind.body.reason !== "already_bound") fail("expected already_bound");

    // ── 13. IP flood guard: same IP binding another invitee within 24h → rejected ─
    const INVITEE2 = "NEW2ST";
    await supabase.from("users").upsert({ code: INVITEE2, tier: "free" }, { onConflict: "code" });
    const floodBind = await api("/api/referral/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviterCode: INVITER, inviteeCode: INVITEE2, source: "manual" }),
    });
    log(13, "same-IP 2nd bind blocked? ->", floodBind);
    if (floodBind.body.reason !== "ip_flood") fail("expected ip_flood rejection");
    await supabase.from("users").delete().eq("code", INVITEE2);

    // ── 14. stacking: directly create a 2nd granted referral in DB (bypass IP),
    //         re-activate logic via a new session for fresh invitee, and verify
    //         days_left jumps from ~3 to ~6 (stack-from-existing-expiry behavior). ─
    const INVITEE3 = "NEW3ST";
    await supabase.from("users").upsert({ code: INVITEE3, tier: "free" }, { onConflict: "code" });
    // Insert referral row directly so we skip the IP check
    await supabase.from("referrals").insert({
      inviter_code: INVITER, invitee_code: INVITEE3, source: "manual", status: "pending",
    });
    // 1 practice session for INVITEE3
    await supabase.from("sessions").insert({
      user_code: INVITEE3, type: "build", date: new Date().toISOString(), score: {},
    });
    const stack = await api("/api/referral/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteeCode: INVITEE3 }),
    });
    log(14, "2nd activation (stacking via DB-injected row) ->", stack);
    const { data: after2 } = await supabase.from("users").select("tier, tier_expires_at").eq("code", INVITER).maybeSingle();
    const daysLeft2 = (new Date(after2.tier_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    log(14.5, `inviter days remaining after stacking: ${daysLeft2.toFixed(2)}`, daysLeft2 >= 5.9 && daysLeft2 <= 6.1 ? "✓ stacked to ~6 days" : "✗ stacking broken");
    if (daysLeft2 < 5.9 || daysLeft2 > 6.1) fail("expected stacking to ~6 days");
    // Clean third invitee
    await supabase.from("referrals").delete().eq("invitee_code", INVITEE3);
    await supabase.from("sessions").delete().eq("user_code", INVITEE3);
    await supabase.from("users").delete().eq("code", INVITEE3);

    console.log(pass ? "\n✓ ALL CHECKS PASSED" : "\n✗ SOME CHECKS FAILED");
    process.exitCode = pass ? 0 : 1;
  } catch (e) {
    console.error("Test threw:", e);
    process.exitCode = 4;
  } finally {
    await teardown();
    console.log("\nCleanup done.");
  }
})();
