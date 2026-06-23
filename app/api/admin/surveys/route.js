import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";
import {
  FIRST_SET_SURVEY_TYPE as SURVEY_TYPE,
  FIRST_SET_SURVEY_ROUNDS,
} from "../../../../lib/survey/firstSetSurveyType";

const ROUND_KEYS = FIRST_SET_SURVEY_ROUNDS.map((r) => r.key);

// Resolve the ?round= param to a survey_type filter. Defaults to the active
// round; "all" aggregates every round so the operator can see history that a
// round bump would otherwise hide.
function resolveRound(requested) {
  if (requested === "all") return { round: "all", types: ROUND_KEYS };
  if (ROUND_KEYS.includes(requested)) return { round: requested, types: [requested] };
  return { round: SURVEY_TYPE, types: [SURVEY_TYPE] };
}

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
// V2-vs-V1 redesign: responses carry a `variant` ("v1" | "new"); old v2 rows
// (pre-redesign) have no variant and are bucketed as "legacy".
const VARIANT_LABELS = { v1: "V1 老用户", new: "新用户", legacy: "旧版问卷" };
const RECALL_LABELS = { clear: "印象清楚", fuzzy: "记不太清" };
const CMP_LABELS = { better: "进步", same: "差不多", worse: "退步" };
const ABS_LABELS = { good: "👍 不错", ok: "😐 一般", bad: "👎 不太好" };
const DIM_LABELS = {
  quality: "题目质量",
  difficulty: "题目难度",
  ai: "AI 解析",
  similarity: "与真实托福相似度",
  ui: "答题界面/操作",
};
const V1_DIMS = ["quality", "difficulty", "ai", "similarity"];
const NEW_DIMS = ["quality", "difficulty", "ai", "similarity", "ui"];
const CMP_ORDER = ["better", "same", "worse"];
const ABS_ORDER = ["good", "ok", "bad"];

function buildDistribution(rows, key, labelMap, opts = {}) {
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
  if (opts.order) {
    // Fixed display order (yes/no or a 1–5 scale) — count-sorting would scramble it.
    const rank = new Map(opts.order.map((v, i) => [v, i]));
    entries.sort((a, b) => (rank.get(a.value) ?? 999) - (rank.get(b.value) ?? 999));
  } else {
    entries.sort((a, b) => b.count - a.count);
  }
  return { total, options: entries };
}

// One distribution per matrix dimension. Reads the nested `responses[matrixKey][dim]`
// and keeps every scale point (incl. 0-count) so the matrix renders full rows.
function buildMatrixDistribution(rows, matrixKey, dimKeys, order, scaleLabels) {
  return dimKeys.map((dimKey) => {
    const counts = new Map();
    let total = 0;
    for (const row of rows) {
      const m = row?.responses?.[matrixKey];
      const value = m && typeof m === "object" ? String(m[dimKey] || "").trim() : "";
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
      total += 1;
    }
    const options = order.map((value) => ({
      value,
      label: scaleLabels[value] || value,
      count: counts.get(value) || 0,
      pct: total > 0 ? Math.round(((counts.get(value) || 0) / total) * 1000) / 10 : 0,
    }));
    return { key: dimKey, label: DIM_LABELS[dimKey] || dimKey, total, options };
  });
}

// Flatten one submitted row into a per-response entry for the detail table.
// `variant` is the user's source/cohort (v1 老用户 / new 新用户 / legacy 旧版),
// and the matrix is normalized to whichever scale that row actually carries:
//   new        → abs scale, 5 dims
//   v1 + clear → cmp scale, 4 dims
//   v1 + fuzzy → abs scale, 4 dims
//   legacy     → no matrix (only q1/q2/q3)
function buildEntry(row) {
  const resp = row?.responses || {};
  // Match buildVariantSplit's bucketing: a row with no variant is an old v2
  // submission ⇒ "legacy" (旧版问卷), not an unknown source.
  const variant = resp.variant || "legacy";
  const recall = resp.recall || null;

  let matrix = null;
  if (variant === "new") {
    matrix = { scale: "abs", dims: NEW_DIMS };
  } else if (variant === "v1" && recall === "clear") {
    matrix = { scale: "cmp", dims: V1_DIMS };
  } else if (variant === "v1" && recall === "fuzzy") {
    matrix = { scale: "abs", dims: V1_DIMS };
  }

  if (matrix) {
    const src = matrix.scale === "cmp" ? resp.cmp : resp.abs;
    const scaleLabels = matrix.scale === "cmp" ? CMP_LABELS : ABS_LABELS;
    matrix = {
      scale: matrix.scale,
      dims: matrix.dims.map((key) => {
        const value = src && typeof src === "object" ? String(src[key] || "") || null : null;
        return { key, label: DIM_LABELS[key] || key, value, valueLabel: value ? scaleLabels[value] || value : null };
      }),
    };
  }

  return {
    id: row.id,
    user_code: row.user_code,
    created_at: row.created_at,
    variant,
    recall,
    q1: resp.q1 || null,
    q2: resp.q2 || null,
    q3: resp.q3 || null,
    q3Label: Q3_LABELS[resp.q3] || null,
    q3Other: String(resp.q3Other || "").trim() || null,
    q4: String(resp.q4 || "").trim() || null,
    matrix,
  };
}

