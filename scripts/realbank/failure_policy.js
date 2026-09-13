/**
 * 结构化阶段的「这次失败要不要整卷停下」判据（纯函数，无 IO —— 供 structure_set.mjs 与单测共用）。
 *
 * ── 硬失败：继续跑只会得到同样的结果 ──
 * 事故背景：DeepSeek 账户欠费时每个题块都拿到 `DeepSeek 402: {"error":{"message":
 * "Insufficient Balance"}}`，被当成普通失败记成 error，然后**照常写出** .structured.json，
 * 把上一次花钱跑出来的好产物静默冲掉，整套卷 40 秒跑完还 exit 0。
 * 所以这几类一出现就整卷作废、不写产物：
 *   - HTTP 401/402/403/407/429：鉴权 / 余额 / 权限 / 代理鉴权 / 限流；
 *   - 缺 key、代理 schema 不支持、代理端口不是 HTTP 代理等配置错误；
 *   - 连接错误（ECONNREFUSED / ENOTFOUND / socket hang up …）。
 * 故意**不**把单块 5xx 算进来：deepseekHttp 内部已对 5xx 重试过一次，零星 5xx 更像抖动；
 * 真出现 5xx 风暴时由 structure_set 的「不许拿空结果覆盖既有产物」守卫兜底。
 *
 * ── 软失败：单块超时（2026-09-14 从硬失败降下来）──
 * 旧口径把「请求超时」也算硬失败，于是**一块慢 = 整卷作废**：这卷已经跑完的块一起丢，
 * run_pipeline 见退出码 3 还会把整批停掉。而超时恰恰与丢题最多的那些块强相关 ——
 * 推理长的块既容易顶满 max_tokens，也容易跑过超时线。等于「越是该救的块，越会把整卷拖垮」。
 *
 * 改为软失败：单次只把这一块记成 error（`--only-failed` 下次还能捡回来），
 * 累计到 SOFT_FAILURE_LIMIT 次才认定是网络/服务侧真故障并中止。
 * 真断网/服务挂了会连着超时，10 并发下几秒就能攒够；一块慢攒不够。
 */

/** 软失败累计到这个数就升级成系统性失败。 */
const SOFT_FAILURE_LIMIT = 5;

const HARD_HTTP = Object.freeze([401, 402, 403, 407, 429]);

/**
 * 识别一次调用失败。
 * @returns {null | {httpStatus, apiMessage, reason, text, soft?: true}}
 *   null  = 普通失败（模型输出不合格之类），照旧记 flagged/error 继续跑；
 *   soft  = 单块超时，攒够 SOFT_FAILURE_LIMIT 次才中止；
 *   其余  = 硬失败，立刻整卷作废。
 */
function classifySystemicFailure(err) {
  const text = String(err?.message || err || "");
  const blob = `${text} ${String(err?.code || "")}`;
  const m = text.match(/DeepSeek\s+(\d{3})\b/) || text.match(/proxy CONNECT failed:\s*(\d{3})/i);
  const httpStatus = m ? Number(m[1]) : null;
  const apiMessage = (text.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || "";
  const hit = (reason) => ({ httpStatus, apiMessage, reason, text });
  if (httpStatus && HARD_HTTP.includes(httpStatus)) return hit("鉴权/余额/权限/限流");
  if (/Missing DEEPSEEK_API_KEY/i.test(text)) return hit("没有 API key");
  if (/Insufficient Balance|insufficient[_ ]quota|Authentication Fails|invalid[_ ]api[_ ]key/i.test(text)) return hit("余额或鉴权");
  // 单块超时是软失败 —— 见头注。ETIMEDOUT 这类**连接**级超时仍算硬失败（下一条）：
  // 那是连不上，不是这一块算得久。
  if (/timeout/i.test(text) && !/ETIMEDOUT/.test(blob)) return { ...hit("请求超时"), soft: true };
  if (/socket hang up|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ECONNABORTED|ENETUNREACH/i.test(blob)) return hit("连接错误");
  if (/SOCKS proxy is not supported|Unsupported proxy schema|not a valid HTTP proxy/i.test(text)) return hit("代理配置错误");
  return null;
}

/**
 * 给定一次分类结果与当前软失败计数，决定要不要中止。
 * @returns {{abort: boolean, softFailures: number, info: object|null}}
 *   info 非空 = 要记成系统性失败并中止（reason 里带上攒了几次）。
 */
function escalate(sys, softFailures = 0) {
  if (!sys) return { abort: false, softFailures, info: null };
  if (!sys.soft) return { abort: true, softFailures, info: sys };
  const next = softFailures + 1;
  if (next < SOFT_FAILURE_LIMIT) return { abort: false, softFailures: next, info: null };
  return {
    abort: true,
    softFailures: next,
    info: { ...sys, reason: `${sys.reason}（累计 ${next} 次，判为网络/服务侧故障）` },
  };
}

module.exports = { SOFT_FAILURE_LIMIT, HARD_HTTP, classifySystemicFailure, escalate };
