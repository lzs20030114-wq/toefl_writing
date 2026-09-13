/**
 * 结构化阶段（structure_set.mjs）的模型调用预算 + 输出解析（纯函数，无 IO —— 供脚本与单测共用）。
 *
 * ── 为什么预算要按题型给、超时要从预算算出来（2026-09-13 实测根因）──
 * 第一来源 96 个 CTW 块里 88 个报「模型输出无法解析为 JSON」，items 为空。看模型原始响应后确认
 * **不是 JSON 格式问题**：deepseek-v4-flash 是推理模型，max_tokens 把推理 token 也算在内。
 * 填词块的推理特别长 —— 答案页的词与 OCR 残留对不上（1.21A 答案写 cover / living，屏幕是 ca__ / lea__）、
 * OCR 把某个残词整个吃掉（3.11 的 consists）时，模型会反复权衡几万字：
 *     1.21A reading|1|1-10|35 → 推理 13461 token、正文 870 字；3.11 reading|1|1-10|35 → 推理 13393 token。
 * 与旧预算 16000 贴得很近，推理稍长一点就把预算吃光，content 返回空串 → JSON.parse 失败。
 * 台账佐证：structure_set 历史 2675 次调用里 531 次 completion_tokens 恰好顶到 16000。
 *
 * ── 2026-09-14：这条闸对所有题型生效，但上一轮只给 CTW 修过 ──
 * 上一轮的结论是「选择题的失败另有转写/分栏原因」，于是只有 ctw 拿到 32000 / 300s，
 * 其余（ap / rdl / lcr / lc / la / lat / 修复轮）继续走 16000 / 90s。两条证据说明这个判断不成立：
 *   1. 顶到 16000 的 531 次调用**多于**全部 CTW 块曾经发生过的调用数（CTW 每套 3 块 × ~70 套 ≈ 210 块，
 *      加上两轮重跑也到不了 531），所以选择题块同样在顶预算；
 *   2. 09-13 那轮 `--only-failed` **没改任何代码**原地重跑，165 个 flagged 块救回 81 块（≈50%）。
 *      确定性的「模型吐坏 JSON」不会靠重跑救回一半 —— 一半一半是预算/超时抖动的签名。
 * 对应的丢题路径：预算吃光 → 正文空/截断 → flagged → 从不进盲审 → 这道真题再也不会出现在库里。
 *
 * ── 超时必须从预算算出来，不许手写 ──
 * 90s 的老超时本身就是丢题机制：按实测 ~230 token/s，16000 token 要跑 ~70s，紧贴 90s 墙；
 * 一旦撞上，structure_set 的 classifySystemicFailure 把「请求超时」当系统性失败 → **整卷作废、
 * 不写产物、退出码 3 → run_pipeline 整批停**。即「一块慢，整卷白跑」。
 * 所以这里不再手写 timeout：`budgetOf(maxTokens)` 按 实测速率 × 安全系数 + 握手余量 算出来，
 * 新加题型不可能再配出一个撞墙的组合。
 */

/** 实测生成速率（token/s）。来源同上：32000 token 约 140s。 */
const TOKENS_PER_SEC = 230;
/** 安全系数：预算跑满也要留一倍余量（推理模型速率抖动大，10 并发下更抖）。 */
const TIMEOUT_SAFETY = 2;
/** 建连 + TTFT 余量（ms）。 */
const HANDSHAKE_MS = 30000;

/** 由 max_tokens 推出超时：跑满预算也撞不到墙。 */
function budgetOf(maxTokens) {
  return Object.freeze({
    maxTokens,
    timeoutMs: Math.ceil(maxTokens / TOKENS_PER_SEC) * TIMEOUT_SAFETY * 1000 + HANDSHAKE_MS,
  });
}

/**
 * 各题型的调用预算。未列出的题型走 default。
 *
 * ctw 32000：填词块的推理最长（见上）。
 * 选择题 24000：正文（材料原文可能整篇带进来）+ 4 选项 + 推理；16000 已实证会顶。
 * 修复轮 24000：一次问 3 个相邻块、要还原多道题，输出比单块还长。
 * default 24000：新题型宁可给足 —— max_tokens 是上限不是账单，用不到就不花钱，
 *               顶到上限却要重跑（甚至整卷作废）才是真花钱。
 */
const CALL_BUDGET = Object.freeze({
  default: budgetOf(24000),
  ctw: budgetOf(32000),
  rdl: budgetOf(24000),
  ap: budgetOf(24000),
  lcr: budgetOf(24000),
  lc: budgetOf(24000),
  la: budgetOf(24000),
  lat: budgetOf(24000),
  listening_mcq: budgetOf(24000),
  mcq_repair: budgetOf(24000),
});

function callBudget(type) {
  return CALL_BUDGET[type] || CALL_BUDGET.default;
}

/**
 * 预算不够时的重试预算：翻倍，但不超过**实测跑通过的**上限。
 * 只在失败签名是「预算形」（正文为空 / 被截断）时用 —— 见 isBudgetProblem。
 * 重试一次的成本只落在本来就已经丢掉的块上，是把白花的钱换成题。
 *
 * 为什么封在 32000 而不是更大：32000 是这条链路上唯一被实测证明能跑通的最大预算
 * （CTW 从 09-13 起一直在用）。再往上没人验证过，API 若因超限直接 400，
 * 这次本来能救的重试就白费了 —— 比预算小一点更糟。要抬先实测。
 * 已经等于或高于上限的题型，重试用同一预算再打一次（正文为空本身就带随机性）。
 */
