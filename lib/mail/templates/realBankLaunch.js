/**
 * Email template for the v1.18.0 "真题专区上线" broadcast.
 *
 * One-off product announcement sent to every user with an email on file
 * (scripts/ops/send-real-bank-announcement.mjs). Pro users get a "去做真题"
 * CTA that deep-links into /real-bank; free users get the same content with
 * an "升级 Pro 解锁" CTA, since the section is Pro-only.
 *
 * Plain text + HTML both rendered. Copy mirrors data/announcements.json
 * (2026-09-08-v1.18.0) — keep the two in sync when numbers change.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://treepractice.com";

/**
 * 题量快照（__tests__/real-bank-launch-email.test.js 锁它与线上题库一致）。
 * 2026-09-10 阅读 CTW 截断卷回收 +29 篇、09-11 听力对话人工标性别 +16 段、1.28A M1 新源补录 +5 条短应答后更新；data/announcements.json 的 v1.18.0 条目是发版当时的数字，未改。
 */
export const REAL_BANK_LAUNCH_COUNTS = {
  total: 1267,
  writing: { total: 440, discussion: 132, email: 27, bs: 281, bsSets: 36 },
  reading: { total: 325, ap: 99, rdl: 110, ctw: 116 },
  listening: 440,
  speaking: 62,
};

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
 * @param {string} [params.userCode]  — 6-char code (display only; omitted → generic greeting)
 * @param {boolean} params.isPro       — whether the recipient currently has Pro access
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildRealBankLaunchEmail({ userCode, isPro } = {}) {
  const C = REAL_BANK_LAUNCH_COUNTS;
  const subject = `📜 真题专区上线：${C.total} 道真题，写作阅读听力口语全覆盖 · TreePractice`;
  const realBankUrl = `${SITE_URL}/real-bank`;
  const ctaLabel = isPro ? "去做真题" : "升级 Pro，解锁真题专区";
  const greeting = userCode ? `您好，TreePractice 用户 ${userCode}：` : "您好：";

  const items = [
    {
      icon: "📜",
      title: "新增「真题专区」（Pro 专属）",
      body:
        `覆盖写作、阅读、听力、口语全部 12 种题型，共 ${C.total} 题。` +
        `写作 ${C.writing.total} 题（学术讨论 ${C.writing.discussion}、邮件 ${C.writing.email}、造句 ${C.writing.bsSets} 套 ${C.writing.bs} 题）、` +
        `阅读 ${C.reading.total} 篇（学术阅读 ${C.reading.ap}、长阅读 ${C.reading.rdl}、单词补全 ${C.reading.ctw}）、` +
        `听力 ${C.listening} 段、口语 ${C.speaking} 套。首页新增真题入口，做过的题会打「已练」标记。`,
    },
    {
      icon: "🏷️",
      title: "每道题标注来源",
      body: "ETS 官方原题、2026 考生回忆版、早期参考版，选题卡和答题页顶部都能看到，一眼知道这题从哪来。",
    },
    {
      icon: "🖼️",
      title: "阅读真题还原原卷版面",
      body: "通知、海报、邮件等材料按考场截图原样呈现，可在图文之间切换。",
    },
    {
      icon: "⏱️",
      title: "支持三档模式",
      body: "Standard 与常规练习同一套限时，Practice 不限时自选题，Challenge 压缩限时冲刺。",
    },
  ];

  const text = [
    greeting,
    "",
    "TreePractice v1.18.0 更新了「真题专区」，本次更新内容如下：",
    "",
    ...items.map((it) => `${it.icon} ${it.title}：${it.body}`),
    "",
    isPro
      ? `您已是 Pro 用户，真题专区已对您开放：${realBankUrl}`
      : `真题专区为 Pro 专属功能，升级后即可解锁：${realBankUrl}`,
    "",
    "题目有误、答案存疑，欢迎在 App 内「反馈」告诉我们，每一条都会核对。",
    "",
    "—— TreePractice 团队",
  ].join("\n");

  const safeCode = escapeHtml(userCode || "");
  const safeUrl = escapeHtml(realBankUrl);
  const safeSite = escapeHtml(SITE_URL);

  const statCell = (num, label) => `
    <td align="center" style="padding:10px 4px;">
      <div style="font-size:22px;font-weight:800;color:#B45309;line-height:1;">${num}</div>
      <div style="font-size:11px;color:#7c6a55;margin-top:6px;">${label}</div>
    </td>`;

  const itemRow = (it) => `
    <tr>
      <td style="padding:0 0 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
          <tr>
            <td width="32" valign="top" style="font-size:20px;line-height:1.3;">${it.icon}</td>
            <td valign="top">
              <div style="font-size:14px;font-weight:700;color:#1a2420;margin-bottom:4px;">${escapeHtml(it.title)}</div>
              <div style="font-size:13px;color:#5a6b62;line-height:1.7;">${escapeHtml(it.body)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const html = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#1a2420;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">写作 ${C.writing.total} 题 · 阅读 ${C.reading.total} 篇 · 听力 ${C.listening} 段 · 口语 ${C.speaking} 套，每道题标注来源，阅读还原原卷版面。</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#B45309,#D97706);padding:30px 28px 24px;text-align:center;">
              <div style="font-size:34px;line-height:1;margin-bottom:10px;">📜</div>
              <div style="font-size:12px;letter-spacing:2px;color:rgba(255,255,255,0.8);margin-bottom:6px;">TREEPRACTICE · v1.18.0</div>
              <div style="font-size:22px;font-weight:800;color:#ffffff;margin-bottom:6px;">真题专区上线</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.9);">${C.total} 道真题，写作 · 阅读 · 听力 · 口语全覆盖</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 0;">
              <div style="font-size:14px;color:#5a6b62;line-height:1.7;margin-bottom:16px;">
                ${userCode ? `您好，TreePractice 用户 <strong style="font-family:ui-monospace,Menlo,monospace;letter-spacing:1px;color:#B45309;">${safeCode}</strong>：` : "您好："}
                <br />TreePractice v1.18.0 更新了「真题专区」，本次更新内容如下。
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF7ED;border:1px solid rgba(180,83,9,0.22);border-radius:12px;margin-bottom:22px;">
                <tr>
                  ${statCell(C.writing.total, "写作 · 题")}
                  ${statCell(C.reading.total, "阅读 · 篇")}
                  ${statCell(C.listening, "听力 · 段")}
                  ${statCell(C.speaking, "口语 · 套")}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${items.map(itemRow).join("")}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 28px 8px;text-align:center;">
              ${isPro
                ? ""
                : `<div style="font-size:12px;color:#7c6a55;margin-bottom:12px;">真题专区为 Pro 专属功能，升级后即可解锁全部 ${C.total} 题。</div>`}
              <a href="${safeUrl}"
                 style="display:inline-block;padding:13px 30px;border-radius:10px;background:linear-gradient(135deg,#B45309,#D97706);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
                ${escapeHtml(ctaLabel)}
              </a>
              <div style="font-size:11px;color:#9aa49f;margin-top:10px;word-break:break-all;">
                或复制链接打开：<a href="${safeUrl}" style="color:#B45309;text-decoration:none;">${safeUrl}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0;">
              <div style="background:#f8faf9;border:1px solid #dde5df;border-radius:10px;padding:12px 14px;font-size:12px;color:#5a6b62;line-height:1.7;">
                题目有误、答案存疑，欢迎在 App 内「反馈」告诉我们，每一条都会核对。
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;">
              <div style="border-top:1px solid #f0f4f1;padding-top:14px;font-size:11px;color:#9aa49f;text-align:center;line-height:1.6;">
                这是一封产品更新通知，发送给所有 TreePractice 注册用户。
                <br /><a href="${safeSite}" style="color:#9aa49f;">${safeSite}</a> · TreePractice 团队
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
