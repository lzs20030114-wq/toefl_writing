/**
 * 结构化阶段的失败处置判据（纯函数，无 IO —— 供 structure_set.mjs 与单测共用）：
 * ① 这次调用失败要不要整卷停下（classifySystemicFailure / escalate）；
 * ② `--only-failed` 重扫时，哪些失败块值得再花一次钱（shouldResweep）。
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

/* ── --only-failed 的重扫判据 ───────────────────────────────────────────── */

/**
 * 合流跑过之后，这两科的记录就**不归 structure_set 管了**。
 *
 * 实证（2026-09-14 顺着「听力不用重扫吧」这句话核出来的）：
 *   · structure_set 的块 key 是 `section|module|start-end|total`（如 `listening|1|13-14|32`）；
 *   · 两个来源的合流写回时把 key 换成了 `listening|{mod}|{q_start}`（如 `listening|1|13`）
 *     与 `speaking|1|repeat|1` / `speaking|1|interview|1`。
 * 两种格式**零重合**。于是在合流过的卷上跑 `--only-failed --sections listening`：
 *   1. 按 key 查不到任何既有记录 → 每个块都被当成「没跑过」→ 不是「只扫失败的」，
 *      而是**整科全量重跑，每块都付钱**；
 *   2. 跑出来的结果 key 也对不上，merge 回写时只能**追加**，产物里同一段听力出现两份
 *      （合流那份 + 生料那份），直到下次跑合流整体覆盖才清掉。
 *
 * 而且重跑也换不来题：听力题的正文/轮次/说话人来自商家逐字稿 PDF + ASR 对齐（合流层），
 * 音频是商家原声（388/440 条），structure_set 只负责把答题屏上的题干选项转写出来。
 * 听力扣题的原因（transcript_mismatch / diarization_failed / group_count_mismatch /
 * transcript_truncated / screen_items_missing …）全部判在合流层，重跑结构化一条都治不了。
 *
 * 所以：合流过的卷，这两科直接不派活。要修得回合流那一层
 * （lc_gender_worksheet 标性别、补音频、人工切轮次，再重跑 merge_*_asr）。
 */
const MERGE_OWNED_SECTIONS = Object.freeze(["listening", "speaking"]);

/** 这一科在这份产物里是否已经归合流所有。existing 是磁盘上的 structured.json。 */
function isMergeOwned(section, existing) {
  return Boolean(existing && existing.merged_asr) && MERGE_OWNED_SECTIONS.includes(section);
}

/** 已经跑成功、或本来就不该结构化的状态：不重扫。 */
const DONE_STATUSES = Object.freeze(["ok", "passage_screen", "deferred"]);

/**
 * 这个块值得再花一次钱重扫吗。
 *
 * @param {object} unit  待处理块（要 type 与 answers）
 * @param {object} prev  既有产物里同 key 的记录（没有就传 null/undefined）
 * @param {number} [ctwMinAnswers] 真 CTW 块恒 10 空，少于这个数的是路由误判
 * @returns {{resweep: boolean, skip: string|null}} skip = 跳过原因的机器可读标签
 */
function shouldResweep(unit, prev, ctwMinAnswers = 5) {
  if (prev && DONE_STATUSES.includes(prev.status)) return { resweep: false, skip: "already_done" };
  // 合流层扣下的块重扫没有意义：听力/口语记录经 merge_first_source_asr / merge_vendor_asr
  // 改写后都带 merged_by，它们的 flagged 来自对齐/性别/段数/无文档题干这些**合流层**的病。
  // 结构化只看 OCR 文本、根本不碰音频，重跑一分钱都治不了，结果照旧扣下 —— 纯烧钱。
  // 要治得回合流那一层（lc_gender_worksheet 标性别、补音频、人工切轮次）。
  if (prev && prev.merged_by) return { resweep: false, skip: "merge_held" };
  if (unit && unit.type === "ctw" && (unit.answers || []).length < ctwMinAnswers) {
    return { resweep: false, skip: "ctw_misrouted" };
  }
  return { resweep: true, skip: null };
}

module.exports = {
  SOFT_FAILURE_LIMIT, HARD_HTTP, DONE_STATUSES, MERGE_OWNED_SECTIONS,
  classifySystemicFailure, escalate, shouldResweep, isMergeOwned,
};
