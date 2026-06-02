import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

import {
  FIRST_SET_SURVEY_TYPE as SURVEY_TYPE,
  FIRST_SET_SURVEY_SINCE,
  FIRST_SET_SURVEY_SNOOZE_SETS,
} from "../../../../lib/survey/firstSetSurveyType";
const REWARD_DAYS = 1;

const submitLimiter = createRateLimiter("survey-first-set-submit", { max: 10 });
const checkLimiter = createRateLimiter("survey-first-set-check", { max: 60 });

function normalizeUserCode(value) {
  return String(value || "").trim().toUpperCase();
}

function daysLeftFromExpiry(tier, tierExpiresAt) {
  if (!tierExpiresAt) return 0;
  if (tier !== "pro" && tier !== "legacy") return 0;
  const expiry = new Date(tierExpiresAt).getTime();
  if (!Number.isFinite(expiry)) return 0;
  const ms = expiry - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export async function GET(request) {
  if (checkLimiter.isLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const url = new URL(request.url);
    const userCode = normalizeUserCode(url.searchParams.get("userCode"));
    if (!userCode) return jsonError(400, "Missing userCode");

    const [{ data: existing }, { count: sessionCount }, { count: priorSessionCount }, { data: user }] =
      await Promise.all([
        supabaseAdmin
          .from("user_surveys")
          .select("id,status,responses")
          .eq("user_code", userCode)
          .eq("survey_type", SURVEY_TYPE)
          .maybeSingle(),
        supabaseAdmin
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_code", userCode)
          // Only sets done in the CURRENT round count — a returning user's
          // pre-refresh history must not trip the survey on bare page load.
          .gte("date", FIRST_SET_SURVEY_SINCE),
        supabaseAdmin
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_code", userCode)
          // Sessions BEFORE the V2 epoch ⇒ this user practiced on the old V1 bank.
          // Same cutoff as lib/history/bankVersion.js, so it agrees with the
          // "V1题库" labels the user already sees in their history.
          .lt("date", FIRST_SET_SURVEY_SINCE),
        supabaseAdmin
          .from("users")
          .select("tier,tier_expires_at")
          .eq("code", userCode)
          .maybeSingle(),
      ]);

    const completedAtLeastOne = (sessionCount || 0) >= 1;
    // A snooze ("再做两套看看") is a dismissed row flagged snoozePending — not a
    // final answer. Re-show it once the user has done a couple more sets.
    const isSnoozePending =
      existing?.status === "dismissed" && existing?.responses?.snoozePending === true;

    let shouldShow = false;
    let alreadyAsked = false;
    if (existing && !isSnoozePending) {
      // Submitted, or a permanent dismiss → never auto-show again.
      alreadyAsked = true;
    } else if (isSnoozePending) {
      // Re-show once the user is SNOOZE_SETS sets past the snooze baseline.
      // Leave alreadyAsked=false so the client keeps re-checking each new set.
      const baseline = Number(existing.responses?.baseline) || 0;
      shouldShow = (sessionCount || 0) >= baseline + FIRST_SET_SURVEY_SNOOZE_SETS;
    } else {
      // No row yet → original gate: show after the first new-bank set.
      shouldShow = completedAtLeastOne;
    }

    const proDaysLeft = user ? daysLeftFromExpiry(user.tier, user.tier_expires_at) : 0;
    // Cohort = which questionnaire to show. Pre-6.2 sessions positively confirm a
    // V1 user; otherwise "new" (the modal still offers a self-report fallback to
    // catch users who did V1 anonymously before logging in).
    const cohort = (priorSessionCount || 0) >= 1 ? "v1" : "new";

    return Response.json({
      ok: true,
      shouldShow,
      alreadyAsked,
      hasSessions: completedAtLeastOne,
      userExists: !!user,
      proDaysLeft,
      rewardDays: REWARD_DAYS,
      cohort,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected error");
  }
}

// Matrix dimension keys / allowed cell values per scale. Mirror the modal.
const V1_DIMS = ["quality", "difficulty", "ai", "similarity"];
const NEW_DIMS = ["quality", "difficulty", "ai", "similarity", "ui"];
const CMP_VALUES = ["better", "same", "worse"];
const ABS_VALUES = ["good", "ok", "bad"];
const FEEL_VALUES = ["better", "same", "worse"];

// Every dimension must carry an allowed value, else the matrix is incomplete → reject.
function validateMatrix(obj, dimKeys, allowed) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const k of dimKeys) {
    const v = String(obj[k] || "").trim();
    if (!allowed.includes(v)) return null;
    out[k] = v;
  }
  return out;
}

// Two questionnaires share this endpoint, distinguished by `variant`:
//   "v1"  → recall (clear/fuzzy) + one matrix (compare vs absolute) + optional text
//   "new" → feel + absolute matrix (5 dims) + Pro-plans + biggest-factor + optional text
function validateResponses(input) {
  if (!input || typeof input !== "object") return null;
  const variant = String(input.variant || "").trim();
  const q4 = String(input.q4 || "").trim().slice(0, 2000) || null;

  if (variant === "v1") {
    const recall = String(input.recall || "").trim();
    if (recall !== "clear" && recall !== "fuzzy") return null;
    if (recall === "clear") {
      const cmp = validateMatrix(input.cmp, V1_DIMS, CMP_VALUES);
      if (!cmp) return null;
      return { variant, recall, cmp, q4 };
    }
    const abs = validateMatrix(input.abs, V1_DIMS, ABS_VALUES);
    if (!abs) return null;
    return { variant, recall, abs, q4 };
  }

  if (variant === "new") {
    const q1 = String(input.q1 || "").trim();
    if (!FEEL_VALUES.includes(q1)) return null;
    const abs = validateMatrix(input.abs, NEW_DIMS, ABS_VALUES);
    if (!abs) return null;
    const q2 = String(input.q2 || "").trim();
    const q3 = String(input.q3 || "").trim();
    const q3Other = String(input.q3Other || "").trim().slice(0, 500);
    if (!q2 || !q3) return null;
    // If user picked "其他" they must explain — otherwise the answer is noise.
    if (q3 === "other" && !q3Other) return null;
    return {
      variant,
      q1,
      abs,
      q2: q2.slice(0, 60),
      q3: q3.slice(0, 60),
      q3Other: q3Other || null,
      q4,
    };
  }

  return null;
}

async function userExists(userCode) {
  const { data } = await supabaseAdmin
    .from("users")
    .select("code")
    .eq("code", userCode)
    .maybeSingle();
  return !!data;
}

async function extendProByOneDay(userCode) {
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at")
    .eq("code", userCode)
    .maybeSingle();
  if (!user) return { ok: false, reason: "user_not_found" };

  const now = new Date();
  let baseDate = now;
  if ((user.tier === "pro" || user.tier === "legacy") && user.tier_expires_at) {
    const currentExpiry = new Date(user.tier_expires_at);
    if (currentExpiry > now) baseDate = currentExpiry;
  }
  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + REWARD_DAYS);

  const nextTier = user.tier === "legacy" ? "legacy" : "pro";
  const { error } = await supabaseAdmin
    .from("users")
    .update({ tier: nextTier, tier_expires_at: expiresAt.toISOString() })
    .eq("code", userCode);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, expiresAt: expiresAt.toISOString() };
}

