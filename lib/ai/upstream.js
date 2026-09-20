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

// ── 超时口径 ────────────────────────────────────────────────────────────────
//
// 2026-09-20 事故:DeepSeek 一段时间内整体变慢,连续五次调用各干等满 165s 的总
// 预算才被掐断。用户侧的表现是面试/听力评分「连接异常」,后台却只留下一条
// stage=server / internal 的 500,看不出是超时。两个口径因此都要改:
//
//   1) 无输出看门狗(PROGRESS):流式连上以后,超过这个时长没收到任何 token 就
//      判这一路卡死并重试。正常首字只要几秒,所以它不会误伤慢而正常的请求,
//      却能把「上游排队」从 165s 缩短到几十秒 —— 重试往往还能救回来。
//   2) 总预算(BUDGET):兜底,与旧版语义一致(耗尽即失败,不重试)。
//
// 看门狗窗口还要随预算等比收缩:预算只有 54s 的调用(听力讲解)若还等 45s 才判
// 卡死,重试就没时间了。取 45% 预算与默认值的较小者,并留 12s 下限。
export const DEFAULT_PROGRESS_TIMEOUT_MS = 45000;
const MIN_PROGRESS_TIMEOUT_MS = 12000;
const PROGRESS_BUDGET_RATIO = 0.45;

export function resolveProgressTimeout(totalBudgetMs, override) {
  // 显式指定优先于下面的下限:下限是给「按预算推算」兜底的,不该反过来把调用方
  // 明确要的窗口顶掉(测试里就靠它把窗口压到毫秒级)。
  if (Number(override) > 0) return Math.trunc(Number(override));
  const proportional = Math.floor(Number(totalBudgetMs) * PROGRESS_BUDGET_RATIO);
  if (!Number.isFinite(proportional) || proportional <= 0) return DEFAULT_PROGRESS_TIMEOUT_MS;
  return Math.max(MIN_PROGRESS_TIMEOUT_MS, Math.min(DEFAULT_PROGRESS_TIMEOUT_MS, proportional));
}

// 客户端外层超时与服务端上游预算必须对齐。客户端放弃的那一刻,这次调用就再没有
// 收件人了 —— 服务端继续等只是白烧 DeepSeek 的 token,并且这条失败会记成
// 「internal 500」而不是超时。留 CLIENT_RESPONSE_MARGIN_MS 给 fail() 写错误表 +
// 回包,保证客户端收到的是我们的 504 而不是它自己的 AbortError。
export const CLIENT_RESPONSE_MARGIN_MS = 6000;
export const MIN_UPSTREAM_BUDGET_MS = 15000;

export function resolveUpstreamBudget(clientTimeoutMs, serverBudgetMs) {
  const client = Number(clientTimeoutMs);
  if (!Number.isFinite(client) || client <= 0) return serverBudgetMs;
  return Math.max(MIN_UPSTREAM_BUDGET_MS, Math.min(serverBudgetMs, client - CLIENT_RESPONSE_MARGIN_MS));
}

// 我们自己掐断的两种超时(看门狗 / 预算),与「上游回了个 HTTP 错误」区分开:
// 前者该记 504 upstream_timeout,后者沿用 502/原状态码。带 status 的一律不是这里。
export function isUpstreamTimeoutError(err) {
  if (!err) return false;
  if (Number(err.status) > 0) return false;
  const code = String(err.code || "");
  if (code === "UPSTREAM_STALL" || code === "UPSTREAM_BUDGET") return true;
  if (err.name === "TimeoutError") return true;
  // proxy 路径(deepseekHttp)的超时只有文案,没有 code。
  return /timeout/i.test(String(err.message || ""));
}

