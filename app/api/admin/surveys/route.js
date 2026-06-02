import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";
import { FIRST_SET_SURVEY_TYPE as SURVEY_TYPE } from "../../../../lib/survey/firstSetSurveyType";

const Q1_LABELS = {
  better: "比预期好",
  same: "差不多",
  worse: "比预期差",
};
const Q2_LABELS = {
  use_it_up: "把 Pro 用足",
  maybe: "不一定",
  probably_not: "大概不会再做了",
};
const Q3_LABELS = {
  question_quality: "题目质量",
  difficulty: "题目难度",
  ai_quality: "AI 解析质量",
  ui: "答题界面/操作",
  coverage: "题量/题型范围",
  not_my_stage: "备考阶段不需要",
  other_tool: "已有更习惯的工具",
  other: "其他",
};

function buildDistribution(rows, key, labelMap) {
  const counts = new Map();
  let total = 0;
  for (const row of rows) {
    const value = String(row?.responses?.[key] || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
    total += 1;
  }
  const entries = Array.from(counts.entries()).map(([value, count]) => ({
    value,
    label: labelMap[value] || value,
    count,
    pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));
  entries.sort((a, b) => b.count - a.count);
  return { total, options: entries };
}

function buildDailyTrend(rows, days = 14) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    buckets.push({
      date: d.toISOString().slice(0, 10),
      submitted: 0,
      dismissed: 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const row of rows) {
    const ts = row?.created_at ? new Date(row.created_at) : null;
    if (!ts || Number.isNaN(ts.getTime())) continue;
    const day = ts.toISOString().slice(0, 10);
    const i = index.get(day);
    if (i == null) continue;
    if (row.status === "submitted") buckets[i].submitted += 1;
    else if (row.status === "dismissed") buckets[i].dismissed += 1;
  }
  return buckets;
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const commentLimit = Math.min(200, Math.max(1, Number(url.searchParams.get("commentLimit") || 50)));

    const { data, error } = await supabaseAdmin
      .from("user_surveys")
      .select("id,user_code,status,responses,created_at")
      .eq("survey_type", SURVEY_TYPE)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return jsonError(400, error.message || "List surveys failed");

    const rows = data || [];
    const submitted = rows.filter((r) => r.status === "submitted");
    const dismissed = rows.filter((r) => r.status === "dismissed");
    const totalShown = submitted.length + dismissed.length;
    const completionRate = totalShown > 0
      ? Math.round((submitted.length / totalShown) * 1000) / 10
      : 0;

    const distributions = {
      q1: buildDistribution(submitted, "q1", Q1_LABELS),
      q2: buildDistribution(submitted, "q2", Q2_LABELS),
      q3: buildDistribution(submitted, "q3", Q3_LABELS),
    };

    const trend = buildDailyTrend(rows, 14);

    const comments = submitted
      .filter((r) => {
        const q3Other = String(r?.responses?.q3Other || "").trim();
        const q4 = String(r?.responses?.q4 || "").trim();
        return q3Other || q4;
      })
      .slice(0, commentLimit)
      .map((r) => ({
        id: r.id,
        user_code: r.user_code,
        created_at: r.created_at,
        q1: r?.responses?.q1 || null,
        q2: r?.responses?.q2 || null,
        q3: r?.responses?.q3 || null,
        q3Label: Q3_LABELS[r?.responses?.q3] || null,
        q3Other: String(r?.responses?.q3Other || "").trim() || null,
        q4: String(r?.responses?.q4 || "").trim() || null,
      }));

    return Response.json({
      ok: true,
      stats: {
        submitted: submitted.length,
        dismissed: dismissed.length,
        totalShown,
        completionRate,
      },
      distributions,
      trend,
      comments,
      labels: { q1: Q1_LABELS, q2: Q2_LABELS, q3: Q3_LABELS },
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
