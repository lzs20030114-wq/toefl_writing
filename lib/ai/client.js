import { getSavedCode } from "../AuthContext";

// Stable per-browser id for server-side error attribution. Best-effort:
// falls back to "" when storage/crypto are unavailable (e.g. SSR/tests).
export function resolveClientId() {
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

function isNonEmptyContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}

// AI 辅助类调用(练习记录「AI 解释」、划词讲解、错题分析…)统一的 token 预算。
//
// 这个数字**不是**期望的输出长度——那些讲解实际只有 3-5 句中文(百来 token)。它是给
// 推理留的余量:deepseek-v4-flash 是推理型模型,reasoning_tokens 计入 max_tokens 预算
// (实测记录见 lib/ai/writingEval.js:73 —— 写作评分 4000 预算下约 10% 采样被推理吃光,
// finish_reason=length 且正文为空)。这些辅助调用原本给 260-700,远在推理长度量级以下,
// 于是推理稍长就没正文了,前端表现为「AI 解释点了不出内容也不报错」(2026-09-13 修)。
//
// max_tokens 只是上限:模型用不到就不计费,调大几乎零成本;而一次空响应是 100% 白花钱。
// 所以这里宁可给足。改小之前请先读 app/api/ai/route.js 的 isNonEmptyContent 注释。
export const AI_HELPER_MAX_TOKENS = 2000;

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
  // 空正文绝不能当成一次成功的回答返回。服务端(app/api/ai/route.js)现在已把它判成
  // 502,这里是灰度窗口/旧部署的兜底:调用方(AI 解释类 hook)拿到空串会照常写进 state
  // 和缓存,`ex?.text` 是假值于是渲染回按钮、error 又是 null —— 用户看到的就是
  // 「点了没反应、也不报错」。文案沿用 "empty ai response",mapScoringError 已按这个
  // 关键词分类。
  if (!isNonEmptyContent(d.content)) throw new Error("Empty AI response");
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
    const filtered = d.contents.filter(isNonEmptyContent);
    if (filtered.length > 0) return filtered;
  }
  // 降级到单采样字段时同样不接受空正文——返回 [""] 只会让 parseReport 报一个
  // 与根因无关的「格式异常」,把「上游没出正文」这件事藏掉。
  if (isNonEmptyContent(d.content)) return [d.content];
  throw new Error("Empty AI response");
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

// AI 解释/辅助类调用(练习记录里的「AI 解释」按钮等)的错误文案。
//
// 与 mapScoringError 分开:那条是写作评分专用的,文案都以「评分」开头,解释场景复用
// 会答非所问。关键是**绝不把 err.message 原样渲染给用户** —— 4 个 explain hook 以前
// 都写「error: e.message」,线上一次 PostgREST 504 就变成用户看不懂、也不知道能重试的
// 红字 "API error 403"(事故说明见 lib/userLookup.js)。
export function mapAiHelperError(err) {
  if (isDailyLimitError(err)) return "今日免费次数已用完，升级 Pro 可无限使用";
  const code = String(err?.code || "");
  const status = Number(err?.status) || 0;
  const m = String(err?.message || err || "").toLowerCase();
  if (code === "PRO_DAILY_CAP") return "服务繁忙，请稍后再试";
  // 402=上游余额不足 / 502=上游挂了 / 503=我们这边查库失败:对用户都是「暂时,可重试」。
  if (code === "USER_LOOKUP_FAILED" || status === 402 || status === 502 || status === 503) {
    return "服务暂时不可用，请重试";
  }
  if (status === 401 || status === 403) return "登录状态异常，请重新登录后重试";
  if (status === 429) return "AI 服务繁忙，请稍后重试";
  if (m.includes("empty ai response")) return "AI 没返回内容，请重试";
  if (m.includes("api timeout")) return "AI 响应超时，请重试";
  if (m.includes("failed to fetch") || m.includes("network")) return "网络连接异常，请检查后重试";
  return "生成失败，请重试";
}

