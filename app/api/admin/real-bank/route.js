import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";
import { REAL_SESSION_SELECT } from "../../../../lib/admin/realSession";
import { aggregateRealBank } from "../../../../lib/admin/realBankStats";

// 后台「真题板块」：真题专区（/real-bank）的全站练习统计。
// 纯 JS 在 sessions 表上聚合（与 report/route.js 同一思路），不需要 SQL 迁移。
// 只投影 score + details 里几个 id 字段，不把 passage / transcript 整段拉回来。

const MS = 86400000;

async function pullSessions(sinceIso) {
  const cols = `user_code,type,date,score,${REAL_SESSION_SELECT}`;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from("sessions").select(cols);
    if (sinceIso) q = q.gte("date", sinceIso);
    const { data, error } = await q.order("date", { ascending: false }).range(from, from + 999);
    if (error) return { rows: null, error };
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    if (rows.length >= 100000) break; // 安全上限
  }
  return { rows, error: null };
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const rawDays = searchParams.get("days");
    // days=0 / all → 全量；否则 1–365。
    const days = rawDays === "0" || rawDays === "all" ? 0 : Math.min(Math.max(parseInt(rawDays) || 30, 1), 365);
    const now = new Date();
    const since = days ? new Date(now.getTime() - days * MS).toISOString() : null;

    const { rows, error } = await pullSessions(since);
    if (error) return jsonError(400, error.message || "Load sessions failed");

    const stats = aggregateRealBank(rows, { days, now });
    return Response.json({ ok: true, days, generatedAt: now.toISOString(), ...stats });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
