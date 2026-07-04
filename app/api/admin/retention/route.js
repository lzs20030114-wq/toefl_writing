import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

// Reads the cohort_retention_daily + engagement_stickiness views (created by
// scripts/sql/cohort-retention.sql) for legacy day-by-day cohort retention, AND
// the feature_* views (scripts/sql/feature-engagement.sql) for the "做题量 /
// 功能吸引力" analysis that is now the page's primary content. Percentages +
// cohort maturity are computed in JS (matches the other admin analytics).
//
// The feature_* views are OPTIONAL: if they haven't been created yet the
// endpoint still returns stickiness + legacy cohorts and flags
// featuresAvailable=false so the page can prompt to run the migration.

const MS_PER_DAY = 86400000;

// Canonical feature (= sessions.type) order + 中文名. mock is its own feature
// ("写作模考", 方案 A) — not split into build/email/discussion.
const FEATURE_LABELS = {
  bs: "造句",
  discussion: "学术讨论",
  email: "邮件写作",
  reading: "阅读",
  listening: "听力",
  speaking: "口语",
  mock: "写作模考",
};
const FEATURE_ORDER = ["bs", "discussion", "email", "reading", "listening", "speaking", "mock"];
const featureLabel = (f) => FEATURE_LABELS[f] || f;
const featureRank = (f) => {
  const i = FEATURE_ORDER.indexOf(f);
  return i === -1 ? FEATURE_ORDER.length : i;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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

const viewMissing = (e) =>
  e && (e.code === "42P01" || e.code === "PGRST205" || /could not find the table|does not exist/i.test(e.message || ""));

// Build the feature-engagement block from the four feature_* views. Returns
// { available, features, firstTouch, weekly } — available=false when the views
// don't exist yet (migration not run).
function buildFeatures({ totals, firstTouch, sticky, weekly }) {
  const totalsRows = totals || [];
  const stickyByFeature = new Map((sticky || []).map((r) => [r.feature, r]));

  const totalItems = totalsRows.reduce((s, r) => s + num(r.items), 0);

  const features = totalsRows
    .map((r) => {
      const items = num(r.items);
      const sessions = num(r.sessions);
      const users = num(r.users);
      const s = stickyByFeature.get(r.feature);
      const mature = s ? num(s.mature_users) : 0;
      const returned = s ? num(s.returned_users) : 0;
      return {
        feature: r.feature,
        label: featureLabel(r.feature),
        items,
        sessions,
        users,
        active7d: num(r.active_7d),
        active30d: num(r.active_30d),
        itemsPerUser: users ? Math.round((items / users) * 10) / 10 : null,
        sessionsPerUser: users ? Math.round((sessions / users) * 10) / 10 : null,
        itemShare: pct(items, totalItems),
        repeatRate2: pct(num(r.repeat_2plus), users),
        repeatRate3: pct(num(r.repeat_3plus), users),
        stickinessMature: mature,
        stickinessReturned: returned,
        stickinessPct: pct(returned, mature),
      };
    })
    .sort((a, b) => b.items - a.items || featureRank(a.feature) - featureRank(b.feature));

  const totalFirstTouch = (firstTouch || []).reduce((s, r) => s + num(r.users), 0);
  const firstTouchOut = (firstTouch || [])
    .map((r) => ({
      feature: r.feature,
      label: featureLabel(r.feature),
      users: num(r.users),
      share: pct(num(r.users), totalFirstTouch),
    }))
    .sort((a, b) => b.users - a.users || featureRank(a.feature) - featureRank(b.feature));

  // Pivot weekly rows -> [{ week, byFeature: { <feature>: items } }] ascending.
  const weekMap = new Map();
  for (const r of weekly || []) {
    const wk = r.week;
    if (!weekMap.has(wk)) weekMap.set(wk, {});
    weekMap.get(wk)[r.feature] = num(r.items);
  }
  const weeklyOut = [...weekMap.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([week, byFeature]) => ({
      week,
      byFeature,
      total: Object.values(byFeature).reduce((s, v) => s + v, 0),
    }));

  return { available: true, features, firstTouch: firstTouchOut, weekly: weeklyOut };
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days")) || 60, 7), 365);
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);

    const [
      { data: cohortRows, error: cohortErr },
      { data: stickyRows, error: stickyErr },
      { data: totalsRows, error: totalsErr },
      { data: firstTouchRows, error: firstTouchErr },
      { data: featStickyRows, error: featStickyErr },
      { data: weeklyRows, error: weeklyErr },
    ] = await Promise.all([
      supabaseAdmin
        .from("cohort_retention_daily")
        .select("cohort_day,cohort_size,activated,d1,d7,d30")
        .gte("cohort_day", since)
        .order("cohort_day", { ascending: false })
        .limit(400),
      supabaseAdmin.from("engagement_stickiness").select("dau,wau,mau").maybeSingle(),
      supabaseAdmin.from("feature_engagement_totals").select("*"),
      supabaseAdmin.from("feature_first_touch").select("*"),
      supabaseAdmin.from("feature_stickiness").select("*"),
      supabaseAdmin.from("feature_weekly").select("*").order("week", { ascending: true }).limit(2000),
    ]);

    // Legacy cohort + stickiness views are still required (core stickiness cards).
    if (viewMissing(cohortErr) || viewMissing(stickyErr)) {
      return jsonError(
        503,
        "留存视图尚未创建。请先在 Supabase SQL Editor 运行 scripts/sql/cohort-retention.sql。"
      );
    }
    if (cohortErr) return jsonError(400, cohortErr.message || "Load cohorts failed");
    if (stickyErr) return jsonError(400, stickyErr.message || "Load stickiness failed");

    // Feature views are optional — degrade gracefully if the migration is unrun.
    const featureErr = totalsErr || firstTouchErr || featStickyErr || weeklyErr;
    let featureBlock;
    if (viewMissing(featureErr)) {
      featureBlock = { available: false, features: [], firstTouch: [], weekly: [] };
    } else if (featureErr) {
      return jsonError(400, featureErr.message || "Load feature engagement failed");
    } else {
      featureBlock = buildFeatures({
        totals: totalsRows,
        firstTouch: firstTouchRows,
        sticky: featStickyRows,
        weekly: weeklyRows,
      });
    }

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
      featuresAvailable: featureBlock.available,
      features: featureBlock.features,
      firstTouch: featureBlock.firstTouch,
      weekly: featureBlock.weekly,
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
