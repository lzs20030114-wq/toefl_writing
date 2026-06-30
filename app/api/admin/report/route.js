import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

// Pull-mode weekly/monthly report. Period-over-period rollup of the metrics
// that tell the operator "is it growing / sticking" at a glance. Computed in
// JS over the existing users + sessions tables — needs NO SQL migration (works
// independently of the cohort_retention_daily view). Admin-only.

const MS = 86400000;

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}
function utcDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

async function pullAll(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(cols).range(from, from + 999);
    if (error) return { rows: null, error };
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return { rows, error: null };
}

// Most-recent-first list of {start, end} UTC ranges (end exclusive).
function genPeriods(period, count, now) {
  const periods = [];
  if (period === "month") {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    for (let i = 0; i < count; i += 1) {
      periods.push({ start: new Date(Date.UTC(y, m - i, 1)), end: new Date(Date.UTC(y, m - i + 1, 1)) });
    }
  } else {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const thisMonday = new Date(d.getTime() - dow * MS);
    for (let i = 0; i < count; i += 1) {
      const start = new Date(thisMonday.getTime() - i * 7 * MS);
      periods.push({ start, end: new Date(start.getTime() + 7 * MS) });
    }
  }
  return periods;
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") === "month" ? "month" : "week";
    const count = Math.min(Math.max(parseInt(searchParams.get("count")) || 8, 2), 26);
    const now = new Date();
    const window = period === "month" ? 30 : 7; // retention window per period type

    const { rows: users, error: uErr } = await pullAll("users", "code,created_at,status");
    if (uErr) return jsonError(400, uErr.message || "Load users failed");
    const { rows: sessions, error: sErr } = await pullAll("sessions", "user_code,date");
    if (sErr) return jsonError(400, sErr.message || "Load sessions failed");

    // Signup day per eligible user (exclude never-activated pre-generated codes).
    const signupDay = new Map();
    for (const u of users) {
      if (u.status === "pending" || !u.created_at) continue;
      signupDay.set(u.code, utcDay(u.created_at));
    }
    // Distinct active UTC days per user (for activation / retention offsets).
    const activeDays = new Map();
    for (const s of sessions) {
      if (!s.date) continue;
      let set = activeDays.get(s.user_code);
      if (!set) { set = new Set(); activeDays.set(s.user_code, set); }
      set.add(utcDay(s.date));
    }

    const periods = genPeriods(period, count, now).map(({ start, end }) => {
      const startMs = start.getTime();
      const endMs = end.getTime();

      // Signups that fall in this period → this period's cohort.
      const cohort = [];
      for (const [code, day] of signupDay) {
        const t = Date.parse(day);
        if (t >= startMs && t < endMs) cohort.push(code);
      }

      // Active users + practice count during the period (timestamp-precise).
      let sessCount = 0;
      const activeSet = new Set();
      for (const s of sessions) {
        if (!s.date) continue;
        const tt = Date.parse(s.date);
        if (tt >= startMs && tt < endMs) { sessCount += 1; activeSet.add(s.user_code); }
      }

      // Activation (practiced on/after signup) + retention (returned within window).
      let activated = 0;
      let retained = 0;
      for (const code of cohort) {
        const days = activeDays.get(code);
        if (!days) continue;
        const sd = Date.parse(signupDay.get(code));
        let act = false;
        let ret = false;
        for (const day of days) {
          const off = Math.round((Date.parse(day) - sd) / MS);
          if (off >= 0) act = true;
          if (off >= 1 && off <= window) ret = true;
        }
        if (act) activated += 1;
        if (ret) retained += 1;
      }

      const startStr = utcDay(startMs);
      const lastDay = utcDay(endMs - MS); // inclusive last calendar day
      return {
        key: startStr,
        label: period === "month" ? startStr.slice(0, 7) : `${startStr.slice(5)} ~ ${lastDay.slice(5)}`,
        inProgress: now.getTime() < endMs,
        newSignups: cohort.length,
        activeUsers: activeSet.size,
        sessions: sessCount,
        cohortSize: cohort.length,
        activated,
        activationPct: pct(activated, cohort.length),
        retained,
        retentionPct: pct(retained, cohort.length),
        retentionWindow: window,
        // Retention is final only once the whole period + window has elapsed.
        retentionMature: now.getTime() >= endMs + window * MS,
      };
    });

    return Response.json({ period, window, count, generatedAt: now.toISOString(), periods });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
