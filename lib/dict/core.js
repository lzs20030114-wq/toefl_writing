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
 * 词性/领域前缀：`n. `、`vt. `（可以连写成 `n. vt. `），以及 `[计] ` 这类领域标；
 * 两者可以同时出现（`[医] n. 心脏`），所以合成一个可重复的前缀段一起吃掉。
 */
const POS_PREFIX = /^((?:\[[^\]]+\]\s*|[a-z]+\.\s*)+)/;
/** 从前缀段里逐个抠出 token：`[计]` 或 `vt.`。 */
const PREFIX_TOKEN = /\[[^\]]+\]|[a-z]+\./g;

/**
 * ECDICT 的词性缩写 → 中文。
 * `vt.` / `vi.` / `a.` / `ad.` 是英汉词典的行话，对着一张复习卡的学生没有义务认得；
 * 而「这个词做名词是什么意思、做动词又是什么意思」恰恰是背单词时最该看见的结构。
 * 表里没有的（词库里偶尔冒出的生僻缩写）原样回显，不猜。
 */
export const POS_LABEL = {
  "n.": "名词",
  "v.": "动词",
  "vt.": "及物动词",
  "vi.": "不及物动词",
  "vbl.": "动词变形",
  "aux.": "助动词",
  "a.": "形容词",
  "adj.": "形容词",
  "ad.": "副词",
  "adv.": "副词",
  "prep.": "介词",
  "conj.": "连词",
  "pron.": "代词",
  "num.": "数词",
  "art.": "冠词",
  "int.": "感叹词",
  "interj.": "感叹词",
  "abbr.": "缩写",
  "pl.": "复数",
  "pref.": "前缀",
  "suf.": "后缀",
  "comb.": "构词成分",
};

/**
 * ECDICT 方括号领域标的单字缩写 → 中文全称。
 * 词库里这些一律缩到一个字（`[计] 改变`），学生根本猜不出「计」是计算机 ——
 * 而领域义项恰恰是最该被认出来、然后跳过的那种：它对考试没用，
 * 看不懂却会让人以为这就是这个词的意思。
 * 表里没有的原样回显：长尾的 `[人名]`、`[网络]`、`[法律]` 本身就是词，展不展开都一样。
 */
export const DOMAIN_LABEL = {
  计: "计算机", 医: "医学", 法: "法律", 化: "化学", 经: "经济", 机: "机械",
  电: "电子", 建: "建筑", 物: "物理", 数: "数学", 生: "生物", 植: "植物",
  动: "动物", 天: "天文", 地: "地质", 军: "军事", 农: "农业", 商: "商业",
  体: "体育", 宗: "宗教", 音: "音乐", 乐: "音乐", 心: "心理", 语: "语言学",
  修: "修辞", 统: "统计", 会: "会计", 管: "管理", 邮: "邮政", 摄: "摄影",
  无: "无线电", 海: "航海", 空: "航空", 纺: "纺织", 矿: "采矿", 冶: "冶金",
  印: "印刷", 自: "自动化", 食: "食品", 林: "林业", 渔: "渔业", 石: "石油",
  核: "核能", 微: "微生物", 解: "解剖", 药: "药学", 症: "医学·症状",
  疾: "医学·疾病", 俚: "俚语", 口: "口语", 古: "古语", 诗: "诗歌用语",
  方: "方言", 美: "美式", 英: "英式", 复: "复数",
};

/** `vt.` → `及物动词`（不认得就原样回显）。 */
export function posLabel(tag) {
  const k = String(tag || "").trim().toLowerCase();
  return POS_LABEL[k] || k;
}

/** `计` → `计算机`（不认得就原样回显）。 */
export function domainLabel(tag) {
  const k = String(tag || "").trim();
  return DOMAIN_LABEL[k] || k;
}

/** 一行里最多展开几条义项 —— 再多用户也不会逐条看，反而把弹窗撑成一面墙。 */
const MAX_SENSES_PER_LINE = 8;

