/**
 * DeepSeek 调用台账 (usage ledger)
 *
 * 背景：2026-09-01 一次本地批量脚本跑掉 518 次 DeepSeek 调用 (¥11.97)，事后只能靠
 * 账单倒推——本地脚本直连 API、没有任何计数。这个模块让每一次调用都在本地留下一行
 * jsonl，配合 scripts/ops/deepseek-usage-report.mjs 做事后对账。
 *
 * 设计约束：
 *  - 模块顶层零副作用（不读文件、不注册监听），否则 jsdom 测试会被污染；
 *  - recordUsage 永不抛错，台账写失败绝不能影响真正的业务调用；
 *  - Vercel / edge runtime 上文件系统不可持久写，直接 no-op。
 */

const fs = require("fs");
const path = require("path");

// 9/1 账单实测的混合单价 (¥/M tokens)：¥11.97 / 2.28M tokens ≈ 5.24
const DEFAULT_CNY_PER_MTOK = 5.24;
// 每记满这么多次在 stderr 报一次进度，防止「跑飞了没人发现」
const PROGRESS_EVERY = 25;
const ERROR_MAX_LEN = 200;

function repoRoot() {
  return path.resolve(__dirname, "../..");
}

/** 台账文件路径：DEEPSEEK_USAGE_LOG 覆盖，否则 <repo>/.ops/deepseek-usage.jsonl */
function resolveLedgerPath() {
  const raw = process.env.DEEPSEEK_USAGE_LOG;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && trimmed !== "0") return trimmed;
  }
  return path.join(repoRoot(), ".ops", "deepseek-usage.jsonl");
}

/** DEEPSEEK_USAGE_LOG=0 关闭；Vercel / edge runtime 上强制 no-op */
function isLedgerEnabled() {
  if (process.env.DEEPSEEK_USAGE_LOG === "0") return false;
  if (process.env.VERCEL) return false;
  if (process.env.NEXT_RUNTIME === "edge") return false;
  return true;
}

/** 调用方没传 script 时用入口脚本文件名兜底 */
function defaultScriptName() {
  try {
    return path.basename(process.argv[1] || "") || "unknown";
  } catch (_) {
    return "unknown";
  }
}

/** ¥/M tokens 费率，可用 DEEPSEEK_CNY_PER_MTOK 覆盖 */
function cnyPerMtok() {
  return Number(process.env.DEEPSEEK_CNY_PER_MTOK) || DEFAULT_CNY_PER_MTOK;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function estimateCny(totalTokens, rate = cnyPerMtok()) {
  return (Number(totalTokens) || 0) * (Number(rate) || 0) / 1e6;
}

/** 小额用 4 位小数，避免真实成本被四舍五入成 ¥0.00 */
function formatCny(value) {
  const n = Number(value) || 0;
  return n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

// 进程内累计计数。惰性创建 —— 顶层不能有副作用。
let counters = null;

function ensureCounters() {
  if (!counters) counters = { calls: 0, tokens: 0, exitHooked: false };
  return counters;
}

function progressLine(c) {
  return `[deepseek-usage] 本进程已调用 ${c.calls} 次 · ${c.tokens} tokens · ≈¥${formatCny(estimateCny(c.tokens))}`;
}

function emitProgress(c) {
  if (process.env.DEEPSEEK_USAGE_QUIET === "1") return;
  try {
    process.stderr.write(`${progressLine(c)}\n`);
  } catch (_) {
    /* stderr 不可写也不能炸 */
  }
}

function ensureExitHook(c) {
  if (c.exitHooked) return;
  c.exitHooked = true;
  try {
    process.on("exit", () => {
      if (c.calls >= 1) emitProgress(c);
    });
  } catch (_) {
    /* 注册失败就算了 */
  }
}

/**
 * 追加一行台账。永不抛错；禁用或写失败时返回 false。
 *
 * @param {object} entry
 * @param {string} [entry.script] 调用方脚本名（默认取 argv[1] 的 basename）
 * @param {string} [entry.label]  自定义标签（题型 / 阶段等）
 * @param {string} [entry.model]  DeepSeek model
 * @param {object} [entry.usage]  DeepSeek 原样的 data.usage（缺字段容错为 0）
 * @param {number} [entry.ms]     耗时
 * @param {boolean} [entry.ok]    是否成功
 * @param {string} [entry.error]  失败原因（截 200 字）
 * @returns {boolean} 是否真的写进去了
 */
function recordUsage(entry) {
  try {
    if (!isLedgerEnabled()) return false;

    const e = entry || {};
    const usage = e.usage || {};
    const promptTokens = toInt(usage.prompt_tokens);
    const completionTokens = toInt(usage.completion_tokens);
    const totalTokens = toInt(usage.total_tokens) || promptTokens + completionTokens;
    const cachedTokens = toInt(
      usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
    );

    const row = { ts: new Date().toISOString(), script: String(e.script || defaultScriptName()) };
    if (e.label) row.label = String(e.label);
    row.model = String(e.model || "unknown");
    row.prompt_tokens = promptTokens;
    row.completion_tokens = completionTokens;
    row.total_tokens = totalTokens;
    row.cached_tokens = cachedTokens;
    row.ms = toInt(e.ms);
    row.ok = e.ok !== false;
    if (e.error) row.error = String(e.error).slice(0, ERROR_MAX_LEN);
    row.pid = process.pid;

    const filePath = resolveLedgerPath();
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");

    const c = ensureCounters();
    ensureExitHook(c);
    c.calls += 1;
    c.tokens += totalTokens;
    if (c.calls % PROGRESS_EVERY === 0) emitProgress(c);

    return true;
  } catch (_) {
    // 台账是观测设施，永远不许影响主链路
    return false;
  }
}

/** 读台账为对象数组（坏行跳过；文件不存在返回 []） */
function readLedger(filePath) {
  const target = filePath || resolveLedgerPath();
  let raw = "";
  try {
    raw = fs.readFileSync(target, "utf8");
  } catch (_) {
    return [];
  }
  const rows = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") rows.push(parsed);
    } catch (_) {
      /* 坏行跳过 */
    }
  }
  return rows;
}

module.exports = {
  DEFAULT_CNY_PER_MTOK,
  resolveLedgerPath,
  isLedgerEnabled,
  defaultScriptName,
  cnyPerMtok,
  estimateCny,
  formatCny,
  recordUsage,
  readLedger,
};