const RETRY_MAX_TOKENS_CAP = 32000;
function retryBudget(budget) {
  const base = budget && Number(budget.maxTokens) ? Number(budget.maxTokens) : CALL_BUDGET.default.maxTokens;
  return budgetOf(Math.max(base, Math.min(base * 2, RETRY_MAX_TOKENS_CAP)));
}

/**
 * 从 s[start]（必须是 "{" 或 "["）开始，按括号配对（跳过字符串里的括号与转义）找到对应的收尾下标。
 * 找不到（被截断）返回 -1。
 */
function matchBracket(s, start) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/**
 * 宽松解析模型输出里的 JSON。解析不出返回 null。
 *
 * 依次尝试：
 *  1. 去掉首尾 markdown 围栏后整体 JSON.parse（旧实现第一步，原样保留）；
 *  2. 第一个 { / [ 到最后一个 } / ] 的切片（旧实现第二步，原样保留）；
 *  3. 按括号配对逐段取**顶层**的完整 JSON 值（跳过字符串里的括号），第一段能解析的就是 —— 接住
 *     「JSON 后面还跟着带括号的解释文字」「前面一段说明里带着括号」这类旧实现切不准的输出。
 * 截断的 JSON 一律返回 null：不猜、不补括号，也**不退而求其次拿里面某个完整的子对象凑数**
 * （那会把一个空位 {"word","given"} 当成整块产物，报错文案跟着跑偏）。
 */
function parseJsonLoose(raw) {
  const s = String(raw || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* 继续兜底 */ }
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const close = s[start] === "[" ? "]" : "}";
  const end = s.lastIndexOf(close);
  if (end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* 继续兜底 */ }
  }
  let i = start;
  while (i >= 0) {
    const j = matchBracket(s, i);
    if (j < 0) return null;                       // 从这里起被截断
    try { return JSON.parse(s.slice(i, j + 1)); } catch { /* 这一段不是合法 JSON：整段跳过 */ }
    const next = s.slice(j + 1).search(/[[{]/);
    i = next < 0 ? -1 : j + 1 + next;
  }
  return null;
}

/**
 * 解析失败时记进 problems 的那句话。三种病要分开报，因为处置完全不同：
 *   empty      正文为空 —— 推理把预算吃光，一个字没吐。加预算重试能救。
 *   truncated  JSON 吐到一半没收尾 —— 同样是顶到 max_tokens。加预算重试能救。
 *   unparsable 有完整结构但不是合法 JSON / 压根没有 JSON —— 真格式病，重试多半还是这样。
 *
 * 为什么值得分：2026-09-13 那轮把 AP 的 70 道题记成「纯 JSON 失败」，按格式病排查，
 * 直到查 CTW 才发现是预算病 —— 报同一句话，就会把预算病一次次误诊成格式病。
 */
const BUDGET_PROBLEM = Object.freeze({
  empty: "模型正文为空（推理把 max_tokens 预算吃光了），输出无法解析为 JSON",
  truncated: "模型输出在中途被截断（顶到 max_tokens 预算），输出无法解析为 JSON",
});
const FORMAT_PROBLEM = "模型输出无法解析为 JSON";

/** 输出属于哪种失败："empty" | "truncated" | "unparsable"。只在 parseJsonLoose 已返回 null 时有意义。 */
function classifyBadOutput(raw) {
  const s = String(raw || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  if (!s) return "empty";
  const start = s.search(/[[{]/);
  if (start < 0) return "unparsable";        // 压根没有 JSON 结构：不是预算病
  let i = start;
  while (i >= 0) {                            // 逐个顶层值扫：扫到没收尾的那个就是被截断
    const j = matchBracket(s, i);
    if (j < 0) return "truncated";
    const next = s.slice(j + 1).search(/[[{]/);
    i = next < 0 ? -1 : j + 1 + next;
  }
  return "unparsable";
}

function unparsableProblem(raw) {
  const kind = classifyBadOutput(raw);
  return BUDGET_PROBLEM[kind] || FORMAT_PROBLEM;
}

/** 这条 problem 是不是「预算形」失败（加预算重试有意义）。 */
function isBudgetProblem(problem) {
  return Object.values(BUDGET_PROBLEM).includes(String(problem || ""));
}

/**
 * structure_set.mjs --ctw-vision-body 读的看图转写缓存文件名（.codex-tmp/ocr 下）。
 * 必须与 ctw_vision_transcribe.py 写缓存的口径一致：ocr_images.cache_path 用 Python 的 re.sub(r"[^\w.-]+", "_", …)
 * （Python 3 的 \w 含中文等 Unicode 字母数字），这里是它的 JS 等价写法。对不上 = 开关静默不生效。
 */
function ctwVisionCacheFile(setname, module, start, end) {
  const base = `${setname}_M${module}_${start}-${end}`.replace(/[^\p{L}\p{N}_.-]+/gu, "_");
  return `ctwvis__${base}__img1.txt`;
}

module.exports = {
  CALL_BUDGET, callBudget, budgetOf, retryBudget,
  parseJsonLoose, matchBracket,
  unparsableProblem, classifyBadOutput, isBudgetProblem, BUDGET_PROBLEM,
  ctwVisionCacheFile,
};