/**
 * 把词典条目的释义字段 `t` 拆成「一个词性一行、行内若干条义项」。
 *
 * ECDICT 的 t 是整条词条堆在一起的多行文本，例如 pattern：
 *   n. 模范, 典型, 式样, 样品, 图案, 格调, 模式
 *   vt. 模仿, 仿造, 以图案装饰
 *   vi. 形成图案
 * 整条直接存进单词本，复习时七个义项对不上原句；拆出来才能让用户点定「这句里是哪个意思」，
 * 也才能在复习卡背面按词性列出来。
 *
 * 每组返回：
 *   pos        原样前缀（`n. vt.`、`[计]`）—— 存量卡的 def 就是 `${pos} ${sense}` 拼出来的，
 *              义项选中态靠它比字符串，所以这个字段的值不能动
 *   posTags    ['n.', 'vt.']       posLabels  ['名词', '及物动词']
 *   domains    ['计']              domainLabels ['计算机']
 *   senses     ['模范', '典型', …]
 */
export function parseSenses(t) {
  const text = typeof t === "string" ? t : "";
  if (!text.trim()) return [];
  const out = [];
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
    const posTags = [];
    const domains = [];
    for (const tok of pos.match(PREFIX_TOKEN) || []) {
      if (tok[0] === "[") domains.push(tok.slice(1, -1));
      else posTags.push(tok);
    }
    out.push({
      pos,
      posTags,
      posLabels: posTags.map(posLabel),
      domains,
      domainLabels: domains.map(domainLabel),
      senses: senses.slice(0, MAX_SENSES_PER_LINE),
    });
  }
  return out;
}

/**
 * 划词弹窗的可点义项 chips 用的分组：整条总共只有 ≤ 1 个义项时返回 []。
 * 那种词根本没有「选哪个义项」这回事，调用方据此退回纯文本展示。
 */
export function splitSenses(t) {
  const groups = parseSenses(t);
  const total = groups.reduce((n, g) => n + g.senses.length, 0);
  // 单义项的词不值得渲染成一颗可点的 chip：点不点结果一样。
  return total <= 1 ? [] : groups;
}

/**
 * 把整条释义压成给列表用的一行人话：
 *   `vt. 改变, 使多样化`  →  `及物动词 改变、使多样化`
 *   `[计] 改变`           →  `〔计算机〕改变`
 * 拆不出结构（用户自己敲的、词典没收录）就原样回显。
 */
export function humanizeDef(t) {
  const groups = parseSenses(t);
  if (groups.length === 0) return String(t || "").trim();
  return groups
    .map((g) => {
      const head = g.posLabels.join("·");
      const dom = g.domainLabels.length ? `〔${g.domainLabels.join("·")}〕` : "";
      return `${head ? `${head} ` : ""}${dom}${g.senses.join("、")}`;
    })
    .join(" / ");
}

/**
 * 「薄条目」：没音标，而且所有义项都挂着领域标（`varying → [计] 改变`）。
 *
 * ECDICT 给几百个屈折形单独收了这种条目，于是查 varying 直接命中它、再也回落不到
 * 原形 vary（`vt. 改变, 使多样化 / vi. 变化, 有不同, 违反`，还带音标和 TOEFL 标签）。
 * 学生看到的就只剩一句没头没尾的「[计] 改变」—— 既看不懂那个「计」，也拿不到词性。
 */
export function isThinEntry(entry) {
  if (!entry) return true;
  if (entry.p) return false;
  const groups = parseSenses(entry.t);
  if (groups.length === 0) return true;
  return groups.every((g) => g.domains.length > 0 && g.posTags.length === 0);
}

/**
 * 薄条目的救援：在同一片里找这个词真正的原形。
 *
 * 取「能查到、且自己不薄」的候选里词干最长的那个 —— naiveStems 对 using 会同时给出
 * us 和 use，按顺序取第一个会落到代词 us 上；长的那个才是真原形。
 * 两字母词干一概不认（abs → ab、mer → me 这类纯属巧合）。
 */
export function pickLemma(shard, word) {
  let best = null;
  for (const stem of naiveStems(word)) {
    if (stem.length < 3) continue;
    const hit = resolveFromShard(shard, stem);
    if (!hit || isThinEntry(hit)) continue;
    if (!best || hit.word.length > best.word.length) best = hit;
  }
  return best;
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
