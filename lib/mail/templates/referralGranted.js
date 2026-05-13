/**
 * Email template for "your referral worked, +3 days Pro" notifications.
 * Plain text + HTML both rendered. Keep it short and personal — the goal is
 * to make the inviter feel seen, not to upsell.
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

/**
 * @param {object} params
 * @param {string} params.inviterCode    — 6-char code (display only)
 * @param {number} params.daysAdded       — days granted this round (e.g. 3)
 * @param {number} params.totalDaysEarned — running total across all grants
 * @param {string} [params.tierExpiresAt] — ISO date string of new expiry
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildReferralGrantedEmail({ inviterCode, daysAdded, totalDaysEarned, tierExpiresAt }) {
  const subject = `🎁 您的邀请生效啦 · TreePractice 已为您 +${daysAdded} 天 Pro`;
  const expiryLabel = (() => {
    if (!tierExpiresAt) return "";
    try {
      const d = new Date(tierExpiresAt);
      if (!Number.isFinite(d.getTime())) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch { return ""; }
  })();

  const text = [
    `您好，TreePractice 用户 ${inviterCode}：`,
    "",
    `您邀请的好友刚刚完成了首次练习，邀请活动已生效。`,
    `本次奖励：+${daysAdded} 天 Pro`,
    totalDaysEarned ? `累计已获得：${totalDaysEarned} 天 Pro` : "",
    expiryLabel ? `Pro 到期日：${expiryLabel}` : "",
    "",
    `打开 TreePractice 查看：${SITE_URL}`,
    "",
    "继续分享您的邀请链接，每位完成首次练习的好友都将为您带来 +3 天 Pro，没有上限。",
    `您的邀请链接：${SITE_URL}/?ref=${encodeURIComponent(inviterCode)}`,
    "",
    "—— TreePractice 团队",
  ].filter(Boolean).join("\n");

  const safeInviter = escapeHtml(inviterCode);
  const safeLink = escapeHtml(`${SITE_URL}/?ref=${encodeURIComponent(inviterCode)}`);
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
              <div style="font-size:32px;line-height:1;margin-bottom:8px;">🎁</div>
              <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:4px;">您的邀请生效啦</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);">朋友刚刚完成了首次练习</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;">
              <div style="font-size:14px;color:#5a6b62;line-height:1.7;margin-bottom:18px;">
                您好，TreePractice 用户 <strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:1px;color:#087355;">${safeInviter}</strong>：
              </div>
              <div style="background:#ecfdf5;border:1px solid rgba(13,150,104,0.22);border-radius:12px;padding:16px 18px;margin-bottom:18px;">
                <div style="font-size:13px;color:#065f46;margin-bottom:6px;">本次奖励</div>
                <div style="font-size:28px;font-weight:800;color:#087355;line-height:1;">+${Number(daysAdded) || 0} 天 Pro</div>
                ${totalDaysEarned ? `<div style="font-size:12px;color:#0e7c66;margin-top:8px;">累计已获得 <strong>${Number(totalDaysEarned)} 天</strong> Pro 奖励</div>` : ""}
                ${expiryLabel ? `<div style="font-size:12px;color:#0e7c66;margin-top:4px;">Pro 到期日：<strong>${escapeHtml(expiryLabel)}</strong></div>` : ""}
              </div>
              <div style="font-size:13px;color:#5a6b62;line-height:1.7;margin-bottom:18px;">
                继续分享您的邀请链接，每位完成首次练习的好友都将为您带来 <strong>+3 天 Pro</strong>，没有上限。
              </div>
              <div style="background:#f8faf9;border:1px solid #dde5df;border-radius:10px;padding:12px 14px;margin-bottom:22px;font-size:12px;color:#5a6b62;word-break:break-all;">
                您的邀请链接：<br />
                <a href="${safeLink}" style="color:#087355;text-decoration:none;font-family:ui-monospace,Menlo,monospace;">${safeLink}</a>
              </div>
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
                此邮件为活动奖励到账自动通知。如不希望继续接收，可在账户设置中关闭邀请活动邮件提醒。
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