// Split submitted rows by questionnaire variant (v1 / new / legacy).
function buildVariantSplit(rows) {
  const counts = { v1: 0, new: 0, legacy: 0 };
  for (const r of rows) {
    const v = r?.responses?.variant;
    if (v === "v1") counts.v1 += 1;
    else if (v === "new") counts.new += 1;
    else counts.legacy += 1;
  }
  const total = counts.v1 + counts.new + counts.legacy;
  const options = ["v1", "new", "legacy"]
    .map((value) => ({
      value,
      label: VARIANT_LABELS[value],
      count: counts[value],
      pct: total > 0 ? Math.round((counts[value] / total) * 1000) / 10 : 0,
    }))
    .filter((o) => o.count > 0);
  return { total, options };
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
    const { round, types } = resolveRound(url.searchParams.get("round"));

    const { data, error } = await supabaseAdmin
      .from("user_surveys")
      .select("id,user_code,status,responses,created_at")
      .in("survey_type", types)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return jsonError(400, error.message || "List surveys failed");

    const rows = data || [];
    const submitted = rows.filter((r) => r.status === "submitted");
    // A snoozed survey ("再做两套看看") is stored as a dismissed row flagged
    // snoozePending — it's not a real dismissal, so keep it out of the stats.
    const dismissed = rows.filter(
      (r) => r.status === "dismissed" && !r.responses?.snoozePending,
    );
    const totalShown = submitted.length + dismissed.length;
    const completionRate = totalShown > 0
      ? Math.round((submitted.length / totalShown) * 1000) / 10
      : 0;

    // Variant cohorts. Legacy = old v2 rows (no variant) but still carry q1/q2/q3.
    const v1Rows = submitted.filter((r) => r?.responses?.variant === "v1");
    const newRows = submitted.filter((r) => r?.responses?.variant === "new");
    const legacyRows = submitted.filter((r) => !r?.responses?.variant);
    // q1 (feel) / q2 (Pro) / q3 (factor) live on both new-user and legacy rows.
    const feelRows = [...newRows, ...legacyRows];

    const distributions = {
      variant: buildVariantSplit(submitted),
      q1: buildDistribution(feelRows, "q1", Q1_LABELS, { order: ["better", "same", "worse"] }),
      q2: buildDistribution(feelRows, "q2", Q2_LABELS),
      q3: buildDistribution(feelRows, "q3", Q3_LABELS),
      recall: buildDistribution(v1Rows, "recall", RECALL_LABELS, { order: ["clear", "fuzzy"] }),
    };
    const matrices = {
      newAbs: buildMatrixDistribution(newRows, "abs", NEW_DIMS, ABS_ORDER, ABS_LABELS),
      v1Cmp: buildMatrixDistribution(
        v1Rows.filter((r) => r?.responses?.recall === "clear"),
        "cmp", V1_DIMS, CMP_ORDER, CMP_LABELS,
      ),
      v1Abs: buildMatrixDistribution(
        v1Rows.filter((r) => r?.responses?.recall === "fuzzy"),
        "abs", V1_DIMS, ABS_ORDER, ABS_LABELS,
      ),
    };

    const trend = buildDailyTrend(rows, 14);

    // Per-response detail rows for the "逐份作答" table — every submitted
    // questionnaire (newest first), capped so the payload stays bounded.
    const ENTRY_CAP = 1000;
    const entries = submitted.slice(0, ENTRY_CAP).map(buildEntry);
    const entriesTruncated = submitted.length > ENTRY_CAP;

    // Enrich each entry with the actual user identity (email + tier) so the
    // operator can see WHICH specific user filled each questionnaire — a bare
    // 6-digit user_code is opaque. One batched, deduped lookup (the "all rounds"
    // view can repeat a code across rounds). Mirrors app/api/admin/grant-pro.
    // Email/tier are already surfaced in the token-gated admin (api/admin/users),
    // so this is no new exposure. Degrades gracefully: a lookup error just
    // leaves email/tier null rather than failing the whole dashboard.
    const codes = [...new Set(entries.map((e) => e.user_code).filter(Boolean))];
    if (codes.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("code,email,tier,tier_expires_at")
        .in("code", codes);
      const byCode = new Map((users || []).map((u) => [u.code, u]));
      for (const e of entries) {
        const u = byCode.get(e.user_code);
        e.email = u?.email || null;
        e.tier = u?.tier || null;
        e.tierExpiresAt = u?.tier_expires_at || null;
      }
    }

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
        variant: r?.responses?.variant || null,
        recall: r?.responses?.recall || null,
        q1: r?.responses?.q1 || null,
        q2: r?.responses?.q2 || null,
        q3: r?.responses?.q3 || null,
        q3Label: Q3_LABELS[r?.responses?.q3] || null,
        q3Other: String(r?.responses?.q3Other || "").trim() || null,
        q4: String(r?.responses?.q4 || "").trim() || null,
      }));

    return Response.json({
      ok: true,
      round,
      activeRound: SURVEY_TYPE,
      rounds: [...FIRST_SET_SURVEY_ROUNDS, { key: "all", label: "全部轮次" }],
      stats: {
        submitted: submitted.length,
        dismissed: dismissed.length,
        totalShown,
        completionRate,
      },
      distributions,
      matrices,
      trend,
      comments,
      entries,
      entriesTruncated,
      labels: {
        q1: Q1_LABELS,
        q2: Q2_LABELS,
        q3: Q3_LABELS,
        variant: VARIANT_LABELS,
        recall: RECALL_LABELS,
        cmp: CMP_LABELS,
        abs: ABS_LABELS,
        dim: DIM_LABELS,
      },
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