export async function POST(request) {
  if (submitLimiter.isLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const body = await request.json().catch(() => ({}));
    const userCode = normalizeUserCode(body?.userCode);
    if (!userCode) return jsonError(400, "Missing userCode");

    const responses = validateResponses(body?.responses);
    if (!responses) return jsonError(400, "Missing or invalid responses");

    if (!(await userExists(userCode))) return jsonError(404, "User not found");

    // Look up any existing row so we can distinguish three cases:
    //  - no row → insert submitted + grant reward
    //  - row with status='dismissed' → user changed mind (or multi-tab race);
    //    upgrade to submitted + grant reward
    //  - row with status='submitted' → idempotent: already rewarded, no-op
    const { data: existing } = await supabaseAdmin
      .from("user_surveys")
      .select("id,status")
      .eq("user_code", userCode)
      .eq("survey_type", SURVEY_TYPE)
      .maybeSingle();

    if (existing?.status === "submitted") {
      return Response.json({ ok: true, alreadyAsked: true });
    }

    if (existing?.status === "dismissed") {
      const { error: updateError } = await supabaseAdmin
        .from("user_surveys")
        .update({ status: "submitted", responses })
        .eq("id", existing.id);
      if (updateError) return jsonError(400, updateError.message || "Update survey failed");
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("user_surveys")
        .insert({
          user_code: userCode,
          survey_type: SURVEY_TYPE,
          status: "submitted",
          responses,
        });
      if (insertError) {
        const message = String(insertError.message || "");
        if (message.toLowerCase().includes("duplicate")) {
          // Lost the race with another tab — safe to treat as already done.
          return Response.json({ ok: true, alreadyAsked: true });
        }
        return jsonError(400, message || "Insert survey failed");
      }
    }

    const reward = await extendProByOneDay(userCode);
    return Response.json({
      ok: true,
      rewardDays: REWARD_DAYS,
      tierExpiresAt: reward.ok ? reward.expiresAt : null,
      rewardError: reward.ok ? null : reward.reason,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
