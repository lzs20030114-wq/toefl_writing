import { createRequire } from "module";
import { createHash } from "crypto";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { lookupUserTier } from "../../../lib/userLookup";

// Give the serverless function room to wait for slow DeepSeek responses.
// Without this, Vercel's hobby default (10s) would kill the request long
// before the inner 120s network timeout has a chance. Pro plan honors up
// to 300s; hobby caps to 60s — either way 180 is the ceiling we want.
export const maxDuration = 180;

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl, callWithRetry } = require("../../../lib/ai/deepseekHttp");
const MAX_BODY_BYTES = 120000;
const MAX_SYSTEM_CHARS = 12000;
const MAX_MESSAGE_CHARS = 40000;
// 2026-07-12: 3000→4096。判分锚改造后评分输出(含 ===ERRORS=== 推理段)实测需
// 3.1-3.9K tokens。
// 2026-07-12 再抬 4096→6144: v4-flash 推理 token 计入 completion 预算,4000 下
// 约 10% 采样被推理吃光预算出空正文;writingEval.js 现请求 6000,上限需容纳它。
// Writing reports repeat the response in ANNOTATION and CORRECTED and then
// add a model essay. Reasoning tokens also consume this budget, so 6K can cut
// off a model essay even when the score section itself is valid.
const MAX_TOKENS = 8192;
// 2026-07-12: 写作评分「三路取中位」上限。samples>1 时本请求会在服务端并行发 N 次
// DeepSeek 调用(只扣 1 次用量)。上限 3 是成本护栏——防滥用者靠放大 samples 撑大
// 我们的 DeepSeek 账单。缺省 1 时行为与旧版逐字等价。
const MAX_SAMPLES = 3;
// 2026-09-09: 直连路径(Vercel 线上走这条)的总时间预算。客户端外层 175s、Vercel
// maxDuration 180s,这里留 165s 给上游(含 1 次快速 5xx 重试)。超时用 AbortSignal
// 主动掐掉,让请求仍走 fail() 写 api_error_feedback;否则被 Vercel 在 180s 杀掉时
// 什么都记不到,用户只看到一个没来由的 504。
const DIRECT_TOTAL_BUDGET_MS = 165000;
// 升档重试至少要剩这么多时间才值得开第二次上游调用(见 withBudgetEscalation)。
const ESCALATION_MIN_REMAINING_MS = 30000;

const limiter = createRateLimiter("ai", { max: 45 });

function getRateLimitKey(request) {
  const ip = getIp(request);
  if (ip && ip !== "unknown") return `ip:${ip}`;
  const ua = request.headers.get("user-agent") || "";
  const lang = request.headers.get("accept-language") || "";
  const secUa = request.headers.get("sec-ch-ua") || "";
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin") || "";
  const raw = `${ua}|${lang}|${secUa}|${host}|${origin}`;
  const digest = createHash("sha1").update(raw).digest("hex");
  return `fp:${digest}`;
}

function normalizeHost(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    if (input.includes("://")) return new URL(input).host.toLowerCase();
    return new URL(`http://${input}`).host.toLowerCase();
  } catch {
    return input.toLowerCase();
  }
}

function isOriginAllowed(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Browser requests always include Origin on POST.
    // If sec-fetch-site is present (modern browser) but origin is missing, reject.
    const secFetchSite = request.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "none") return false;
    // No origin + no sec-fetch-site = likely server-to-server (cURL, etc.) — allow.
    return true;
  }
  const originHost = normalizeHost(origin);
  if (!originHost) return false;
  const host = normalizeHost(request.headers.get("host"));
  const xfh = String(request.headers.get("x-forwarded-host") || "")
    .split(",")
    .map((v) => normalizeHost(v))
    .filter(Boolean);
  return [host, ...xfh].includes(originHost);
}

