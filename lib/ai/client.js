import { getSavedCode } from "../AuthContext";

// Stable per-browser id for server-side error attribution. Best-effort:
// falls back to "" when storage/crypto are unavailable (e.g. SSR/tests).
function resolveClientId() {
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
}

// Shared /api/ai request core — one POST wrapped in the outer timeout race.
// Returns the raw response body `d` (has `d.content`, and optionally
// `d.contents` when samples>1). callAI/callAIMulti thin-wrap this so error
// mapping (err.status/err.code/err.serverMessage), AbortController and the
// 150s outer timeout stay byte-identical across both entry points.
async function requestAI(system, message, maxTokens, timeoutMs, temperature, samples) {
  let timeoutId;
  const controller = new AbortController();
  const clientId = resolveClientId();

  try {
    const requestPromise = (async () => {
      const body = {
        system,
        message,
        maxTokens: maxTokens || 2000,
        temperature,
        userCode: getSavedCode() || "",
      };
      // 只在多采样时带 samples,让单采样请求体与旧版逐字一致(不破坏其他 callAI 调用方)。
      if (samples && samples > 1) body.samples = samples;
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientId ? { "X-Client-Id": clientId } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // Read the body so callers can distinguish a free-tier daily limit
        // (DAILY_LIMIT → show an upgrade path) from a transient rate limit
        // instead of collapsing every 429 into a futile "server busy" retry.
        let respBody = null;
        try { respBody = await r.json(); } catch {}
        // Keep the message as "API error <status>" so status-based categorization
        // (401/403/429) keeps working; carry the daily-limit signal via err.code.
        const err = new Error("API error " + r.status);
        err.status = r.status;
        err.code = respBody && respBody.code ? String(respBody.code) : "";
        err.serverMessage = respBody && respBody.error ? String(respBody.error) : "";
        throw err;
      }
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d;
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
  const d = await requestAI(system, message, maxTokens, timeoutMs, temperature, 1);
  return d.content;
}

// Multi-sample variant for writing evaluation's「三路取中位」. One HTTP request
// (so daily usage is metered once), N parallel DeepSeek calls server-side.
// Returns a non-empty string[] of raw AI outputs. When the server returns a
// `contents` array we filter out empties; if it lacks `contents` (old server
// during a rollout window) we degrade to a single-element [content].
export async function callAIMulti(
  system,
  message,
  maxTokens,
  timeoutMs = 150000,
  temperature = 0.3,
  samples = 3
) {
  const d = await requestAI(system, message, maxTokens, timeoutMs, temperature, samples);
  if (Array.isArray(d.contents)) {
    const filtered = d.contents.filter((c) => typeof c === "string" && c.trim());
    if (filtered.length > 0) return filtered;
  }
  return [d.content];
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

