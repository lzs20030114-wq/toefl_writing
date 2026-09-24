import { createRequire } from "module";

// DeepSeek 上游调用层。原先整段住在 app/api/ai/route.js 里，2026-09-20 新增
// /api/ai/lesson(讲评第二次调用)后抽成共享模块 —— 两条路由必须用同一套流式
// 拼接、超时预算与重试分类，不允许各写一份慢慢跑偏。
//
// 搬运原则：逐字节等价。route.js 里与「评分」强耦合的常量(MAX_TOKENS /
// MAX_SAMPLES / DIRECT_TOTAL_BUDGET_MS)留在 route.js，由调用方传进来。
const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, callWithRetry } = require("./deepseekHttp");

export const DEFAULT_MODEL = "deepseek-v4-flash";

// 构造发往 DeepSeek 的统一 payload(单采样/多采样共用同一形状)。
// stream 只在直连路径打开:8K token 的评分报告非流式要等 60-80s 才有第一个字节,
// 2026-09-09 晚高峰 DeepSeek 网关把这类长挂请求整批掐成 5xx(13/18 失败,三路
// 全灭且都卡在 ~75s)。流式让连接持续有数据,不会被中间层当成空闲连接掐断;
// 服务端把分片拼回完整文本,对前端/解析层完全透明。proxy 路径(本地调试)沿用
// deepseekHttp 的非流式解析,不动。
export function buildUpstreamPayload({ system, message, maxTokens, temperature, model }, { stream = false } = {}) {
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    temperature,
    stream,
    messages: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
  };
}

// 单次上游调用(proxy 路径)——沿用 deepseekHttp 的 120s 网络超时,成功返回
// content 字符串,失败抛错(交由 allSettled / 外层 catch 处理)。
export function callViaCurlOnce(apiKey, proxyUrl, params, { timeoutMs = 160000 } = {}) {
  return callDeepSeekViaCurl({
    apiKey,
    proxyUrl,
    // The writing caller uses a 175s outer timeout and this route allows 180s,
    // leaving the upstream transport 160s to finish an 8K-token report.
    timeoutMs,
    payload: buildUpstreamPayload(params),
  });
}

// AbortSignal.timeout 在 Node ≥17.3 可用;万一运行时没有就退化为无超时(与旧版等价)。
export function makeTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(Math.max(1000, Math.trunc(ms)));
  }
  return undefined;
}

// 把 DeepSeek 的 SSE 流拼成完整 content。规则(与官方文档一致):
//   - 空行 / 以 ":" 开头的 keep-alive 注释行 → 忽略
//   - "data: [DONE]" → 结束
//   - "data: {json}" → 取 choices[0].delta.content 追加(reasoning_content 不要)
//   - 流中 {error:...} → 抛错(带 errText),交由采样级失败处理
// 分片可能在任意字节处切开,所以按 "\n" 缓冲成整行再解析;半截行留到下一片。
export async function readSseContent(body, diag) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let finished = false;
  // 诊断字段(写进可选的 diag)——「HTTP 200 但正文是空的」只有靠这些才分得清根因:
  // finish=length + reasoning 很长 → 推理吃光 max_tokens 预算;chunks=0 或流没走完
  // → 上游回了 200 就把流掐了。详见 describeSampleDiag。
  let chunks = 0;
  let reasoningChars = 0;
  let finishReason = "";
  let usage = null;
  const writeDiag = () => {
    if (!diag) return;
    Object.assign(diag, {
      transport: "sse",
      chunks,
      finishReason,
      reasoningChars,
      contentChars: content.length,
      usage,
      streamEnded: finished,
    });
  };
  const handleLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      finished = true;
      return;
    }
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return; // 非 JSON 的 data 行(不应出现)直接跳过,不让单行毁掉整份报告
    }
    if (obj?.error) {
      const msg = typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
      const err = new Error("DeepSeek stream error");
      err.errText = msg;
      throw err;
    }
    chunks += 1;
    // usage 只有在请求带了 stream_options.include_usage 时才会出现;我们没开,
    // 所以这里通常是 null。上游哪天默认带上了就顺手记下,不额外发请求去问。
    if (obj?.usage) usage = obj.usage;
    const choice = obj?.choices?.[0];
    if (choice?.finish_reason) finishReason = String(choice.finish_reason);
    const delta = choice?.delta;
    // reasoning_content 不进正文(与官方文档一致),但长度要记:它正是吃掉预算的那部分。
    if (typeof delta?.reasoning_content === "string") reasoningChars += delta.reasoning_content.length;
    if (typeof delta?.content === "string") content += delta.content;
  };
  // diag 必须在 handleLine 抛错(流里夹 {error})时也写出来,故放 finally。
  try {
    for await (const chunk of body) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
      if (finished) break;
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
    }
  } finally {
    writeDiag();
  }
  return content;
}

