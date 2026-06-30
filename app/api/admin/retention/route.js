import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

// Reads the cohort_retention_daily + engagement_stickiness views created by
// scripts/sql/cohort-retention.sql. Computes percentages + cohort maturity in
// JS (matches how the other admin analytics endpoints aggregate).

const MS_PER_DAY = 86400000;

function pct(n, d) {
  if (!d || d <= 0) return null;
  return Math.round((n / d) * 1000) / 10; // one decimal
}

function dayAge(todayStr, cohortDayStr) {
  // Both are YYYY-MM-DD (UTC). Whole-day difference.
  return Math.round((Date.parse(todayStr) - Date.parse(cohortDayStr)) / MS_PER_DAY);
}

// A "returned-within-N-days" number is final only once day N has fully elapsed.
// Day N is the calendar day at offset N from signup; it stays open until "today"
// moves PAST it — i.e. age > N, not age >= N. At age === N the offset-N day IS
// today and can still accrue activity, so the number is still partial.
function isMature(age, window) {
  return Number.isFinite(age) && age > window;
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days")) || 60, 7), 365);
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);

    const [{ data: cohortRows, error: cohortErr }, { data: stickyRows, error: stickyErr }] =
      await Promise.all([
        supabaseAdmin
          .from("cohort_retention_daily")
          .select("cohort_day,cohort_size,activated,d1,d7,d30")
          .gte("cohort_day", since)
          .order("cohort_day", { ascending: false })
          .limit(400),
        supabaseAdmin.from("engagement_stickiness").select("dau,wau,mau").maybeSingle(),
      ]);

    const viewMissing = (e) =>
      e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|does not exist/i.test(e.message || ""));
    if (viewMissing(cohortErr) || viewMissing(stickyErr)) {
      return jsonError(
        503,
        "留存视图尚未创建。请先在 Supabase SQL Editor 运行 scripts/sql/cohort-retention.sql。"
      );
    }
    if (cohortErr) return jsonError(400, cohortErr.message || "Load cohorts failed");
    if (stickyErr) return jsonError(400, stickyErr.message || "Load stickiness failed");

    const cohorts = (cohortRows || []).map((r) => {
      const age = dayAge(today, r.cohort_day);
      const size = r.cohort_size || 0;
      const m1 = isMature(age, 1);
      const m7 = isMature(age, 7);
      const m30 = isMature(age, 30);
      return {
        cohortDay: r.cohort_day,
        ageDays: age,
        size,
        activated: r.activated || 0,
        activationPct: pct(r.activated || 0, size),
        d1: r.d1 || 0,
        d1Pct: pct(r.d1 || 0, size),
        d1Mature: m1,
        d7: r.d7 || 0,
        d7Pct: pct(r.d7 || 0, size),
        d7Mature: m7,
        d30: r.d30 || 0,
        d30Pct: pct(r.d30 || 0, size),
        d30Mature: m30,
      };
    });

    // Weighted summary. Retention rolls up over MATURE cohorts only (an
    // immature cohort has an open window and would understate the rate).
    let totalUsers = 0;
    let totalActivated = 0;
    const acc = {
      d1: { users: 0, retained: 0 },
      d7: { users: 0, retained: 0 },
      d30: { users: 0, retained: 0 },
    };
    for (const c of cohorts) {
      totalUsers += c.size;
      totalActivated += c.activated;
      if (c.d1Mature) { acc.d1.users += c.size; acc.d1.retained += c.d1; }
      if (c.d7Mature) { acc.d7.users += c.size; acc.d7.retained += c.d7; }
      if (c.d30Mature) { acc.d30.users += c.size; acc.d30.retained += c.d30; }
    }

    const sticky = stickyRows || { dau: 0, wau: 0, mau: 0 };
    const dau = sticky.dau || 0;
    const wau = sticky.wau || 0;
    const mau = sticky.mau || 0;

    return Response.json({
      days,
      generatedAt: new Date().toISOString(),
      stickiness: { dau, wau, mau, ratio: mau ? Math.round((dau / mau) * 1000) / 1000 : null },
      summary: {
        cohortCount: cohorts.length,
        totalUsers,
        totalActivated,
        activationPct: pct(totalActivated, totalUsers),
        d1: { users: acc.d1.users, retained: acc.d1.retained, pct: pct(acc.d1.retained, acc.d1.users) },
        d7: { users: acc.d7.users, retained: acc.d7.retained, pct: pct(acc.d7.retained, acc.d7.users) },
        d30: { users: acc.d30.users, retained: acc.d30.retained, pct: pct(acc.d30.retained, acc.d30.users) },
      },
      cohorts,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
