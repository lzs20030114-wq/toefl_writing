import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../../lib/rateLimit";
import { jsonError } from "../../../../../lib/apiResponse";
import { FIRST_SET_SURVEY_TYPE as SURVEY_TYPE } from "../../../../../lib/survey/firstSetSurveyType";

const limiter = createRateLimiter("survey-first-set-dismiss", { max: 10 });

export async function POST(request) {
  if (limiter.isLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const body = await request.json().catch(() => ({}));
    const userCode = String(body?.userCode || "").trim().toUpperCase();
    if (!userCode) return jsonError(400, "Missing userCode");

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("code")
      .eq("code", userCode)
      .maybeSingle();
    if (!user) return jsonError(404, "User not found");

    const { error } = await supabaseAdmin
      .from("user_surveys")
      .insert({
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
