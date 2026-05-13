/**
 * Referral service: bind → activate → grant lifecycle.
 *
 * Single-sided reward model:
 *  - Invitee keeps existing auto-3-day Pro trial (pro_trial flag). No referral reward.
 *  - Inviter gets +3 days Pro stacked on tier_expires_at, after invitee activates
 *    (≥1 saved practice session). No upper cap — rewards accumulate indefinitely.
 *
 * Anti-abuse:
 *  - Self-ref: inviter_code === invitee_code → reject
 *  - IP flood: same invitee_ip bound a referral in the last 24h → reject
 *  - Idempotent: same invitee_code can only bind once (UNIQUE constraint)
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";
import { createLogger } from "../logger";
import { sendMail, isMailConfigured } from "../mail/send";
import { buildReferralGrantedEmail } from "../mail/templates/referralGranted";

const log = createLogger("referral");

export const REWARD_DAYS_PER_REFERRAL = 3;
export const SAME_IP_COOLDOWN_HOURS = 24;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

// ─────────────────────────────────────────────────────────
// Bind: called at signup when invitee has an inviter code.
// Returns { ok, status, reason? }
// ─────────────────────────────────────────────────────────
export async function bindReferral({ inviterCode, inviteeCode, inviteeIp, source }) {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, reason: "supabase_unavailable" };
  }

  const inviter = normalizeCode(inviterCode);
  const invitee = normalizeCode(inviteeCode);

  if (!inviter || inviter.length !== 6) return { ok: false, reason: "invalid_inviter" };
  if (!invitee || invitee.length !== 6) return { ok: false, reason: "invalid_invitee" };
  if (inviter === invitee)              return { ok: false, reason: "self_ref" };

  // 1. Inviter must exist in users table
  const { data: inviterRow, error: inviterErr } = await supabaseAdmin
    .from("users")
    .select("code")
    .eq("code", inviter)
    .maybeSingle();
  if (inviterErr) {
    log.error("Inviter lookup failed", { inviter, error: inviterErr.message });
    return { ok: false, reason: "db_error" };
  }
  if (!inviterRow) return { ok: false, reason: "inviter_not_found" };

  // 2. Idempotency: invitee already has a referral row?
  const { data: existing } = await supabaseAdmin
    .from("referrals")
    .select("id, inviter_code, status")
    .eq("invitee_code", invitee)
    .maybeSingle();
  if (existing) {
    return { ok: true, status: existing.status, reason: "already_bound", existing: true };
  }

  // 3. IP flood check (same IP bound someone in last 24h)
  if (inviteeIp) {
    const cutoff = new Date(Date.now() - SAME_IP_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("invitee_ip", inviteeIp)
      .gte("bound_at", cutoff);
    if ((count || 0) > 0) {
      log.warn("IP flood blocked", { inviter, invitee, ip: inviteeIp });
      return { ok: false, reason: "ip_flood" };
    }
  }

  // 4. Insert as pending
  const { error: insertErr } = await supabaseAdmin
    .from("referrals")
    .insert({
      inviter_code: inviter,
      invitee_code: invitee,
      invitee_ip: inviteeIp || null,
      source: source || "manual",
      status: "pending",
    });
  if (insertErr) {
    // Unique violation = race against parallel bind for same invitee
    if (insertErr.code === "23505") {
      return { ok: true, status: "pending", reason: "already_bound", existing: true };
    }
    log.error("Referral insert failed", { inviter, invitee, error: insertErr.message });
    return { ok: false, reason: "db_error" };
  }

  log.info("Referral bound", { inviter, invitee, source });
  return { ok: true, status: "pending" };
}

// ─────────────────────────────────────────────────────────
// Activate: called after invitee's first successful session save.
// Idempotent — safe to call repeatedly.
// Returns { ok, granted?, daysAdded?, reason? }
// ─────────────────────────────────────────────────────────
export async function activateReferral({ inviteeCode }) {
  if (!isSupabaseAdminConfigured) return { ok: false, reason: "supabase_unavailable" };

  const invitee = normalizeCode(inviteeCode);
  if (!invitee) return { ok: false, reason: "invalid_invitee" };

  // 1. Look up referral row
  const { data: ref, error: refErr } = await supabaseAdmin
    .from("referrals")
    .select("id, inviter_code, status")
    .eq("invitee_code", invitee)
    .maybeSingle();
  if (refErr) {
    log.error("Referral lookup failed", { invitee, error: refErr.message });
    return { ok: false, reason: "db_error" };
  }
  if (!ref) return { ok: true, reason: "no_referral" };       // no inviter, fine
  if (ref.status === "granted") return { ok: true, reason: "already_granted" };
  if (ref.status === "rejected") return { ok: true, reason: "rejected" };

  // 2. Anti-abuse: verify invitee has ≥1 saved session AFTER binding.
  // Stops "create 10 fake accounts, immediately call activate" pattern.
  const { count: sessionCount, error: sessionErr } = await supabaseAdmin
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_code", invitee);
  if (sessionErr) {
    log.error("Session count failed during activation", { invitee, error: sessionErr.message });
    return { ok: false, reason: "db_error" };
  }
  if ((sessionCount || 0) < 1) {
    return { ok: true, granted: false, reason: "no_practice_yet" };
  }

  // 3. Mark activated (audit trail)
  await supabaseAdmin
    .from("referrals")
    .update({ status: "activated", activated_at: new Date().toISOString() })
    .eq("id", ref.id);

  // 4. Grant Pro to inviter (stacking on existing tier_expires_at)
  const grantResult = await grantProToInviter(ref.inviter_code, REWARD_DAYS_PER_REFERRAL);
  if (!grantResult.ok) {
    log.error("Grant failed; leaving referral as activated", { id: ref.id, reason: grantResult.reason });
    return { ok: false, granted: false, reason: grantResult.reason };
  }

  // 5. Mark granted
  await supabaseAdmin
    .from("referrals")
    .update({ status: "granted", rewards_granted_at: new Date().toISOString() })
    .eq("id", ref.id);

  log.info("Referral granted", { id: ref.id, inviter: ref.inviter_code, invitee, daysAdded: REWARD_DAYS_PER_REFERRAL });

  // 6. Notify inviter by email (best-effort, never blocks the grant flow).
  // We deliberately don't await this — even if the email queue is backed up
  // or SMTP is unreachable, the user-facing activation result should not be
  // delayed. Errors surface in the mail logger only.
  notifyInviterByEmail({
    inviterCode: ref.inviter_code,
    daysAdded: REWARD_DAYS_PER_REFERRAL,
    newExpiry: grantResult?.until || null,
  }).catch((e) => {
    log.error("Referral notification email crashed", { inviter: ref.inviter_code, error: e?.message });
  });

  return { ok: true, granted: true, daysAdded: REWARD_DAYS_PER_REFERRAL, inviterCode: ref.inviter_code };
}

/**
 * Best-effort email to the inviter when a referral grant lands. Skips if
 * mail isn't configured (so dev environments don't try to send). Reads the
 * inviter's bound email + opt-out preference from the users table.
 */