function validateBody(body) {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const system = String(body.system || "");
  const message = String(body.message || "");
  const maxTokensRaw = Number(body.maxTokens ?? 2000);
  const temperatureRaw = Number(body.temperature ?? 0.3);
  if (!system.trim()) return "Missing system prompt.";
  if (!message.trim()) return "Missing user prompt.";
  if (system.length > MAX_SYSTEM_CHARS) return `System prompt too long (>${MAX_SYSTEM_CHARS}).`;
  if (message.length > MAX_MESSAGE_CHARS) return `User prompt too long (>${MAX_MESSAGE_CHARS}).`;
  if (!Number.isInteger(maxTokensRaw) || maxTokensRaw <= 0 || maxTokensRaw > MAX_TOKENS) {
    return `maxTokens must be an integer between 1 and ${MAX_TOKENS}.`;
  }
  if (!Number.isFinite(temperatureRaw) || temperatureRaw < 0 || temperatureRaw > 2) {
    return "temperature must be between 0 and 2.";
  }
  const retryRaw = body.retryMaxTokens;
  if (retryRaw !== undefined) {
    const retry = Number(retryRaw);
    if (!Number.isInteger(retry) || retry <= 0 || retry > MAX_TOKENS) {
      return `retryMaxTokens must be an integer between 1 and ${MAX_TOKENS}.`;
    }
  }
  const samplesRaw = Number(body.samples ?? 1);
  if (!Number.isInteger(samplesRaw) || samplesRaw < 1 || samplesRaw > MAX_SAMPLES) {
    return `samples must be an integer between 1 and ${MAX_SAMPLES}.`;
  }
  return "";
}

function normalizeGenerationParams(body) {
  const maxTokensRaw = Number(body?.maxTokens ?? 2000);
  const temperatureRaw = Number(body?.temperature ?? 0.3);
  return {
    maxTokens: Math.trunc(maxTokensRaw),
    temperature: temperatureRaw,
  };
}

// 讲解类调用的「升档上限」。客户端按用途给的是小预算(见 lib/ai/client.js 的
// AI_EXPLAIN_BUDGET),空正文时才升到这个数重来一次。缺省/非法 → 0 = 不升档。
function normalizeRetryBudget(body, maxTokens) {
  const raw = Number(body?.retryMaxTokens);
  if (!Number.isInteger(raw) || raw <= maxTokens || raw > MAX_TOKENS) return 0;
  return raw;
}

// 空正文 = 推理把预算吃光了(上游 finish_reason=length,HTTP 却是 200)。
// 在**同一次请求**里换大预算重来一次:用户仍只经历一次调用、也只扣一次用量,
// 于是「按用途给小预算」可以放心地快,罕见的长推理由这里兜住。
// 2026-09-13 的教训是空正文不能放行;2026-09-14 补的是「也不必为此让所有调用都慢」。
async function withBudgetEscalation(run, maxTokens, retryBudget, deadlineAt) {
  const remaining = () => (deadlineAt ? deadlineAt - Date.now() : DIRECT_TOTAL_BUDGET_MS);
  const content = await run(maxTokens, remaining());
  if (isNonEmptyContent(content) || !retryBudget) return { content, escalated: false };
  // 两次上游各自吃满 165s 会撞穿 Vercel 的 maxDuration(180s) —— 函数被杀,用户拿到的
  // 是比「空正文」更糊涂的一个断流。所以升档共享一条截止线,剩余时间不够就不升了,
  // 照旧按空正文回 502(至少是一条能看懂、能重试的错误)。
  if (remaining() < ESCALATION_MIN_REMAINING_MS) return { content, escalated: false };
  return { content: await run(retryBudget, remaining()), escalated: true };
}

// 升档不是故障,但它是**调档唯一的真实依据**(某一档频繁升档 = 给小了)。
// api_error_feedback 是本路由仅有的留痕通道,所以借它记一行,单列 errorType 好筛。
function logBudgetEscalation(requestMeta, from, to) {
  return logApiFailure({
    ...requestMeta,
    stage: "deepseek",
    errorType: "budget_escalated",
    httpStatus: 200,
    errorMessage: `empty content at ${from} tokens, retried at ${to}`,
  });
}

