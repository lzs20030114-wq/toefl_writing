/**
 * 反馈回复「未读」计数（纯函数 + localStorage 薄封装）。
 *
 * 作者在后台回复了用户反馈，之前用户只有把侧栏「反馈」折叠区点开才可能看到，
 * 等于永远看不到。现在首页侧栏「反馈与交流」入口挂一个未读回复角标，
 * 用户打开「反馈记录」页签即视为已读。已读集合只存本机 localStorage，
 * 换设备会再提示一次，可接受（比漏看强）。
 */

export const FEEDBACK_SEEN_KEY = "tp_feedback_seen_replies";

/** 有作者回复的反馈 id 列表 */
export function repliedIds(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.admin_reply && String(r.admin_reply).trim())
    .map((r) => String(r.id));
}

/** 未读回复条数 = 有回复的 id 里不在已读集合中的 */
export function countUnseenReplies(rows, seenIds) {
  const seen = new Set((seenIds || []).map(String));
  return repliedIds(rows).filter((id) => !seen.has(id)).length;
}

export function loadSeenReplyIds() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FEEDBACK_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveSeenReplyIds(ids) {
  if (typeof window === "undefined") return;
  try {
    // 只保留最近 200 条，防止无限增长
    const uniq = Array.from(new Set((ids || []).map(String))).slice(-200);
    window.localStorage.setItem(FEEDBACK_SEEN_KEY, JSON.stringify(uniq));
  } catch { /* 隐私模式等写不进去就算了 */ }
}
