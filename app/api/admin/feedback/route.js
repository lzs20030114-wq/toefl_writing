import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";
import { sendMail, isMailConfigured } from "../../../../lib/mail/send";
import { buildFeedbackReplyEmail } from "../../../../lib/mail/templates/feedbackReply";

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const userCode = String(url.searchParams.get("userCode") || "").trim().toUpperCase();

    let query = supabaseAdmin
      .from("user_feedback")
      .select("id,user_code,content,page,origin,user_agent,client_ip,created_at,status,admin_reply")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (userCode) query = query.eq("user_code", userCode);

    const { data, error } = await query;
    if (error) return jsonError(400, error.message || "List feedback failed");

    // Attach the submitter's email (if bound) so the dashboard can offer
    // "同步发送到用户邮箱" only when there is somewhere to send.
    const rows = data || [];
    const codes = [...new Set(rows.map((r) => r.user_code).filter(Boolean))];
    const emailByCode = {};
    if (codes.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("code,email")
        .in("code", codes);
      (users || []).forEach((u) => {
        if (u.code) emailByCode[u.code] = u.email || null;
      });
    }

    return Response.json({
      rows: rows.map((r) => ({ ...r, user_email: emailByCode[r.user_code] || null })),
      mailConfigured: isMailConfigured(),
      stats: {
        total: rows.length,
      },
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function PATCH(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    const body = await request.json().catch(() => ({}));
    const id = Number(body?.id);
    if (!id) return jsonError(400, "Missing id");
    const updates = {};
    if (body.status !== undefined) updates.status = String(body.status).slice(0, 50);
    if (body.admin_reply !== undefined) updates.admin_reply = body.admin_reply ? String(body.admin_reply).slice(0, 1000) : null;
    if (Object.keys(updates).length === 0) return jsonError(400, "No fields to update");
    const { error } = await supabaseAdmin.from("user_feedback").update(updates).eq("id", id);
    if (error) return jsonError(400, error.message);

    // Optionally forward the saved reply to the user's mailbox. The reply is
    // already persisted at this point — a mail failure never fails the PATCH,
    // it just comes back in `email` for the dashboard to surface.
    let email = null;
    if (body.sendEmail === true) {
      email = await sendReplyEmail(id, updates.admin_reply);
    }

    return Response.json({ ok: true, email });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

async function sendReplyEmail(id, replyContent) {
  if (!replyContent) return { sent: false, error: "回复内容为空，未发送邮件" };
  if (!isMailConfigured()) return { sent: false, error: "邮件服务未配置（MAIL_USER / MAIL_PASS）" };

  const { data: fb, error: fbErr } = await supabaseAdmin
    .from("user_feedback")
    .select("user_code,content,created_at,status")
    .eq("id", id)
    .maybeSingle();
  if (fbErr || !fb) return { sent: false, error: fbErr?.message || "反馈记录不存在" };
  if (!fb.user_code) return { sent: false, error: "反馈无关联用户码" };

  const { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("code", fb.user_code)
    .maybeSingle();
  if (userErr) return { sent: false, error: userErr.message };
  if (!user?.email) return { sent: false, error: "该用户未绑定邮箱" };

  const { subject, text, html } = buildFeedbackReplyEmail({
    userCode: fb.user_code,
    feedbackContent: fb.content,
    feedbackDate: fb.created_at,
    replyContent,
    resolved: fb.status === "resolved",
  });

  const result = await sendMail({ to: user.email, subject, text, html });
  if (!result.ok) return { sent: false, error: result.error || "发送失败" };
  return { sent: true, to: user.email };
}
