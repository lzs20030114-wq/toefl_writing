import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";
import { VOICE_VOTE_TYPE } from "../../../../lib/survey/voiceUpgradeVoteType";

// Admin tally for the voice-upgrade A/B vote. Returns upgrade/keep counts (the
// real signal) plus dismissed/total/loggedIn breakdown for context.
//
//   GET /api/admin/voice-vote   (x-admin-token: <ADMIN_DASHBOARD_TOKEN>)
export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) {
      return jsonError(503, "Supabase admin is not configured");
    }

    const { data, error } = await supabaseAdmin
      .from("user_surveys")
      .select("status,responses,created_at")
      .eq("survey_type", VOICE_VOTE_TYPE)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) return jsonError(400, error.message || "List votes failed");

    const rows = data || [];
    let upgrade = 0;
    let keep = 0;
    let dismissed = 0;
    let loggedInVotes = 0;
    for (const r of rows) {
      if (r.status === "dismissed") {
        dismissed += 1;
        continue;
      }
      const choice = r?.responses?.choice;
      if (choice === "upgrade") upgrade += 1;
      else if (choice === "keep") keep += 1;
      if (r?.responses?.loggedIn) loggedInVotes += 1;
    }

    const votes = upgrade + keep;
    const pct = (n) => (votes > 0 ? Math.round((n / votes) * 1000) / 10 : 0);

    return Response.json({
      ok: true,
      surveyType: VOICE_VOTE_TYPE,
      votes,
      upgrade,
      keep,
      upgradePct: pct(upgrade),
      keepPct: pct(keep),
      dismissed,
      shown: votes + dismissed,
      loggedInVotes,
      anonVotes: votes - loggedInVotes,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
