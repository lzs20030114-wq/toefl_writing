/**
 * GET /api/admin/referrals/stats?days=30
 *
 * Returns the referral funnel + leaderboards for the admin dashboard.
 * Requires ADMIN_DASHBOARD_TOKEN via x-admin-token header.
 *
 * Response shape:
 *   {
 *     window: { days, since },
 *     funnel: {
 *       link_visit, modal_open, bind_attempt, bind_success, bind_rejected,
 *       first_practice, grant_success, share_link_copied, share_text_copied
 *     },
 *     daily: [{ day, link_visits, bind_successes, grants, ... }],
 *     topInviters: [{ inviter_code, granted, pending, days_earned }],
 *     suspiciousIps: [{ ip, attempts, bind_successes, distinct_invitees }],
 *     rejectionReasons: [{ reason, count }],
 *     summary: { total_referrals, granted_total, pending_total, rejected_total }
 *   }
 */

import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../../lib/apiResponse";

function dayKey(iso) {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days")) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // ── Pull events within range. Cap at 50k rows — at >1k events/day we
    // would already need pagination, but at current scale this is generous.
    const { data: events, error: evtErr } = await supabaseAdmin
      .from("referral_events")
      .select("event, inviter_code, invitee_code, source, reason, ip, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50000);
    if (evtErr) return jsonError(400, evtErr.message);

    const evts = events || [];

    // ── Aggregate funnel counts
    const funnel = {
      link_visit: 0,
      modal_open: 0,
      bind_attempt: 0,
      bind_success: 0,
      bind_rejected: 0,
      first_practice: 0,
      grant_success: 0,
      share_link_copied: 0,
      share_text_copied: 0,
    };
    const rejectionMap = {};
    const dailyMap = {};
    const ipMap = {};

    for (const e of evts) {
      if (e.event in funnel) funnel[e.event] += 1;
      if (e.event === "bind_rejected" && e.reason) {
        rejectionMap[e.reason] = (rejectionMap[e.reason] || 0) + 1;
      }
      const day = dayKey(e.created_at);
      if (day) {
        if (!dailyMap[day]) {
          dailyMap[day] = {
            day, link_visits: 0, modal_opens: 0, bind_attempts: 0,
            bind_successes: 0, bind_rejections: 0, first_practices: 0,
            grants: 0, link_copies: 0, text_copies: 0,
          };
        }
        const bucket = dailyMap[day];
        if (e.event === "link_visit") bucket.link_visits += 1;
        else if (e.event === "modal_open") bucket.modal_opens += 1;
        else if (e.event === "bind_attempt") bucket.bind_attempts += 1;
        else if (e.event === "bind_success") bucket.bind_successes += 1;
        else if (e.event === "bind_rejected") bucket.bind_rejections += 1;
        else if (e.event === "first_practice") bucket.first_practices += 1;
        else if (e.event === "grant_success") bucket.grants += 1;
        else if (e.event === "share_link_copied") bucket.link_copies += 1;
        else if (e.event === "share_text_copied") bucket.text_copies += 1;
      }
      if (e.ip && ["bind_attempt", "bind_success", "bind_rejected"].includes(e.event)) {
        if (!ipMap[e.ip]) ipMap[e.ip] = { ip: e.ip, attempts: 0, bind_successes: 0, invitees: new Set() };
        ipMap[e.ip].attempts += 1;
        if (e.event === "bind_success") ipMap[e.ip].bind_successes += 1;
        if (e.invitee_code) ipMap[e.ip].invitees.add(e.invitee_code);
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day));

    // ── Top inviters (from referrals table — authoritative source of truth)
    const { data: referrals, error: refErr } = await supabaseAdmin
      .from("referrals")
      .select("inviter_code, status, bound_at, rewards_granted_at")
      .gte("bound_at", since)
      .limit(50000);
    if (refErr) return jsonError(400, refErr.message);

    const inviterMap = {};
    let granted_total = 0;
    let pending_total = 0;
    let rejected_total = 0;
    for (const r of referrals || []) {
      const code = r.inviter_code;
      if (!code) continue;
      if (!inviterMap[code]) inviterMap[code] = { inviter_code: code, granted: 0, pending: 0, rejected: 0 };
      if (r.status === "granted") { inviterMap[code].granted += 1; granted_total += 1; }
      else if (r.status === "rejected") { inviterMap[code].rejected += 1; rejected_total += 1; }
      else { inviterMap[code].pending += 1; pending_total += 1; }
    }
    const topInviters = Object.values(inviterMap)
      .map((row) => ({ ...row, days_earned: row.granted * 3 }))
      .sort((a, b) => b.granted - a.granted || b.pending - a.pending)
      .slice(0, 20);

    // ── Suspicious IPs (≥3 attempts OR low success rate at higher volume)
    const suspiciousIps = Object.values(ipMap)
      .map((row) => ({
        ip: row.ip,
        attempts: row.attempts,
        bind_successes: row.bind_successes,
        distinct_invitees: row.invitees.size,
      }))
      .filter((row) => row.attempts >= 3 || row.distinct_invitees >= 3)
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 30);

    const rejectionReasons = Object.entries(rejectionMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return Response.json({
      window: { days, since },
      funnel,
      daily,
      topInviters,
      suspiciousIps,
      rejectionReasons,
      summary: {
        total_referrals: (referrals || []).length,
        granted_total,
        pending_total,
        rejected_total,
      },
    });
  } catch (e) {
    return jsonError(500, e?.message || "Unexpected server error");
  }
}