// 把 DeepSeek 的 SSE 流拼成完整 content。规则(与官方文档一致):
//   - 空行 / 以 ":" 开头的 keep-alive 注释行 → 忽略
//   - "data: [DONE]" → 结束
//   - "data: {json}" → 取 choices[0].delta.content 追加(reasoning_content 不要)
//   - 流中 {error:...} → 抛错(带 errText),交由采样级失败处理
// 分片可能在任意字节处切开,所以按 "\n" 缓冲成整行再解析;半截行留到下一片。
//
// onProgress:每收到一个**真正的 token**(正文或推理)就回调一次,喂给
// callDirectOnce 的「无输出看门狗」。只认 token、不认 keep-alive 注释行 ——
// 注释只证明连接还在,不证明模型在产出,而我们要抓的恰恰是「连接开着但上游
// 在排队」那种卡死(2026-09-20 事故:五次调用各干等满 165s 预算)。
export async function readSseContent(body, { onProgress } = {}) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let finished = false;
  const ping = typeof onProgress === "function" ? onProgress : null;
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
    if (!delta) return;
    // reasoning_content 不进正文,但同样是「模型在产出」的证据 —— v4-flash 会先
    // 吐一大段推理再出正文,看门狗必须认它,否则长推理会被误判成卡死。
    if (ping && (typeof delta.content === "string" || typeof delta.reasoning_content === "string")) ping();
    if (typeof delta.content === "string") content += delta.content;
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
export async function readUpstreamContent(res, { onProgress } = {}) {
  const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream") && res.body) {
    return readSseContent(res.body, { onProgress });
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// 单次上游调用(直连路径)——成功返回 content 字符串;!res.ok 时抛出携带
// { status, errText } 的错误,网络异常照原样抛出(无 status)。多采样模式下
// 单发失败只算该采样失败,不会立刻拖垮整个请求。
// 复用 deepseekHttp.callWithRetry:只对「快速失败的 5xx / 连接重置」重试一次,
// 且剩余预算 >8s 才重试;超时、4xx(含 402 余额不足、429)一律不重试。
export async function callDirectOnce(apiKey, params, { totalBudgetMs, progressTimeoutMs } = {}) {
  const body = JSON.stringify(buildUpstreamPayload(params, { stream: true }));
  const progressWindow = resolveProgressTimeout(totalBudgetMs, progressTimeoutMs);

  const runAttempt = async (remainingMs) => {
    const controller = new AbortController();
    // 谁先掐的:"stall"(看门狗) / "budget"(总预算)。abort() 本身不带原因,
    // 不记下来就只能拿到一个无差别的 AbortError,分不清该不该重试。
    let abortKind = null;
    let progressTimer = null;

    const budgetTimer = setTimeout(() => {
      abortKind = abortKind || "budget";
      try { controller.abort(); } catch { /* 已中止 */ }
    }, Math.max(1000, Math.trunc(remainingMs)));

    const armProgress = () => {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = setTimeout(() => {
        abortKind = abortKind || "stall";
        try { controller.abort(); } catch { /* 已中止 */ }
      }, progressWindow);
    };
    const clearTimers = () => {
      clearTimeout(budgetTimer);
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
    };

    // 连接建立本身也在看门狗之内:上游排队时连响应头都不给。
    armProgress();
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        const err = new Error(`DeepSeek ${res.status}`);
        err.status = res.status;
        err.errText = errText;
        throw err;
      }
      return await readUpstreamContent(res, { onProgress: armProgress });
    } catch (e) {
      throw classifyDirectFailure(e, abortKind, progressWindow);
    } finally {
      clearTimers();
    }
  };

  return callWithRetry({ runAttempt, totalBudgetMs });
}

// 把 fetch/流读取抛出的错误翻译成带分类的上游错误。我们没掐断时原样放行
// (只把 undici 藏在 cause 里的 errno 提到顶层,好让重试分类器看见)。
function classifyDirectFailure(err, abortKind, progressWindow) {
  if (!abortKind) {
    if (err && !err.code && err.cause?.code) err.code = err.cause.code;
    return err;
  }
  if (abortKind === "stall") {
    // 失败得早 = 预算还剩很多,值得换一条连接重试一次(retryable 显式标注,
    // 否则 isRetryableTransportError 的启发式认不出这种自造错误)。
    const stalled = new Error(`DeepSeek stream stalled: no output for ${Math.round(progressWindow / 1000)}s`);
    stalled.code = "UPSTREAM_STALL";
    stalled.retryable = true;
    return stalled;
  }
  // 预算耗尽:再试也没时间了,保持不可重试(文案里的 timeout 就是旧版的判据)。
  const expired = new Error("DeepSeek request timeout: upstream budget exhausted");
  expired.code = "UPSTREAM_BUDGET";
  expired.retryable = false;
  return expired;
}

// 给 fail() 的 errorDetail:把上游原始状态码带上。表里的 http_status 是我们映射后
// 的 502,不带这个就分不清上游到底是 502/503/504 还是网络层断开。
export function describeUpstreamError(reason) {
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
export function isNonEmptyContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}