// 按响应类型取正文:流式 → 拼 SSE;非流式 JSON(测试 mock / 上游忽略 stream 时)→ 旧逻辑。
export async function readUpstreamContent(res, diag) {
  const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream") && res.body) return readSseContent(res.body, diag);
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content || "";
  if (diag) {
    Object.assign(diag, {
      transport: "json",
      choices: Array.isArray(data?.choices) ? data.choices.length : 0,
      finishReason: choice?.finish_reason ? String(choice.finish_reason) : "",
      reasoningChars:
        typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content.length : 0,
      contentChars: content.length,
      usage: data?.usage || null,
    });
  }
  return content;
}

// 单次上游调用(直连路径)——成功返回 content 字符串;!res.ok 时抛出携带
// { status, errText } 的错误,网络异常照原样抛出(无 status)。多采样模式下
// 单发失败只算该采样失败,不会立刻拖垮整个请求。
// 复用 deepseekHttp.callWithRetry:只对「快速失败的 5xx / 连接重置」重试一次,
// 且剩余预算 >8s 才重试;超时、4xx(含 402 余额不足、429)一律不重试。
export async function callDirectOnce(apiKey, params, { totalBudgetMs, diag } = {}) {
  const body = JSON.stringify(buildUpstreamPayload(params, { stream: true }));
  let attempts = 0;
  const runAttempt = async (remainingMs) => {
    attempts += 1;
    if (diag) diag.attempts = attempts;
    let res;
    try {
      res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body,
        signal: makeTimeoutSignal(remainingMs),
      });
    } catch (e) {
      // undici 把 ECONNRESET 之类塞在 cause 里;提到顶层让重试分类器能看见。
      if (e && !e.code && e.cause?.code) e.code = e.cause.code;
      throw e;
    }
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`DeepSeek ${res.status}`);
      err.status = res.status;
      err.errText = errText;
      throw err;
    }
    return readUpstreamContent(res, diag);
  };
  return callWithRetry({ runAttempt, totalBudgetMs });
}

// 给 fail() 的 errorDetail:把上游原始状态码带上。表里的 http_status 是我们映射后
// 的 502,不带这个就分不清上游到底是 502/503/504 还是网络层断开。
export function describeUpstreamError(reason) {
  if (!reason) return "";
  const status = Number(reason.status);
  const text = String(reason.errText || reason.message || "").trim();
  return Number.isFinite(status) && status ? `upstream ${status}: ${text}` : text;
}

// 把一路采样的上游诊断压成一行,写进 api_error_feedback 的详情。
//
// 2026-09-21: 「三路都回 200 但正文是空的」在后台长这样——deepseek / upstream / 502,
// 详情整列 NULL(见 app/api/ai/route.js 的 fan-out 分支),根因完全查不到。有了这一行才分得清:
//   finish=length + reasoning 很长  → 推理吃光 max_tokens 预算(v4-flash 的重尾特性)
//   chunks=0 / stream-cut          → 上游回了 200 就把流掐了(网关退化)
//   json choices=0                 → 非流式响应形状不对
export function describeSampleDiag(diag) {
  if (!diag || !diag.transport) return "no upstream response";
  const parts = [diag.transport];
  if (diag.attempts > 1) parts.push(`attempts=${diag.attempts}`);
  parts.push(`finish=${diag.finishReason || "none"}`);
  parts.push(`content=${diag.contentChars || 0}c`);
  if (diag.reasoningChars) parts.push(`reasoning=${diag.reasoningChars}c`);
  if (diag.transport === "sse") {
    parts.push(`chunks=${diag.chunks || 0}`);
    if (!diag.streamEnded) parts.push("stream-cut");
  } else if (typeof diag.choices === "number") {
    parts.push(`choices=${diag.choices}`);
  }
  const u = diag.usage;
  if (u) parts.push(`tokens=${u.completion_tokens ?? "?"}/${u.total_tokens ?? "?"}`);
  return parts.join(" ");
}

// 多路采样时把每一路的诊断拼成一段(详情列限 4000 字符,这里天然很短)。
export function describeSampleDiags(diags) {
  const list = Array.isArray(diags) ? diags : [];
  if (list.length === 0) return "";
  return list.map((d, i) => `#${i + 1} ${describeSampleDiag(d)}`).join(" | ");
}

// 上游「HTTP 200 但正文是空的」——单采样路径必须把它当失败。
//
// 2026-09-13: v4-flash 是推理型模型,reasoning_tokens 计入 max_tokens 预算(见
// lib/ai/writingEval.js 的实测记录)。预算被推理吃光时上游回 finish_reason=length
// + 空 content,HTTP 却是 200。原来的单采样路径直接 Response.json({ content }) 放行,
// 前端拿到 {content:""} 当成功:AI 解释类 hook 把空串写进 state(ex.text 是假值 →
// 渲染回按钮)和 localStorage 缓存,用户看到的是「点了既不出内容也不报错」的死按钮,
// 而 api_error_feedback 里一条记录都没有,后台完全查不到。
// 多采样路径的 collectContents 早就把空串判为失败了,这里补齐单采样的同款判据。
export function isNonEmptyContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}
