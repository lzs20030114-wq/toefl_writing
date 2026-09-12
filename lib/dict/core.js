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
