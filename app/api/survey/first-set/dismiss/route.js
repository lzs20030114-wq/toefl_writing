import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../../lib/rateLimit";
import { jsonError } from "../../../../../lib/apiResponse";
import {
  FIRST_SET_SURVEY_TYPE as SURVEY_TYPE,
  FIRST_SET_SURVEY_SINCE,
} from "../../../../../lib/survey/firstSetSurveyType";

const limiter = createRateLimiter("survey-first-set-dismiss", { max: 10 });

// This route handles the two "close" actions on the first-set survey:
//   mode = "dismiss" (default, the × button) → permanent: never auto-shown again.
//   mode = "snooze"  (the「再做两套看看」button) → ask again after a couple more sets.
//
// A snooze is stored as a dismissed row flagged { snoozePending: true } (avoids a
// schema change for a new status value). The check route treats such a row as
// "re-show after FIRST_SET_SURVEY_SNOOZE_SETS more sessions", and the admin stats
// exclude it so a snooze isn't counted as a hard dismissal. The snooze fires at
// most once: a second snooze — or the × — clears the flag → permanent dismiss.
export async function POST(request) {
  if (limiter.isLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const body = await request.json().catch(() => ({}));
    const userCode = String(body?.userCode || "").trim().toUpperCase();
    if (!userCode) return jsonError(400, "Missing userCode");
    const mode = body?.mode === "snooze" ? "snooze" : "dismiss";

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("code")
      .eq("code", userCode)
      .maybeSingle();
    if (!user) return jsonError(404, "User not found");

    const { data: existing } = await supabaseAdmin
      .from("user_surveys")
      .select("id,status,responses")
      .eq("user_code", userCode)
      .eq("survey_type", SURVEY_TYPE)
      .maybeSingle();

    // Already submitted → nothing to do, keep the answers.
    if (existing?.status === "submitted") {
      return Response.json({ ok: true, alreadyAsked: true });
    }

    if (mode === "snooze") {
      if (!existing) {
        // First snooze → record a pending snooze with the current new-bank
        // session count as a baseline; the check route re-shows once the user
        // is FIRST_SET_SURVEY_SNOOZE_SETS sets past it (robust integer compare,
        // no timestamp-format pitfalls).
        const { count: baseline } = await supabaseAdmin
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_code", userCode)
          .gte("date", FIRST_SET_SURVEY_SINCE);
        const { error } = await supabaseAdmin.from("user_surveys").insert({
          user_code: userCode,
          survey_type: SURVEY_TYPE,
          status: "dismissed",
          responses: { snoozePending: true, baseline: baseline || 0 },
        });
        if (error) {
          const message = String(error.message || "");
          if (message.toLowerCase().includes("duplicate")) return Response.json({ ok: true });
          return jsonError(400, message || "Snooze failed");
        }
        return Response.json({ ok: true, snoozed: true });
      }
      if (existing.responses?.snoozePending) {
        // Second snooze → cap reached, convert to a permanent dismiss.
        const { error } = await supabaseAdmin
          .from("user_surveys")
          .update({ responses: null })
          .eq("id", existing.id);
        if (error) return jsonError(400, error.message || "Snooze cap failed");
        return Response.json({ ok: true, dismissed: true });
      }
      // Already permanently dismissed.
      return Response.json({ ok: true, alreadyAsked: true });
    }

    // mode === "dismiss" (× button) → permanent dismiss.
    if (existing) {
      const { error } = await supabaseAdmin
        .from("user_surveys")
        .update({ status: "dismissed", responses: null })
        .eq("id", existing.id);
      if (error) return jsonError(400, error.message || "Dismiss failed");
      return Response.json({ ok: true });
    }
    const { error } = await supabaseAdmin.from("user_surveys").insert({
      user_code: userCode,
      survey_type: SURVEY_TYPE,
      status: "dismissed",
      responses: null,
    });
    if (error) {
      const message = String(error.message || "");
      if (message.toLowerCase().includes("duplicate")) {
        return Response.json({ ok: true, alreadyAsked: true });
      }
      return jsonError(400, message || "Insert dismiss failed");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