// samples 已在 validateBody 里校验为 1–3 的整数;这里再夹一次纯属防御,保证
// 非法输入退化为单采样而不是放大调用。
function normalizeSamples(body) {
  const raw = Number(body?.samples ?? 1);
  if (!Number.isInteger(raw)) return 1;
  return Math.max(1, Math.min(MAX_SAMPLES, raw));
}

// 构造发往 DeepSeek 的统一 payload(单采样/多采样共用同一形状)。
// stream 只在直连路径打开:8K token 的评分报告非流式要等 60-80s 才有第一个字节,
// 2026-09-09 晚高峰 DeepSeek 网关把这类长挂请求整批掐成 5xx(13/18 失败,三路
// 全灭且都卡在 ~75s)。流式让连接持续有数据,不会被中间层当成空闲连接掐断;
// 服务端把分片拼回完整文本,对前端/解析层完全透明。proxy 路径(本地调试)沿用
// deepseekHttp 的非流式解析,不动。
function buildUpstreamPayload({ system, message, maxTokens, temperature }, { stream = false } = {}) {
  return {
    model: "deepseek-v4-flash",
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
function callViaCurlOnce(apiKey, proxyUrl, params, budgetMs) {
  return callDeepSeekViaCurl({
    apiKey,
    proxyUrl,
    // The writing caller uses a 175s outer timeout and this route allows 180s,
    // leaving the upstream transport 160s to finish an 8K-token report.
    // 升档重试时传入剩余预算,两次加起来不超过同一条截止线。
    timeoutMs: Math.min(160000, budgetMs || 160000),
    payload: buildUpstreamPayload(params),
  });
}

// AbortSignal.timeout 在 Node ≥17.3 可用;万一运行时没有就退化为无超时(与旧版等价)。
function makeTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(Math.max(1000, Math.trunc(ms)));
  }
  return undefined;
}

// 超时信号 + 客户端断开信号取并集:任一触发就掐掉上游。AbortSignal.any 是
// Node ≥20.3 才有的,缺了就退回只用超时信号(与旧版等价,不会因此报错)。
function combineSignals(timeoutSignal, externalSignal) {
  const list = [timeoutSignal, externalSignal].filter(Boolean);
  if (list.length <= 1) return list[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(list);
  }
  return timeoutSignal;
}

// 把 DeepSeek 的 SSE 流拼成完整 content。规则(与官方文档一致):
//   - 空行 / 以 ":" 开头的 keep-alive 注释行 → 忽略
//   - "data: [DONE]" → 结束
//   - "data: {json}" → 取 choices[0].delta.content 追加(reasoning_content 不要)
//   - 流中 {error:...} → 抛错(带 errText),交由采样级失败处理
// 分片可能在任意字节处切开,所以按 "\n" 缓冲成整行再解析;半截行留到下一片。
async function readSseContent(body, onEvent) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let finished = false;
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
    const delta = obj?.choices?.[0]?.delta;
    if (typeof delta?.content === "string" && delta.content) {
      content += delta.content;
      if (onEvent) onEvent({ type: "delta", text: delta.content });
    } else if (delta && onEvent) {
      // 推理阶段只产 reasoning_content(我们不要它的内容),但下游必须知道上游还活着:
      // 不发心跳的话,浏览器在模型思考的几十秒里收不到任何字节,会当成连接卡死。
      onEvent({ type: "tick" });
    }
  };
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
  return content;
}

