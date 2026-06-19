import { getSavedCode } from "../AuthContext";

export async function callAI(
  system,
  message,
  maxTokens,
  // Default outer timeout — generous enough that long DeepSeek responses
  // (especially writing evaluation, which can stream 2K+ tokens) finish
  // before the user sees a bogus "评分失败". Inner HTTP timeout in
  // deepseekHttp.js is slightly tighter so we surface a network-layer
  // error before the outer race kicks in.
  timeoutMs = 150000,
  temperature = 0.3
) {
  let timeoutId;
  const controller = new AbortController();

  const clientId = (() => {
    try {
      const key = "toefl-client-id";
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const generated =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, generated);
      return generated;
    } catch {
      return "";
    }
  })();

  try {
    const requestPromise = (async () => {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientId ? { "X-Client-Id": clientId } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          system,
          message,
          maxTokens: maxTokens || 2000,
          temperature,
          userCode: getSavedCode() || "",
        }),
      });
      if (!r.ok) {
        // Read the body so callers can distinguish a free-tier daily limit
        // (DAILY_LIMIT → show an upgrade path) from a transient rate limit
        // instead of collapsing every 429 into a futile "server busy" retry.
        let body = null;
        try { body = await r.json(); } catch {}
        // Keep the message as "API error <status>" so status-based categorization
        // (401/403/429) keeps working; carry the daily-limit signal via err.code.
        const err = new Error("API error " + r.status);
        err.status = r.status;
        err.code = body && body.code ? String(body.code) : "";
        err.serverMessage = body && body.error ? String(body.error) : "";
        throw err;
      }
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d.content;
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("API timeout"));
      }, timeoutMs);
    });

    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// A free user out of their daily quota — distinct from a transient rate limit.
// The UI should offer 升级 Pro here rather than a retry that can never succeed today.
export function isDailyLimitError(err) {
  if (err && err.code === "DAILY_LIMIT") return true;
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("daily limit reached");
}

export function mapScoringError(err) {
  const raw = String(err?.message || err || "");
  const m = raw.toLowerCase();
  if (isDailyLimitError(err)) return "今日免费次数已用完，升级 Pro 可无限练习";
  if (m.includes("empty ai response")) return "评分失败，AI服务暂时不可用";
  if (m.includes("api timeout")) return "AI 响应超时，请重试";
  if (m.includes("api error 401") || m.includes("api error 403")) return "认证失败（401/403）";
  if (m.includes("api error 429")) return "AI服务繁忙（429），请稍后重试";
  if (m.includes("unexpected token") || m.includes("json") || m.includes("parse")) return "AI返回格式异常，请重试";
  if (m.includes("api error")) return "评分服务暂时不可用";
  if (m.includes("failed to fetch") || m.includes("network")) return "网络连接异常，请检查后重试";
  return "评分失败，请重试";
}

