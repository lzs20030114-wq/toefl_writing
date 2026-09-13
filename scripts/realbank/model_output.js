/**
 * 结构化阶段（structure_set.mjs）的模型调用预算 + 输出解析（纯函数，无 IO —— 供脚本与单测共用）。
 *
 * ── 为什么 CTW 要单独的预算（2026-09-13 实测根因）──
 * 第一来源 96 个 CTW 块里 88 个报「模型输出无法解析为 JSON」，items 为空。看模型原始响应后确认
 * **不是 JSON 格式问题**：deepseek-v4-flash 是推理模型，max_tokens 把推理 token 也算在内。
 * 填词块的推理特别长 —— 答案页的词与 OCR 残留对不上（1.21A 答案写 cover / living，屏幕是 ca__ / lea__）、
 * OCR 把某个残词整个吃掉（3.11 的 consists）时，模型会反复权衡几万字：
 *     1.21A reading|1|1-10|35 → 推理 13461 token、正文 870 字；3.11 reading|1|1-10|35 → 推理 13393 token。
 * 与旧预算 16000 贴得很近，推理稍长一点就把预算吃光，content 返回空串 → JSON.parse 失败。
 * 台账佐证：structure_set 历史 2675 次调用里 531 次 completion_tokens 恰好顶到 16000。
 * 所以 CTW 块给 32000 token；按实测 ~230 token/s，32000 要 ~140s，超时相应放到 300s ——
 * 否则一次长推理会撞 90s 超时，被 classifySystemicFailure 当成系统性失败整卷中止。
 * 选择题仍用旧预算（其失败另有转写/分栏原因，别让它们顺手变贵）。
 *
 * ── 正文为空要单独报 ──
 * 空正文与「真吐了坏 JSON」是两种病：前者是预算问题，后者才是格式问题。报成同一句话，
 * 下一次排查又得重新抓原始响应，所以 unparsableProblem 把两者分开。
 */

/** 各题型的调用预算。未列出的题型走 default。 */
const CALL_BUDGET = Object.freeze({
  default: Object.freeze({ maxTokens: 16000, timeoutMs: 90000 }),
  ctw: Object.freeze({ maxTokens: 32000, timeoutMs: 300000 }),
});

function callBudget(type) {
  return CALL_BUDGET[type] || CALL_BUDGET.default;
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

/** 解析失败时记进 problems 的那句话：正文为空（预算问题）与坏 JSON（格式问题）分开报。 */
function unparsableProblem(raw) {
  return String(raw || "").trim()
    ? "模型输出无法解析为 JSON"
    : "模型正文为空（推理把 max_tokens 预算吃光了），输出无法解析为 JSON";
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

module.exports = { CALL_BUDGET, callBudget, parseJsonLoose, unparsableProblem, matchBracket, ctwVisionCacheFile };
