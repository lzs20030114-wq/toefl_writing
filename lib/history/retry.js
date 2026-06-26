// 「从历史重练」的统一入口。
//
// 换库后旧题已不在 live(V2) 库里，写作页若仍按 retryPromptId 去新库查会报「已下线」；
// 邮件题更会撞车（V1/V2 同 id 不同内容）静默匹配到新题。这里把历史记录里存的整道题
// 快照（details.promptData）经 sessionStorage 一次性交接给写作页，由写作页优先使用，
// 从而精确还原当年练的那道题。仅 email/discussion 支持「同题重练」。

const RETRY_SNAPSHOT_KEY = "toefl-retry-snapshot";

function retryPath(type) {
  if (type === "email") return "/email-writing";
  if (type === "discussion") return "/academic-writing";
  return "";
}

// 构造重练 URL（纯函数，无副作用）。无可重练 promptId 时返回 ""，调用方据此决定是否显示按钮。
export function buildRetryHref(session) {
  const s = session || {};
  const path = retryPath(s.type);
  if (!path) return "";
  const promptId = String(s?.details?.promptId || s?.details?.promptData?.id || "").trim();
  if (!promptId) return "";
  const qs = new URLSearchParams();
  qs.set("retryPromptId", promptId);
  const rootId = String(s?.details?.practiceRootId || "").trim();
  if (rootId) qs.set("practiceRootId", rootId);
  const attempt = Number(s?.details?.practiceAttempt || 1);
  if (Number.isFinite(attempt) && attempt > 0) qs.set("retryFromAttempt", String(Math.floor(attempt)));
  const mode = String(s?.mode || "").trim();
  if (mode && mode !== "standard") qs.set("mode", mode);
  const lang = String(s?.details?.feedback?.reportLanguage || "").trim();
  if (lang) qs.set("lang", lang);
  return `${path}?${qs.toString()}`;
}

// 把一道题的快照写入 sessionStorage（一次性交接），供写作页 peekRetrySnapshot 取用。
// 历史「再练一遍」与「个人题库」练习共用这一机制，因此 WritingTask 无需任何改动。
// promptData.id 即匹配键，必须与写作页的 initialPromptId 一致。缺失/写入失败都不抛错。
export function stashPromptSnapshot(type, promptData) {
  if (typeof window === "undefined") return;
  if (!promptData || typeof promptData !== "object") return;
  const id = String(promptData.id || "").trim();
  if (!id) return;
  try {
    sessionStorage.setItem(
      RETRY_SNAPSHOT_KEY,
      JSON.stringify({ id, type: type || "", promptData })
    );
  } catch {
    // sessionStorage 不可用或超额：忽略
  }
}

// 历史重练用：从 session 取出整道题快照交接。兼容老记录（id 可能在 details.promptId）。
function stashSnapshot(session) {
  const promptData = session?.details?.promptData;
  if (!promptData || typeof promptData !== "object") return;
  const id = String(promptData.id || session?.details?.promptId || "").trim();
  if (!id) return;
  stashPromptSnapshot(session?.type || "", promptData.id ? promptData : { ...promptData, id });
}

// 写作页调用：只读地取出交接的快照（不删除，故在 render / useState 初始化里调用安全，
// 不受 StrictMode 双调用影响）。仅当 id 与 forcedPromptId 匹配时返回，避免误用陈旧快照。
// 返回原始 promptData（由调用方规范化）。取用后请在 effect 里调用 clearRetrySnapshot()。
export function peekRetrySnapshot(forcedPromptId) {
  if (typeof window === "undefined") return null;
  let raw = null;
  try {
    raw = sessionStorage.getItem(RETRY_SNAPSHOT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.promptData) return null;
    const wantId = String(forcedPromptId || "").trim();
    if (wantId && String(parsed.id || "") !== wantId) return null;
    return parsed.promptData;
  } catch {
    return null;
  }
}

// 清除交接的快照（一次性）。在写作页 effect 里用过快照后调用，幂等。
export function clearRetrySnapshot() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(RETRY_SNAPSHOT_KEY);
  } catch {
    // 忽略
  }
}

// 历史页「再练一遍（同题）」按钮：交接快照 + 跳转。
export function startRetryFromHistory(session) {
  const href = buildRetryHref(session);
  if (!href) return;
  stashSnapshot(session);
  if (typeof window !== "undefined") window.location.href = href;
}