// 按响应类型取正文:流式 → 拼 SSE;非流式 JSON(测试 mock / 上游忽略 stream 时)→ 旧逻辑。
async function readUpstreamContent(res, onEvent) {
  const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream") && res.body) return readSseContent(res.body, onEvent);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// 单次上游调用(直连路径)——成功返回 content 字符串;!res.ok 时抛出携带
// { status, errText } 的错误,网络异常照原样抛出(无 status)。多采样模式下
// 单发失败只算该采样失败,不会立刻拖垮整个请求。
// 复用 deepseekHttp.callWithRetry:只对「快速失败的 5xx / 连接重置」重试一次,
// 且剩余预算 >8s 才重试;超时、4xx(含 402 余额不足、429)一律不重试。
async function callDirectOnce(apiKey, params, { onEvent, signal, budgetMs } = {}) {
  const body = JSON.stringify(buildUpstreamPayload(params, { stream: true }));
  const runAttempt = async (remainingMs) => {
    let res;
    try {
      res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body,
        signal: combineSignals(makeTimeoutSignal(remainingMs), signal),
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
    return readUpstreamContent(res, onEvent);
  };
  return callWithRetry({
    runAttempt,
    totalBudgetMs: Math.min(DIRECT_TOTAL_BUDGET_MS, budgetMs > 0 ? budgetMs : DIRECT_TOTAL_BUDGET_MS),
  });
}

// 给 fail() 的 errorDetail:把上游原始状态码带上。表里的 http_status 是我们映射后
// 的 502,不带这个就分不清上游到底是 502/503/504 还是网络层断开。
function describeUpstreamError(reason) {
  if (!reason) return "";
  const status = Number(reason.status);
  const text = String(reason.errText || reason.message || "").trim();
  return Number.isFinite(status) && status ? `upstream ${status}: ${text}` : text;
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
function isNonEmptyContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}

// 从 allSettled 结果里挑出成功且非空的 content(保持采样顺序)。
function collectContents(results) {
  return results
    .filter((r) => r.status === "fulfilled" && typeof r.value === "string" && r.value.trim())
    .map((r) => r.value);
}

// 第一个失败采样的原因(用于 0 成功时的错误语义)。
function firstRejectionReason(results) {
  const rejected = results.find((r) => r.status === "rejected");
  return rejected ? rejected.reason : null;
}

async function logApiFailure(meta) {
  if (!isSupabaseAdminConfigured) return;
  try {
    await supabaseAdmin.from("api_error_feedback").insert({
      endpoint: "/api/ai",
      stage: meta.stage || null,
      http_status: Number(meta.httpStatus || 0) || null,
      error_type: String(meta.errorType || "unknown"),
      error_message: String(meta.errorMessage || "").slice(0, 500),
      error_detail: meta.errorDetail ? String(meta.errorDetail).slice(0, 4000) : null,
      client_id: meta.clientId ? String(meta.clientId).slice(0, 120) : null,
      client_ip: meta.clientIp ? String(meta.clientIp).slice(0, 64) : null,
      origin: meta.origin ? String(meta.origin).slice(0, 300) : null,
      user_agent: meta.userAgent ? String(meta.userAgent).slice(0, 500) : null,
    });
  } catch {
    // Do not block API response when logging fails.
  }
}

// 多采样 fan-out「部分失败」留痕:只要 ≥1 采样成功,请求就整体成功返回,但
// rejected 采样的上游错误若不记录,间歇性上游失败(典型:三发里一发 DeepSeek
// 500)对监控完全隐身 —— 旧单发路径每次上游失败都会写 api_error_feedback,
// 这里补齐同等可观测性。logApiFailure 内部已吞错,不会拖垮成功响应。
function logPartialSampleFailures(requestMeta, results) {
  return Promise.all(
    results
      .filter((r) => r.status === "rejected")
      .map((r) =>
        logApiFailure({
          ...requestMeta,
          stage: "deepseek_partial",
          errorType: "upstream_partial",
          httpStatus: r.reason?.status,
          errorMessage: r.reason?.message || "",
          errorDetail: r.reason?.errText || "",
        })
      )
  );
}

async function fail(meta, status, payload) {
  // 2026-09-09: 原写法 `payload?.detail || ""` 会把 meta.errorDetail(上游原文)无条件
  // 覆盖成空 —— 后台 /admin-api-errors 的「详情」列因此一直是空的,502 排查无从下手。
  await logApiFailure({
    ...meta,
    httpStatus: status,
    errorMessage: payload?.error || "Unknown error",
    errorDetail: payload?.detail || meta?.errorDetail || "",
  });
  return Response.json(payload, { status });
}

// 空正文一律按上游失败回 502(与其他 upstream 失败同一套文案/状态码),并且**不计用量**
// —— 与本路由既有原则一致:失败的调用不扣次数。errorType 单列 empty_content,好让后台
// /admin-api-errors 一眼区分「上游报错」和「上游回了 200 但正文是空的」。
function failEmptyContent(requestMeta, path) {
  return fail(
    {
      ...requestMeta,
      stage: "deepseek",
      errorType: "empty_content",
      errorDetail: `upstream returned empty content (${path}, samples=1)`,
    },
    502,
    { error: "AI service temporarily unavailable. Please retry." },
  );
}

// ——— 流式回传(AI 讲解类调用) ———————————————————————————————————————
//
// 为什么要有这条路径:v4-flash 先推理再出正文,推理阶段一个 content 字节都不产生。
// 原来服务端把整条上游 SSE 拼完才回一个 JSON,浏览器在那几十秒里收不到任何字节,
// 客户端 60s 的**总时长**超时于是把一次正常的成功调用判成「AI 响应超时,请重试」
// (2026-09-14 用户截图)。改成边收边转发后:①正文一出现用户就能看到字在往外蹦;
// ②推理阶段发 SSE 注释行当心跳,客户端的静默计时器不断清零;③用户中途关掉页面时
// cancel() 会掐掉上游,不再为没人看的回答烧 token。
//
// 协议(极简,不是 OpenAI 那套):
//   ": ..."            → 心跳注释行,无数据,只用来证明连接还活着
//   data: {"delta":"…"} → 一段正文增量
//   data: {"done":true} → 正常结束
//   data: {"error":"…","status":502} → 失败(头已发出去了,只能在流里报)
const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx 类中间层默认会缓冲响应,那样流式就退化回一次性返回了。
  "X-Accel-Buffering": "no",
};

function sseData(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function streamDirect(apiKey, upstreamParams, requestMeta, usage, clientSignal, retryBudget = 0, deadlineAt = 0) {
  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();
  let clientGone = false;

  // 客户端断开有两条通知路径,两条都接上:
  //   ① request.signal —— Next 在连接断开时 abort 它(线上主路径);
  //   ② ReadableStream.cancel() —— 宿主取消这条响应流时触发。
  // 只挂其中一条就等于把「别再为没人看的回答烧 token」寄托在宿主的实现细节上。
  const giveUpOnClient = () => {
    clientGone = true;
    upstreamAbort.abort();
  };
  if (clientSignal) {
    if (clientSignal.aborted) giveUpOnClient();
    else clientSignal.addEventListener?.("abort", giveUpOnClient, { once: true });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          clientGone = true; // 客户端已断开,后面的分片直接丢掉
        }
      };
      // 立刻发一个注释行:让浏览器马上拿到首字节(不必等模型思考完),
      // 同时把客户端的静默计时器清零。
      send(": open\n\n");
      let sentAnyDelta = false;
      try {
        const { content, escalated } = await withBudgetEscalation(
          (budget, remainingMs) =>
            callDirectOnce(apiKey, { ...upstreamParams, maxTokens: budget }, {
              budgetMs: remainingMs,
              signal: upstreamAbort.signal,
              onEvent: (ev) => {
                if (ev.type === "delta") {
                  sentAnyDelta = true;
                  send(sseData({ delta: ev.text }));
                } else {
                  send(": tick\n\n");
                }
              },
            }),
          upstreamParams.maxTokens,
          retryBudget,
          deadlineAt,
        );
        if (clientGone) return;
        // 升档重试对用户完全透明:第一次连一个 delta 都没发出去(正文是空的),
        // 所以这条流看起来只是「想得久了一点」,不会出现半截讲解接另一半。
        if (escalated) await logBudgetEscalation(requestMeta, upstreamParams.maxTokens, retryBudget);
        if (!isNonEmptyContent(content)) {
          // 与非流式路径同一判据:空正文算上游失败,不计用量,单列 empty_content 好排查。
          await logApiFailure({
            ...requestMeta,
            stage: "deepseek",
            errorType: "empty_content",
            httpStatus: 502,
            errorMessage: "upstream returned empty content",
            errorDetail: "upstream returned empty content (direct-stream, samples=1)",
          });
          send(sseData({ error: "AI service temporarily unavailable. Please retry.", status: 502 }));
          return;
        }
        // 上游忽略了 stream(回的是整包 JSON)时一个 delta 都没发过,这里补发全文,
        // 否则客户端会收到「done 但没有正文」而误报空响应。
        if (!sentAnyDelta) send(sseData({ delta: content }));
        await recordAiUsage(usage.userCode, usage.cap, usage.day);
        send(sseData({ done: true }));
      } catch (err) {
        // 用户自己关掉页面导致的 abort 不是故障,不写 api_error_feedback。
        if (clientGone || upstreamAbort.signal.aborted) return;
        const upstreamStatus = Number(err?.status);
        const hasStatus = Number.isFinite(upstreamStatus) && upstreamStatus > 0;
        const status = hasStatus && upstreamStatus < 500 ? upstreamStatus : 502;
        await logApiFailure({
          ...requestMeta,
          stage: "deepseek",
          errorType: "upstream",
          httpStatus: status,
          errorMessage: err?.message || "upstream failed",
          errorDetail: describeUpstreamError(err),
        });
        send(sseData({ error: "AI service temporarily unavailable. Please retry.", status }));
      } finally {
        clientSignal?.removeEventListener?.("abort", giveUpOnClient);
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      // 客户端断开(用户退出/换页/客户端超时):掐掉上游,别再为没人看的回答烧 token。
      giveUpOnClient();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// Atomically record one unit of AI usage for the day, enforcing the cap as a
// race backstop. Prefers the increment_daily_usage RPC (single round-trip, no
// read-then-write race); if that RPC is missing — e.g. the migration hasn't
// been applied yet — it falls back to a best-effort upsert so usage is never
// silently un-metered. Always best-effort: a metering write must never turn a
// successful AI response into an error for the user.
async function recordAiUsage(userCode, cap, day) {
  if (!isSupabaseAdminConfigured || !userCode) return;
  try {
    const { error } = await supabaseAdmin.rpc("increment_daily_usage", {
      p_user_code: userCode,
      p_count: 1,
      p_cap: cap,
      p_date: day,
    });
    if (!error) return;
    await fallbackIncrementUsage(userCode, cap, day);
  } catch {
    await fallbackIncrementUsage(userCode, cap, day);
  }
}

async function fallbackIncrementUsage(userCode, cap, day) {
  try {
    const { data: existing } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", userCode)
      .eq("date", day)
      .maybeSingle();
    const used = existing?.usage_count || 0;
    if (used >= cap) return; // race backstop, mirrors the RPC's cap check
    if (existing) {
      await supabaseAdmin
        .from("daily_usage")
        .update({ usage_count: used + 1 })
        .eq("user_code", userCode)
        .eq("date", day);
    } else {
      await supabaseAdmin
        .from("daily_usage")
        .insert({ user_code: userCode, date: day, usage_count: 1 });
    }
  } catch {
    // Best-effort only — never block a successful AI response on a metering write.
  }
}

export async function POST(request) {
  const requestMeta = {
    clientId: request.headers.get("x-client-id") || "",
    clientIp: getIp(request),
    origin: request.headers.get("origin") || "",
    userAgent: request.headers.get("user-agent") || "",
  };
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return fail({ ...requestMeta, stage: "input" }, 413, { error: `Request body too large (>${MAX_BODY_BYTES} bytes).` });
    }
    if (!isOriginAllowed(request)) {
      return fail({ ...requestMeta, stage: "origin" }, 403, { error: "Forbidden origin." });
    }
    const rateKey = getRateLimitKey(request);
    if (rateKey && limiter.isLimited(rateKey)) {
      return fail({ ...requestMeta, stage: "rate_limit", errorType: "rate_limit" }, 429, { error: "Rate limit exceeded. Please retry shortly." });
    }
    const payload = await request.json();
    const bodyError = validateBody(payload);
    if (bodyError) {
      return fail({ ...requestMeta, stage: "input", errorType: "validation" }, 400, { error: bodyError });
    }

    // Server-side usage check + metering. Require a valid user code and enforce
    // the daily limit BEFORE spending a DeepSeek call. The authoritative
    // increment happens AFTER a successful response (see recordAiUsage below) so
    // that (a) the limit cannot be bypassed by a client that simply never calls
    // /api/usage, and (b) failed/transient AI errors don't consume a credit.
    let usageUserCode = "";
    let usageCap = 0;
    let usageDay = "";
    if (isSupabaseAdminConfigured) {
      const userCode = String(payload.userCode || "").toUpperCase().trim();
      if (!userCode || userCode.length !== 6) {
        return fail({ ...requestMeta, stage: "auth", errorType: "missing_user" }, 403, { error: "Authentication required." });
      }
      // 2026-09-13: 这里以前只解构 data,查库失败和「查无此人」都是 user==null,
      // 于是 PostgREST 一次 504 就被当成 403 Invalid user. —— 用户看到红字
      // "API error 403"(hook 直接渲染 e.message),而重试其实就能过。见 lib/userLookup.js。
      const { user, error: userLookupError } = await lookupUserTier(userCode);
      if (userLookupError) {
        return fail(
          {
            ...requestMeta,
            stage: "auth",
            errorType: "user_lookup_failed",
            errorDetail: userLookupError.message || String(userLookupError),
          },
          503,
          { error: "服务暂时不可用，请稍后重试", code: "USER_LOOKUP_FAILED" },
        );
      }
      if (!user) {
        return fail({ ...requestMeta, stage: "auth", errorType: "invalid_user" }, 403, { error: "Invalid user." });
      }
      // Check tier + expiry
      const isPro = user.tier === "legacy" || (user.tier === "pro" && !(user.tier_expires_at && new Date(user.tier_expires_at).getTime() <= Date.now()));
      const dailyLimit = isPro ? 100 : 3;
      const today = new Date().toISOString().split("T")[0];
      const { data: usage } = await supabaseAdmin
        .from("daily_usage")
        .select("usage_count")
        .eq("user_code", userCode)
        .eq("date", today)
        .maybeSingle();
      if ((usage?.usage_count || 0) >= dailyLimit) {
        const errMsg = isPro ? "服务繁忙，请稍后再试" : "Daily limit reached.";
        // `code` lets the client distinguish a free-tier daily limit (show an upgrade
        // path, not a futile "server busy" retry) from a transient rate limit.
        return fail({ ...requestMeta, stage: "usage", errorType: "daily_limit" }, 429, { error: errMsg, code: isPro ? "PRO_DAILY_CAP" : "DAILY_LIMIT" });
      }
      usageUserCode = userCode;
      usageCap = dailyLimit;
      usageDay = today;
    }

    const { system, message } = payload;
    const { maxTokens, temperature } = normalizeGenerationParams(payload);
    const retryBudget = normalizeRetryBudget(payload, maxTokens);
    const samples = normalizeSamples(payload);
    const upstreamParams = { system, message, maxTokens, temperature };
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const proxyUrl = resolveProxyUrl();
    // 一次请求(含可能的升档重试)共享的截止线,保证不被 Vercel 在 maxDuration 处斩断。
    const deadlineAt = Date.now() + DIRECT_TOTAL_BUDGET_MS;

    if (proxyUrl) {
      if (samples > 1) {
        // 服务端 fan-out：并行 N 发,收集成功的 content。用量只计 1 次。
        const results = await Promise.allSettled(
          Array.from({ length: samples }, () => callViaCurlOnce(apiKey, proxyUrl, upstreamParams)),
        );
        const contents = collectContents(results);
        if (contents.length === 0) {
          // 0 成功——与单采样 proxy 路径一致:抛错进外层 catch → 500。
          throw firstRejectionReason(results) || new Error("AI service temporarily unavailable.");
        }
        // 部分失败也要留痕(见 logPartialSampleFailures),与计量一起 best-effort。
        await Promise.all([
          recordAiUsage(usageUserCode, usageCap, usageDay),
          logPartialSampleFailures(requestMeta, results),
        ]);
        return Response.json({ content: contents[0], contents });
      }
      const { content, escalated } = await withBudgetEscalation(
        (budget, remainingMs) =>
          callViaCurlOnce(apiKey, proxyUrl, { ...upstreamParams, maxTokens: budget }, remainingMs),
        maxTokens,
        retryBudget,
        deadlineAt,
      );
      if (escalated) await logBudgetEscalation(requestMeta, maxTokens, retryBudget);
      if (!isNonEmptyContent(content)) return failEmptyContent(requestMeta, "proxy");
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    }

    // 讲解类调用(单采样)走流式回传;写作评分的多采样仍是一次性 JSON。
    if (payload.stream === true && samples === 1) {
      return streamDirect(
        apiKey,
        upstreamParams,
        requestMeta,
        { userCode: usageUserCode, cap: usageCap, day: usageDay },
        request.signal,
        retryBudget,
        deadlineAt,
      );
    }

    if (samples > 1) {
      // 直连路径 fan-out。单发失败(!res.ok 或网络异常)只算该采样失败。
      const results = await Promise.allSettled(
        Array.from({ length: samples }, () => callDirectOnce(apiKey, upstreamParams)),
      );
      const contents = collectContents(results);
      if (contents.length === 0) {
        // 0 成功——走现有 fail() 语义,取第一个失败采样的上游错误文本做 errorDetail。
        const reason = firstRejectionReason(results);
        const upstreamStatus = Number(reason?.status);
        const httpStatus = Number.isFinite(upstreamStatus) && upstreamStatus
          ? (upstreamStatus >= 500 ? 502 : upstreamStatus)
          : 502;
        return fail(
          { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: describeUpstreamError(reason) },
          httpStatus,
          { error: "AI service temporarily unavailable. Please retry." },
        );
      }
      // 部分失败也要留痕(见 logPartialSampleFailures),与计量一起 best-effort。
      await Promise.all([
        recordAiUsage(usageUserCode, usageCap, usageDay),
        logPartialSampleFailures(requestMeta, results),
      ]);
      return Response.json({ content: contents[0], contents });
    }

    // 单采样直连路径——与旧版逐字等价:!res.ok → fail(502/status),网络异常 → 外层 catch → 500。
    try {
      const { content, escalated } = await withBudgetEscalation(
        (budget, remainingMs) =>
          callDirectOnce(apiKey, { ...upstreamParams, maxTokens: budget }, { budgetMs: remainingMs }),
        maxTokens,
        retryBudget,
        deadlineAt,
      );
      if (escalated) await logBudgetEscalation(requestMeta, maxTokens, retryBudget);
      if (!isNonEmptyContent(content)) return failEmptyContent(requestMeta, "direct");
      await recordAiUsage(usageUserCode, usageCap, usageDay);
      return Response.json({ content });
    } catch (err) {
      const upstreamStatus = Number(err?.status);
      const hasStatus = Number.isFinite(upstreamStatus) && upstreamStatus > 0;
      // 带 status 的 HTTP 错误,或流里夹带的 {error} 对象(有 errText 无 status),都算
      // 上游失败 → 与 fan-out 路径同一套映射(5xx/无状态 → 502)。纯网络异常仍走外层 500。
      if (hasStatus || err?.errText) {
        // Log full upstream error for debugging, but don't expose details to client
        return fail(
          { ...requestMeta, stage: "deepseek", errorType: "upstream", errorDetail: describeUpstreamError(err) },
          hasStatus && upstreamStatus < 500 ? upstreamStatus : 502,
          { error: "AI service temporarily unavailable. Please retry." },
        );
      }
      throw err;
    }
  } catch (e) {
    return fail(
      { ...requestMeta, stage: "server", errorType: "internal" },
      500,
      { error: e.message || "Unexpected server error" }
    );
  }
}
