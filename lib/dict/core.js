// 划词词典的纯查询逻辑（不碰浏览器 API，便于直接跑测试）。
// 分片数据形状见 scripts/dict/build-dict.mjs：
//   { [词形]: { p: 音标, t: 释义, g: 标签, w?: 原形 } | "同片内另一个词形（别名）" }

/**
 * 把页面上选中的原始文本收拾成可查的词：小写、剥掉两侧标点/引号、去掉所有格。
 * 词组（中间有空格/连字符）原样保留——ECDICT 收了相当多的短语词条。
 */
export function normalizeWord(raw) {
  if (!raw) return "";
  let w = String(raw)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/‐/g, "-")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  // 剥两侧非字母数字（内部的 ' 和 - 要留着）
  w = w.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
  // 所有格：student's → student，students' → students
  w = w.replace(/'s$/, "").replace(/'$/, "");
  return w;
}

/** 词库没收录时的最后一招：常见屈折后缀剥离。 */
export function naiveStems(w) {
  const out = [];
  const push = (s) => {
    if (s && s.length > 1 && s !== w && !out.includes(s)) out.push(s);
  };
  if (/ies$/.test(w)) push(`${w.slice(0, -3)}y`);
  if (/ves$/.test(w)) {
    push(`${w.slice(0, -3)}f`);
    push(`${w.slice(0, -3)}fe`);
  }
  if (/(ses|xes|zes|ches|shes)$/.test(w)) push(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));
  if (/ied$/.test(w)) push(`${w.slice(0, -3)}y`);
  if (/ed$/.test(w)) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
    const s = w.slice(0, -2);
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) push(s.slice(0, -1));
  }
  if (/ing$/.test(w)) {
    const s = w.slice(0, -3);
    push(s);
    push(`${s}e`);
    if (s.length > 2 && s[s.length - 1] === s[s.length - 2]) push(s.slice(0, -1));
  }
  if (/(er|est)$/.test(w)) {
    push(w.replace(/(er|est)$/, ""));
    push(w.replace(/(er|est)$/, "e"));
  }
  if (/ly$/.test(w)) {
    push(w.slice(0, -2));
    push(`${w.slice(0, -2)}e`);
  }
  return out;
}

/** 词库分片里该放哪一片。 */
export function shardOf(word) {
  const c = word[0];
  return c >= "a" && c <= "z" ? c : "_";
}

/** 从一张分片表里取词条，顺带解开别名。返回 { word, p, t, g, queried } 或 null。 */
export function resolveFromShard(shard, key) {
  if (!shard) return null;
  const hit = shard[key];
  if (!hit) return null;
  if (typeof hit === "string") {
    const target = shard[hit];
    if (!target || typeof target === "string") return null;
    return { ...target, word: hit, queried: key };
  }
  // w = 构建期内联的原形（跨首字母的不规则变形）
  return { ...hit, word: hit.w || key, queried: key };
}

/**
 * 词性/领域前缀：`n. `、`vt. `、`a. `（可以连写成 `n. vt. `），或 `[法] ` 这类领域标。
 */
const POS_PREFIX = /^((?:[a-z]+\.\s*)+|\[[^\]]+\]\s*)/;

/** 一行里最多展开几条义项 —— 再多用户也不会逐条看，反而把弹窗撑成一面墙。 */
const MAX_SENSES_PER_LINE = 8;

/**
 * 把词典条目的释义字段 `t` 拆成「一个词性一行、行内若干条义项」。
 *
 * ECDICT 的 t 是整条词条堆在一起的多行文本，例如 pattern：
 *   n. 模范, 典型, 式样, 样品, 图案, 格调, 模式
 *   vt. 模仿, 仿造, 以图案装饰
 *   vi. 形成图案
 * 整条直接存进单词本，复习时七个义项对不上原句；拆出来才能让用户点定「这句里是哪个意思」。
 *
 * 返回 [{ pos, senses }]（pos 可能为空串）。整条总共只有 ≤ 1 个义项时返回 []：
 * 那种词根本没有「选哪个义项」这回事，调用方据此退回纯文本展示。
 */
export function splitSenses(t) {
  const text = typeof t === "string" ? t : "";
  if (!text.trim()) return [];
  const out = [];
  let total = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = POS_PREFIX.exec(line);
    const pos = m ? m[1].trim() : "";
    const rest = (m ? line.slice(m[0].length) : line).trim();
    const senses = [];
    for (const piece of rest.split(/[,，;；]\s*/)) {
      const one = piece.trim();
      if (!one || senses.includes(one)) continue;
      senses.push(one);
    }
    if (senses.length === 0) continue;
    const capped = senses.slice(0, MAX_SENSES_PER_LINE);
    out.push({ pos, senses: capped });
    total += capped.length;
  }
  // 单义项的词不值得渲染成一颗可点的 chip：点不点结果一样。
  if (total <= 1) return [];
  return out;
}

/** 在整篇原文里定位该词所在的句子，给 AI 当上下文。 */
export function sentenceAround(passage, word) {
  if (!passage || !word) return "";
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let m = null;
  try {
    m = new RegExp(`\\b${esc}\\b`, "i").exec(passage);
  } catch {
    return "";
  }
  if (!m) return "";
  const at = m.index;
  let s = at;
  let e = at;
  while (s > 0 && !/[.!?]/.test(passage[s - 1])) s -= 1;
  while (e < passage.length && !/[.!?]/.test(passage[e])) e += 1;
  return passage.slice(s, Math.min(e + 1, passage.length)).trim();
}

/**
 * 复盘页题目区的查词上下文：原文在前、题干和选项在后。
 * 词在原文里出现就取原文那句；只出现在题目里（例如干扰项的词）才落到题干/选项上。
 * 每条题干/选项补上句号收尾，免得 sentenceAround 把相邻几条选项连成一句。
 */
export function questionLookupContext(passage, questions) {
  const parts = [];
  const push = (t) => {
    const s = String(t || "").trim();
    if (s) parts.push(/[.!?]$/.test(s) ? s : `${s}.`);
  };
  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q) continue;
    push(q.stem || q.question);
    const opts = q.options;
    if (Array.isArray(opts)) opts.forEach((o) => push(typeof o === "string" ? o : o && o.text));
    else if (opts && typeof opts === "object") Object.values(opts).forEach((o) => push(typeof o === "string" ? o : o && o.text));
  }
  return [String(passage || "").trim(), parts.join(" ")].filter(Boolean).join("\n\n");
}
