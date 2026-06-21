import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";
import {
  VOICE_VOTE_TYPE,
  VOICE_VOTE_CHOICES,
} from "../../../../lib/survey/voiceUpgradeVoteType";

// Voice-upgrade A/B vote intake. Writes one row per voter into `user_surveys`
// (survey_type=VOICE_VOTE_TYPE); the unique(user_code, survey_type) constraint
// dedups, so a re-submit is a no-op rather than a double count.
//
// Identity: logged-in users send their login code; anonymous visitors send a
// per-browser id the client generated (the table has NO foreign key on
// user_code, so anon ids insert fine). responses.loggedIn records which it was.

const voteLimiter = createRateLimiter("voice-vote-submit", { max: 20 });

function normalizeVoterId(value) {
  // Accept login codes (upper-cased like the rest of the app) and client anon
  // ids ("anon_..."). Cap length to keep junk out of the table.
  return String(value || "").trim().slice(0, 64);
}

export async function POST(request) {
  if (voteLimiter.isLimited(getIp(request))) {
    return jsonError(429, "Too many requests");
  }
  try {
    if (!isSupabaseAdminConfigured) {
      return jsonError(503, "Supabase admin is not configured");
    }

    const body = await request.json().catch(() => ({}));
    const voterId = normalizeVoterId(body?.userCode);
    if (!voterId) return jsonError(400, "Missing userCode");

    const dismiss = body?.dismiss === true;
    const choice = String(body?.choice || "").trim();
    if (!dismiss && !VOICE_VOTE_CHOICES.includes(choice)) {
      return jsonError(400, "Invalid choice");
    }

    const loggedIn = !/^anon_/i.test(voterId);
    const status = dismiss ? "dismissed" : "submitted";
    const responses = dismiss ? { dismissed: true } : { choice, loggedIn };

    // Was this voter already recorded? A real vote is final (idempotent); a prior
    // "dismissed" row can still be upgraded to a vote if the user reopens and votes.
    const { data: existing } = await supabaseAdmin
      .from("user_surveys")
      .select("id,status")
      .eq("user_code", voterId)
      .eq("survey_type", VOICE_VOTE_TYPE)
      .maybeSingle();

    if (existing?.status === "submitted") {
      // Already voted — never overwrite or double-count.
      return Response.json({ ok: true, alreadyVoted: true });
    }

    if (existing) {
      // Existing 'dismissed' row → upgrade to the vote (or keep dismissed).
      const { error } = await supabaseAdmin
        .from("user_surveys")
        .update({ status, responses })
        .eq("id", existing.id);
      if (error) return jsonError(400, error.message || "Update vote failed");
      return Response.json({ ok: true });
    }

    const { error: insertError } = await supabaseAdmin
      .from("user_surveys")
      .insert({ user_code: voterId, survey_type: VOICE_VOTE_TYPE, status, responses });
    if (insertError) {
      // Lost a multi-tab race against another insert → already counted, treat as ok.
      if (String(insertError.message || "").toLowerCase().includes("duplicate")) {
        return Response.json({ ok: true, alreadyVoted: true });
      }
      return jsonError(400, insertError.message || "Insert vote failed");
    }

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