async function notifyInviterByEmail({ inviterCode, daysAdded, newExpiry }) {
  if (!isMailConfigured()) {
    log.info("Mail not configured — skipping referral grant notification", { inviter: inviterCode });
    return;
  }

  // Pull inviter's email + opt-out + cumulative count
  const { data: inviter, error: inviterErr } = await supabaseAdmin
    .from("users")
    .select("email, email_optout_referral")
    .eq("code", inviterCode)
    .maybeSingle();
  if (inviterErr) {
    log.error("Inviter lookup for email failed", { inviter: inviterCode, error: inviterErr.message });
    return;
  }
  if (!inviter?.email) {
    // No email bound (code-only user) — nothing to send to
    log.info("Inviter has no email on file — skipping notification", { inviter: inviterCode });
    return;
  }
  if (inviter.email_optout_referral) {
    log.info("Inviter has opted out of referral emails — skipping", { inviter: inviterCode });
    return;
  }

  // Count cumulative grants (this one is already counted since we marked
  // granted before calling here)
  const { count: grantedCount } = await supabaseAdmin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("inviter_code", inviterCode)
    .eq("status", "granted");
  const totalDaysEarned = (grantedCount || 1) * REWARD_DAYS_PER_REFERRAL;

  const { subject, text, html } = buildReferralGrantedEmail({
    inviterCode,
    daysAdded,
    totalDaysEarned,
    tierExpiresAt: newExpiry,
  });

  const result = await sendMail({ to: inviter.email, subject, text, html });
  if (!result.ok) {
    log.warn("Failed to send referral grant email", {
      inviter: inviterCode, error: result.error, skipped: result.skipped,
    });
  } else {
    log.info("Sent referral grant email", { inviter: inviterCode, messageId: result.messageId });
  }
}

// ─────────────────────────────────────────────────────────
// Internal: extend inviter's tier_expires_at by N days (stacking-aware).
// Mirrors the logic in lib/iap/service.js upgradeTierAfterPurchase, but
// scoped to referral rewards.
// ─────────────────────────────────────────────────────────
async function grantProToInviter(inviterCode, days) {
  const { data: user, error: lookupErr } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at")
    .eq("code", inviterCode)
    .maybeSingle();
  if (lookupErr) return { ok: false, reason: "lookup_failed" };
  if (!user) return { ok: false, reason: "inviter_missing" };

  // Legacy users have lifetime access — referral reward is a no-op for them.
  if (user.tier === "legacy") return { ok: true, skipped: "legacy" };

  // Stack: if currently Pro with unexpired tier, extend from existing expiry.
  const now = new Date();
  let base = now;
  if (user.tier === "pro" && user.tier_expires_at) {
    const currentExpiry = new Date(user.tier_expires_at);
    if (currentExpiry > now) base = currentExpiry;
  }
  const newExpiry = new Date(base);
  newExpiry.setDate(newExpiry.getDate() + days);

  const { error: updateErr } = await supabaseAdmin
    .from("users")
    .update({ tier: "pro", tier_expires_at: newExpiry.toISOString() })
    .eq("code", inviterCode);

  if (updateErr) {
    log.error("Inviter tier update failed", { inviterCode, error: updateErr.message });
    return { ok: false, reason: "update_failed" };
  }
  return { ok: true, until: newExpiry.toISOString() };
}

// ─────────────────────────────────────────────────────────
// Stats: for the "我的邀请" sidebar widget.
// ─────────────────────────────────────────────────────────
export async function getReferralStats(inviterCode) {
  if (!isSupabaseAdminConfigured) return null;
  const inviter = normalizeCode(inviterCode);
  if (!inviter) return null;

  const { data, error } = await supabaseAdmin
    .from("referrals")
    .select("status")
    .eq("inviter_code", inviter);
  if (error) {
    log.error("Stats query failed", { inviter, error: error.message });
    return null;
  }

  const rows = data || [];
  const grantedCount = rows.filter((r) => r.status === "granted").length;
  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "activated").length;
  return {
    grantedCount,
    pendingCount,
    daysEarned: grantedCount * REWARD_DAYS_PER_REFERRAL,
    rewardDaysPerReferral: REWARD_DAYS_PER_REFERRAL,
  };
}
