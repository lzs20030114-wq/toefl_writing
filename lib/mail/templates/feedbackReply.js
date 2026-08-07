/**
 * Email template for "the developer replied to your feedback" notifications.
 * Sent from the admin feedback dashboard when the admin saves a reply with
 * the "同步发送到用户邮箱" option checked. Quotes the user's original
 * feedback so the email is self-contained, then shows the reply.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://treepractice.com";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(escaped) {
  return escaped.replace(/\r?\n/g, "<br />");
}

function clip(s, n) {
  const str = String(s || "");
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

function formatDateLabel(v) {
  if (!v) return "";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * @param {object} params
 * @param {string} params.userCode         — 6-char code (display only)
 * @param {string} params.feedbackContent  — the user's original feedback text
 * @param {string} [params.feedbackDate]   — ISO timestamp of the feedback
 * @param {string} params.replyContent     — the admin's reply text
 * @param {boolean} [params.resolved]      — feedback marked as resolved
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildFeedbackReplyEmail({ userCode, feedbackContent, feedbackDate, replyContent, resolved }) {
  const subject = "💬 您的反馈有回复了 · TreePractice";
  const dateLabel = formatDateLabel(feedbackDate);
  const quotedFeedback = clip(feedbackContent, 400);

  const textParts = [
    `您好，TreePractice 用户 ${userCode}：`,
    "",
    `您${dateLabel ? `在 ${dateLabel} ` : ""}提交的反馈我们已经处理，以下是开发者的回复。`,
    "",
    "【您的反馈】",
    quotedFeedback,
    "",
    "【开发者回复】",
    String(replyContent || ""),
  ];
  if (resolved) {
    textParts.push("", "该反馈涉及的问题已处理完成，欢迎打开应用体验。");
  }
  textParts.push(
    "",
    `打开 TreePractice：${SITE_URL}`,
    "",
    "如需继续沟通，直接回复本邮件，或在应用内「反馈」入口再次留言。",
    "",
    "—— TreePractice 团队",
  );
  const text = textParts.join("\n");

  const safeCode = escapeHtml(userCode);
  const safeFeedback = nl2br(escapeHtml(quotedFeedback));
  const safeReply = nl2br(escapeHtml(replyContent));
  const html = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1a2420;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#087355,#0891B2);padding:28px 28px 22px;text-align:center;">
              <div style="font-size:32px;line-height:1;margin-bottom:8px;">💬</div>
              <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:4px;">您的反馈有回复了</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);">感谢您帮助 TreePractice 变得更好</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;">
              <div style="font-size:14px;color:#5a6b62;line-height:1.7;margin-bottom:18px;">
                您好，TreePractice 用户 <strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:1px;color:#087355;">${safeCode}</strong>：
              </div>
              <div style="background:#f8faf9;border-left:3px solid #cbd5d0;border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:16px;">
                <div style="font-size:11px;color:#9aa49f;margin-bottom:6px;">您${dateLabel ? `在 ${escapeHtml(dateLabel)} ` : ""}提交的反馈</div>
                <div style="font-size:13px;color:#5a6b62;line-height:1.7;">${safeFeedback}</div>
              </div>
              <div style="background:#ecfdf5;border:1px solid rgba(13,150,104,0.22);border-radius:12px;padding:16px 18px;margin-bottom:18px;">
                <div style="font-size:12px;font-weight:700;color:#065f46;margin-bottom:8px;">✍️ 开发者回复</div>
                <div style="font-size:14px;color:#1a2420;line-height:1.8;">${safeReply}</div>
              </div>
              ${resolved ? `
              <div style="text-align:center;margin-bottom:18px;">
                <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:#dcfce7;border:1px solid #86efac;color:#15803d;font-size:12px;font-weight:700;">✓ 该问题已处理完成</span>
              </div>` : ""}
              <div style="text-align:center;margin-bottom:12px;">
                <a href="${escapeHtml(SITE_URL)}"
                   style="display:inline-block;padding:12px 28px;border-radius:10px;background:linear-gradient(135deg,#087355,#0891B2);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
                  打开 TreePractice
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 28px;border-top:1px solid #f0f4f1;">
              <div style="font-size:11px;color:#9aa49f;text-align:center;line-height:1.6;">
                此邮件由开发者在处理您的反馈后手动发送。如需继续沟通，直接回复本邮件，或在应用内「反馈」入口再次留言。
                <br />— TreePractice 团队
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, text, html };
}
