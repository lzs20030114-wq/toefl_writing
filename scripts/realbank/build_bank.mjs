#!/usr/bin/env node
/**
 * 真题录入 —— 落库（一期：阅读）。
 *
 * 把 `<卷>.structured.json` + `<卷>.audit.json` 汇成 App 能直接消费的题库文件：
 *   data/realBank/reading/{ap,rdl,ctw}.json
 *   data/realBank/reading/counts.json   ← 只有 {ctw,rdl,ap} 三个数字，给首页卡片显示题量用
 *
 * 三条硬规矩：
 *
 * 1. **只收盲审一致的题。** 盲审不一致 = 独立模型不看答案自己做，做出来和答案页不符。
 *    那可能是模型错，也可能是我们错——分不清就不上线。宁可少题，不许上错题。
 *    没被盲审覆盖到的题同样不收（不是"默认通过"）。
 *
 * 2. **一材多题要合回去。** 真题是一屏一题，但 AP/RDL 的库结构是一段材料带多道题
 *    （实测 3.10 的 Q23/Q24 共用同一张海报）。按材料归并，否则同一张海报会被
 *    拆成四条互相重复的题目。
 *
 * 3. **同一份文件只许收一次。** ingest_set.py 只查卷内重复；实测另有 5 组不同日期的卷
 *    共用同一份文件（3.11 阅读 == 3.21 阅读 等）。铺 54 套时同一套题会被收两遍——
 *    用户在真题专区连抽到两份一模一样的卷，比少一套更伤信任。按内容哈希跨卷去重，
 *    判据是 ingest 阶段就算好的 <卷>.json files[].hash，不是卷名/日期。
 *
 * 4. **来源分档只能标 recalled。** 这批是闲鱼来源的 2026 机经回忆版，不是 ETS 官方 PDF。
 *    data/REFERENCE_BANKS.md 的口径：没核验过的一律不许标 official。
 *
 * 用法:
 *   node scripts/realbank/build_bank.mjs            # 汇总所有已跑过的卷
 *   node scripts/realbank/build_bank.mjs --dry      # 只看统计，不写文件
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const BANK_DIR = path.join(process.cwd(), "data", "realBank", "reading");
const LETTERS = "ABCDEFGH";
const TIER = "recalled";
const FLAGS_FILE = path.join(process.cwd(), "data", "realBank", "source-flags.json");

/**
 * 逐套的已知源料缺陷（data/realBank/source-flags.json，由体检的 _source_audit.json 复算）。
 * 入库时按科目过滤后写进每道题的 source_flags —— 铺量时不必回头翻体检报告，
 * 前端/去重/人工复核都能直接看题上带的标记判断这题能不能信。
 */
const SOURCE_FLAGS = (() => {
  try {
    return JSON.parse(fs.readFileSync(FLAGS_FILE, "utf8")).sets || {};
  } catch {
    // 清单缺失不该拦住入库：退化成「不打标」，但要让跑的人看见。
    console.warn(`[build_bank] 读不到 ${FLAGS_FILE}，本次入库的题不带 source_flags`);
    return {};
  }
})();

/** 取某套在某科目下生效的 flag（sections 含 "*" 的是全科通用）。 */
function flagsFor(setName, section) {
  const all = SOURCE_FLAGS[setName] || [];
  return all
    .filter((f) => (f.sections || []).some((x) => x === "*" || x === section))
    .map((f) => ({ code: f.code, severity: f.severity, detail: f.detail }));
}

/**
 * 这一套的这一科是不是被源料体检**扣下**了。
 *
 * source-flags.json 里 severity=blocking 的含义就是「这一科别入库」（清单里还带
 * action: "hold_reading" 这类字段说明扣哪一科）。以前 build_bank 只把 flag 抄到题上、
 * 不据此拦人 —— 于是 5.20（阅读盲审 7/13=54%、疑似答案键整段错位）照样落了库，
 * 只有 __tests__/real-bank-reading-data.test.js 的「已入库的题不带 blocking 级缺陷」
 * 在事后发现。闸门补在这里：标了 blocking 就整科不收。
 */
function isHeld(setName, section) {
  return (SOURCE_FLAGS[setName] || []).some(
    (f) => f.severity === "blocking" && (f.sections || []).some((x) => x === "*" || x === section));
}

/**
 * 卷名 → 日期。两套来源两种卷名：
 *   旧源（截图 PDF）  "3.10新托福真题A卷"  → 2026-03-10
 *   重排版源（文字 docx）"rf0610"          → 2026-06-10
 * 认不出就退回 "2026"（只影响展示，不影响能不能落库）。
 */
function setDate(setname) {
  const rf = String(setname).match(/^rf(\d{2})(\d{2})$/);
  if (rf) return `2026-${rf[1]}-${rf[2]}`;
  const m = String(setname).match(/^(\d{1,2})[.．](\d{1,2})/);
  return m ? `2026-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}` : "2026";
}
/**
 * 卷名 → id 里的短标识。**必须跨来源唯一**：重排版源直接用 setkey（rf0610），
 * 与旧源的 "310" / "121a" 天然不撞；认不出的退回 "x" 会让多卷共用同一个 id 前缀，
 * 所以新来源接进来时一定要在这里给出确定的规则，不能靠兜底。
 */
function setSlug(setname) {
  if (/^rf\d{4}$/.test(String(setname))) return String(setname);
  const m = String(setname).match(/^(\d{1,2})[.．](\d{1,2})/);
  const base = m ? `${m[1]}${m[2]}` : "x";
  const variant = String(setname).match(/([ABC])卷/);
  // 同一天的重跑产物（"5.10新托福真题_v2"）必须带上后缀：不带的话它和 "5.10新托福真题"
  // 共用 slug 510，两套里同题号的题会得到同一个 id（实测撞了 real_ap_510_1_31 / _2_11），
  // 前端的 done-key / 历史记录会把两道不同的题当成同一道。
  const rev = String(setname).match(/_v(\d+)$/);
  return base + (variant ? variant[1].toLowerCase() : "") + (rev ? `v${rev[1]}` : "");
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ── 材料模糊归并的两个常量 ─────────────────────────────────────────────────
 * 真题是逐屏 OCR：同一篇学术短文在不同屏上抽出来的文本有细微差异（漏字、标点、换行），
 * 按文本精确相等归并会把同一篇拆成两三组 —— 用户在真题专区看到同一篇文章出现两三次、
 * 每次只带 1 道题，done-key 还各记各的。所以改成模糊归并。
 *
 * 阈值 0.8 的实测依据（2026-09-05，data/realBank/reading/ap.json 17 组、同卷两两 39 对）：
 *   · 同一篇的 OCR 变体 9 对，Jaccard 全部落在 0.896 ~ 1.000
 *     （3.10「Floating Wind Turbines」25~27=0.962、31/32/34 三连 0.899~0.930；
 *      5.10「Value Theory」11/12/15 = 0.896~1.000；5.10 31~33=0.984；4.15 11~13=0.985）
 *   · 同卷两篇**不同**学术短文 30 对，Jaccard 全部 ≤ 0.060
 *   0.060 与 0.896 之间是一整段空档，0.8 落在空档里，两侧各留 >0.74 / >0.09 的余量。
 *   **不许往下放宽**：越过 0.06 就会把两篇不同的文章合成一篇，比拆散更糟。
 * PREFIX_CHARS=60 是 Jaccard 的兜底：3.10「Floating Wind Turbines」、5.10「Value Theory」、
 *   5.10「The Shifting Art of Playwriting」这三簇实测靠归一化前 60 字就能认出同篇，
 *   用来接住「后半截被 OCR 截断、token 交集不够」的情况。
 */
const MATERIAL_JACCARD_MIN = 0.8;
const MATERIAL_PREFIX_CHARS = 60;
// 归一化材料短于这个长度 = 压根没抽干净，不参与归并（沿用旧实现 key.length > 30 的口径）。
// 少了这道闸，两份空材料的「前 60 字」都是空串，会被判成同一篇糊在一起。
const MATERIAL_MIN_KEY_CHARS = 30;

// 归并专用归一化：只留字母（数字/标点在 OCR 里最不稳），压空白。
const matNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
// 只取长度 > 3 的词：the/of/and 这类虚词在任意两篇英文里都撞，会把不同文章的 Jaccard 抬起来。
const matTokens = (s) => new Set(matNorm(s).split(" ").filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
// 与 CTWTask.renderPassage 的 `item.passage.split(/\s+/)` 同一套分词：passage 落库前已 trim，
// 所以 trim+split+filter 与裸 split 产出的数组逐位相同 —— blanks[].position 才能对上屏幕上的词。
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

// 尾标点剥离口径与 lib/readingGen/cTestBlanker.js:122 一致（那边是 live 库的生成器）。
// 必须剥：CTWTask 用 `original_word.length - displayed_fragment.length` 算输入框宽度 / maxLength，
// 带着句号就会多算一位 —— 屏幕上多出一条下划线，用户填满了也对不上。
const stripTrailingPunct = (w) => String(w || "").replace(/[.,;:!?]+$/, "");

/* ── CTW：把 {passage, blanks:[{word,given}]} 展成库里的挖空结构 ───────────── */
//
// 库里每个 blank 要 position（词下标）、original_word、displayed_fragment（屏幕上保留的前缀）、
// 以及整篇的 blanked_text。这些全都能从 passage + blanks 确定性推出来 —— 唯一要小心的是
// 同一个词在文中多次出现，所以定位游标只许前进，不许回头。
function buildCtw(item, meta) {
  const passage = String(item.passage || "").trim();
  const toks = words(passage);
  const lower = toks.map((t) => t.toLowerCase().replace(/[^a-z0-9']/g, ""));
  const blanks = [];
  let cursor = 0;
  for (const b of item.blanks || []) {
    const want = String(b.word || "").toLowerCase().replace(/[^a-z0-9']/g, "");
    const given = String(b.given || "");
    let at = -1;
    for (let i = cursor; i < lower.length; i += 1) {
      if (lower[i] === want) { at = i; break; }
    }
    if (at < 0) return null;                 // 定位不到就整题作废，不猜
    const originalWord = stripTrailingPunct(toks[at]);
    // CTWTask 的硬契约：屏幕上先印 displayed_fragment，再开 (original_word.length - fragment.length)
    // 个字母的输入框。前缀对不上 = 宽度算错 = 这个空永远填不对，所以整题作废（宁可少题不许出死题）。
    if (!originalWord.toLowerCase().startsWith(given.toLowerCase())) return null;
    const hidden = originalWord.length - given.length;
    if (hidden < 1) return null;             // 给定前缀吃光整词，没有空可填
    blanks.push({
      position: at,
      original_word: originalWord,
      displayed_fragment: given,
      hidden_length: hidden,
    });
    cursor = at + 1;
  }
  if (!blanks.length) return null;
  const blankedTokens = toks.slice();
  for (const b of blanks) {
    blankedTokens[b.position] = `${b.displayed_fragment}${"_".repeat(Math.max(1, b.hidden_length))}`;
  }
  return {
    id: `real_ctw_${meta.slug}_${meta.module}_${meta.qStart}`,
    passage,
    word_count: toks.length,
    topic: String(item.topic || "other"),
    // CTWTask:218 的徽章是 `{topic} / {subtopic}`。真题没有二级学科标签，给空串而不是 undefined，
    // 免得渲染成 "history / undefined"。
    subtopic: "",
    blanks,
    blank_count: blanks.length,
    first_sentence: (passage.match(/^[^.!?]+[.!?]/) || [passage])[0].trim(),
    blanked_text: blankedTokens.join(" "),
    difficulty: "medium",  // 真题不自带难度标签，统一 medium，不编造分档
    real: true, tier: TIER, source: meta.set, date: meta.date,
    source_hash: meta.hash || null,
    source_flags: flagsFor(meta.set, "reading"),
  };
}

/* ── 选择题：按材料把一屏一题合回「一材多题」 ───────────────────────────── */
/**
 * 两段材料是不是同一篇。同卷同 module 内才问这个问题 —— 跨卷的重复由内容哈希去重管，
 * 跨 module 的两篇本来就是不同文章。
 */
function isSameMaterial(a, b) {
  if (a.key.length < MATERIAL_MIN_KEY_CHARS || b.key.length < MATERIAL_MIN_KEY_CHARS) return false;
  if (a.key.slice(0, MATERIAL_PREFIX_CHARS) === b.key.slice(0, MATERIAL_PREFIX_CHARS)) return true;
  return jaccard(a.tokens, b.tokens) >= MATERIAL_JACCARD_MIN;
}

/**
 * 把一卷里的选择题按材料归并成「一材多题」。
 *
 * 两步：
 *  1. 先按 (module, 归一化材料) 收成「同屏簇」—— 文本逐字相同的必然是同一材料。
 *  2. 再把 OCR 变体并进来：同卷同 module、Jaccard ≥ 0.8 或归一化前 60 字相同 = 同一篇。
 *     用并查集而不是贪心，保证**传递性**：3.10 的 31~32=0.899、31~34=0.917、32~34=0.930
 *     这种三连必须落到同一簇，贪心遇到「A 不像 B 但都像 C」就会漏。
 *
 * 簇的代表材料取最长的那份文本（OCR 漏字只会变短），成品的 passage/text 用它。
 * stats.mergedGroups 记「被并掉了几个同屏簇」= 第 1 步簇数 − 第 2 步簇数。
 */
function groupByMaterial(records, stats) {
  // 第 1 步：同屏簇
  const seeds = [];
  const byKey = new Map();
  for (const r of records) {
    const key = matNorm(r.item.material);
    const mapKey = `${r.module} ${key}`;
    let seed = byKey.get(mapKey);
    if (!seed) {
      seed = { module: r.module, key, tokens: matTokens(r.item.material), records: [] };
      byKey.set(mapKey, seed);
      seeds.push(seed);
    }
    seed.records.push(r);
  }

  // 第 2 步：并查集把 OCR 变体并进同一簇。根取下标最小的种子，簇序因此稳定（跟着题号走）。
  const parent = seeds.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      if (seeds[i].module !== seeds[j].module) continue;
      if (!isSameMaterial(seeds[i], seeds[j])) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < seeds.length; i += 1) {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, { module: seeds[i].module, records: [] });
    byRoot.get(root).records.push(...seeds[i].records);
  }

  const groups = [];
  const matLen = (r) => String(r.item.material || "").trim().length;
  for (const c of byRoot.values()) {
    let rep = c.records[0];
    for (const r of c.records) if (matLen(r) > matLen(rep)) rep = r;
    groups.push({ module: c.module, rep, records: c.records });
  }
  if (stats) stats.mergedGroups += seeds.length - groups.length;
  return groups;
}

/**
 * 插入句题（"Insert the sentence into slot 1/2/3"）在真题里靠材料中的 ■ 标记定位插入点。
 * OCR 抽出来的材料十有八九丢了 ■ —— 没有标记的插入题在 App 里就是一道**无法作答**的死题
 * （RDLTask 只渲染四个选项，用户看不到插入位）。当前四套试点没有插入题，这是守门用的。
 */
function looksLikeInsertQuestion(it) {
  const probe = [String(it.stem || ""), ...(Array.isArray(it.options) ? it.options : []).map(String)].join(" ");
  return /insert|slot\s*\d|■|four locations|where would the following sentence/i.test(probe);
}

/**
 * 材料里有没有能看见的插入位标记。
 * 旧源（ETS 截图）用 ■；重排版源用 [A]-[D] 字母方括号，选项也直接写 "A. [A]" —— 两种都是
 * 屏幕上真实可见的定位符，用户看得见就答得了。四个字母缺一个就不算（那是 OCR 掉了标记）。
 */
function hasInsertMarkers(material) {
  const s = String(material || "");
  if (/■/.test(s)) return true;
  return ["[A]", "[B]", "[C]", "[D]"].every((x) => s.includes(x));
}

function buildMcqGroup(group, meta, stats) {
  // 代表材料取簇里最长的那份（OCR 漏字只会变短），material_kind 也跟着它走。
  const first = (group.rep || group.records[0]).item;
  const material = String(first.material || "").trim();
  if (words(material).length < 12) return null;      // 材料太短，多半没抽干净
  const collected = [];
  for (const r of group.records) {
    const it = r.item;
    // RDLTask:262 硬编码渲染 A/B/C/D 四个键 —— 少一个选项，正确答案就可能压根渲染不出来，
    // 用户怎么点都错。实测 4.15 有 1 题、1.21A 有 2 题被 OCR 串栏吃掉了一个选项。
    const rawOpts = Array.isArray(it.options) ? it.options : [];
    const opts = rawOpts.map((o) => String(o ?? "").trim());
    const ai = it.answer_index;
    if (opts.length !== 4 || opts.some((o) => !o) || !Number.isInteger(ai) || ai < 0 || ai > 3) {
      stats.droppedBadOptions += 1;
      continue;
    }
    if (looksLikeInsertQuestion(it) && !hasInsertMarkers(it.material || material)) {
      stats.droppedInsert += 1;
      continue;
    }
    const optMap = {};
    opts.forEach((o, i) => { optMap[LETTERS[i]] = o; });
    collected.push({
      question_type: it.question_type || "detail",
      stem: String(it.stem).trim(),
      options: optMap,
      correct_answer: LETTERS[ai],
      q_number: it.q_number,
    });
  }
  // 归并把好几屏的题混到一起了，顺序要重排回真题屏序（题号升序，缺题号的垫到最后）。
  collected.sort((a, b) => (a.q_number ?? Infinity) - (b.q_number ?? Infinity));
  // 同一道题在相邻两屏各被抽了一次（材料是 OCR 变体、题干却一模一样）→ 只留题号小的那道。
  const seenStem = new Set();
  const questions = [];
  for (const q of collected) {
    const k = norm(q.stem);
    if (k && seenStem.has(k)) { stats.droppedDupStem += 1; continue; }
    if (k) seenStem.add(k);
    questions.push(q);
  }
  if (!questions.length) return null;                // 一组全丢 → 不出组（材料没有题就没有练习价值）
  const isAp = group.records.some((r) => r.type === "ap") || words(material).length >= 160;
  const qs = questions.map((q) => q.q_number).filter((n) => n != null);
  const base = {
    id: `real_${isAp ? "ap" : "rdl"}_${meta.slug}_${meta.module}_${qs[0] ?? "x"}`,
    questions,
    difficulty: "medium",
    real: true, tier: TIER, source: meta.set, date: meta.date,
    source_hash: meta.hash || null,
    source_flags: flagsFor(meta.set, "reading"),
  };
  if (isAp) {
    return {
      ...base,
      topic: String(first.material_kind || "other"),
      subtopic: null,
      passage: material,
      paragraphs: material.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
    };
  }
  // 刻意**不写** variant：live 的 rdl-short / rdl-long 双池是按「每题几道小题」分的
  // （short=2 题 / long=3 题），而这里能拿到的只有材料词数 —— 两套口径对不上，写了只会被误用。
  // 真题 RDL 在 App 里合成一个列表（见 lib/realBank.getRealRDLItems）。
  return {
    ...base,
    genre: String(first.material_kind || "other"),
    text: material,
    format_metadata: {},
  };
}

/* ── 跨卷去重：阅读题目文件的内容哈希 ───────────────────────────────────── */
/**
 * 返回该卷「装了阅读题的题目文件」的内容哈希（来自 ingest_set.py 的 <卷>.json）。
 *
 * 判据用 anchors.reading > 0 而不是 section === "reading"：合集卷（实测 1.21A 的
 * 新托福真题01.pdf）一份 PDF 装四科，section 只会标成锚点最多的听力，按 section
 * 筛会把这类卷整个漏出去重之外。
 * 拿不到对齐产物 / 找不到阅读文件时返回 null = 无从判重，放行——宁可重复也不静默丢卷。
 */
function readingSourceHashes(setname) {
  const f = path.join(OUT_DIR, `${setname}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const hs = (j.files || [])
      .filter((x) => x.role === "questions" && x.hash
        && (x.anchors ? x.anchors.reading > 0 : x.section === "reading"))
      .map((x) => x.hash);
    return hs.length ? hs : null;
  } catch {
    return null;
  }
}

/* ── 写作（造句 / 邮件 / 学术讨论）─────────────────────────────────────────
 *
 * 写作真题不走盲审：三种题型都没有选项，"另一个模型不看答案做一遍"这套办法用不上
 * （造句的答案就是答案页给的整句，邮件/讨论压根没有唯一答案）。所以这里的闸门是
 * **结构闸**：解析器已经把「模板固定词能否对齐答案」「要求是不是 3 条」「学生贴是不是 2 条」
 * 这些硬契约校验过并写进 status，落库只收 status=ok 的 result，缺字段的整条丢。
 *
 * 产物 data/realBank/writing/{bs,email,discussion}.json 的 item 形状对齐
 * lib/realBank.js 的 mapBuildSentence / mapEmail / mapDiscussion 输入 —— 但**本期不接前端**，
 * 只是把料备好。id 刻意不带 `real_` 前缀：realBank 的 realId() 会自己加，带了会变成 real_real_。
 */
const WRITING_DIR = path.join(process.cwd(), "data", "realBank", "writing");

function writingSourceHashes(setname) {
  const f = path.join(OUT_DIR, `${setname}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const hs = (j.files || [])
      .filter((x) => x.role === "questions" && x.hash
        && (x.anchors ? x.anchors.writing > 0 : x.section === "writing"))
      .map((x) => x.hash);
    return hs.length ? hs : null;
  } catch {
    return null;
  }
}

function buildWriting(files, stats) {
  const out = { bs: [], email: [], discussion: [] };
  const seenHash = new Map();
  for (const f of files.sort()) {
    const setname = f.replace(/\.structured\.json$/, "");
    const st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    const hashes = writingSourceHashes(setname);
    const dup = (hashes || []).find((h) => seenHash.has(h));
    if (dup) {
      console.warn(`跳过 ${setname} 写作：与 ${seenHash.get(dup)} 内容相同(hash ${dup})`);
      stats.wDroppedDupSet += 1;
      continue;
    }
    for (const h of hashes || []) seenHash.set(h, setname);
    if (isHeld(setname, "writing")) {
      console.warn(`跳过 ${setname} 写作：源料体检标了 blocking（整科扣下待人工核对）`);
      stats.wDroppedHeld += 1;
      continue;
    }
    const meta = {
      real: true, tier: TIER, source: setname, date: setDate(setname),
      source_hash: (hashes && hashes[0]) || null,
      source_flags: flagsFor(setname, "writing"),
    };
    for (const r of st.results || []) {
      if (r.section !== "writing" || r.status !== "ok") continue;
      for (const it of r.items || []) {
        if (!it || typeof it !== "object") continue;
        if (r.type === "build") {
          // 旧源的 build result 只有 {n, sentence}（答案句，没有模板/词库）—— 拼不出可练的题，跳过。
          if (!it.blanks || !Array.isArray(it.chunks) || !it.chunks.length || !it.answer || !it.prompt) {
            stats.wSkippedThin += 1;
            continue;
          }
          out.bs.push({
            id: it.id, prompt: it.prompt, blanks: it.blanks, chunks: it.chunks,
            answer: it.answer, distractors: Array.isArray(it.distractors) ? it.distractors : [],
            source_label: `${setDate(setname)} 真题造句`, ...meta,
          });
        } else if (r.type === "email") {
          if (!it.scenario || !Array.isArray(it.goals) || it.goals.length < 3) { stats.wSkippedThin += 1; continue; }
          out.email.push({
            id: it.id, to: it.to || "Professor", subject: it.subject || "",
            scenario: it.scenario, direction: it.direction || "", goals: it.goals.slice(0, 3), ...meta,
          });
        } else if (r.type === "discussion") {
          const students = Array.isArray(it.students) ? it.students.filter((s) => s && s.name && s.text) : [];
          if (!it.professor?.text || students.length < 2) { stats.wSkippedThin += 1; continue; }
          out.discussion.push({
            id: it.id, course: it.course || "", professor: it.professor,
            students: students.slice(0, 2), ...meta,
          });
        }
      }
    }
  }
  return out;
}

/* ── 听力 / 口语 ────────────────────────────────────────────────────────────
 *
 * 料从哪来：`merge_vendor_asr.py` 把商家音频的 Whisper 逐字稿与文档转写合流后，
 * 把 listening/speaking 的 result 从 deferred 推到 ok，并在每条上写了
 * `transcript_final` / `turns` / `speakers` / `asr_similarity`。这里只做三件事：
 *
 *  1. **过闸**：听力客观题走与阅读同一套盲审闸（agree===true 才收，没审过不收）；
 *     口语没有唯一答案，闸门是合流阶段的结构校验（status=ok）。
 *  2. **对齐 App schema**：产物要能被 lib/listeningGen/*Validator.js 与
 *     lib/speakingGen/speakingValidator.js 原样收下 —— 所以落库前**用真的 validator
 *     跑一遍**，schema 报错的整条丢掉并记原因。库里不许躺着 App 渲染不了的题。
 *  3. **音频留空**：`audio_url: null` + `audio_pending: true`。真音频由
 *     scripts/realbank/render_real_audio.mjs 用自家 TTS 配好后回写 —— 商家的 mp3
 *     内嵌作答静音、且不是我们能分发的素材，一律不直接用。
 *
 * 跨卷去重：听力/口语没有「题目文件哈希」可用（音频不是 ingest 的产物），
 * 改用**内容哈希**：全卷 transcript_final 归一化后排序拼接取 sha1。
 * 实测 6.22 与 6.29 两套的音频文件名与内容逐条相同，不去重会在真题专区连出两份。
 */
const LISTENING_DIR = path.join(process.cwd(), "data", "realBank", "listening");
const SPEAKING_DIR = path.join(process.cwd(), "data", "realBank", "speaking");

const V = {
  lcr: require("../../lib/listeningGen/lcrValidator.js").validateLCR,
  lc: require("../../lib/listeningGen/lcValidator.js").validateLC,
  la: require("../../lib/listeningGen/laValidator.js").validateLA,
  lat: require("../../lib/listeningGen/latValidator.js").validateLAT,
};
const SPV = require("../../lib/speakingGen/speakingValidator.js");

const pad2 = (n) => String(n).padStart(2, "0");
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** 题干 → 题型标签（validator 的 VALID_Q_TYPES）。真题不自带标签，从题干推。 */
function questionType(stem) {
  const s = String(stem || "").toLowerCase();
  if (/(mainly about|main topic|main purpose|main idea|why does the (speaker|professor|man|woman) (give|discuss))/.test(s)) return "main_idea";
  if (/(imply|infer|suggest|probably|most likely|what can be concluded)/.test(s)) return "inference";
  return "detail";
}

/** 选项数组 → {A,B,C,D}；不是 4 个就返回 null（整题作废）。 */
function optionsMap(arr) {
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  const o = {};
  arr.forEach((t, i) => { o[LETTERS[i]] = String(t || "").trim(); });
  if (Object.values(o).some((x) => !x)) return null;
  return o;
}

function buildQuestions(items, meta, stats) {
  const qs = [];
  for (const it of items) {
    const opts = optionsMap(it.options);
    if (!opts || it.answer_index == null || it.answer_index > 3) { stats.lDroppedBadOptions += 1; continue; }
    qs.push({
      type: questionType(it.stem),
      stem: String(it.stem || "").trim(),
      options: opts,
      answer: LETTERS[it.answer_index],
      explanation: "",
      source_q: it.q_number,
    });
  }
  return qs;
}

/**
 * 口播内容的去重键。**逐条**去重而不是整卷去重：实测 6.22 与 6.29 是同一套料的两次
 * 投放（音频文件名逐条相同、题目逐条相同），但两卷的 slug、个别文件名和校对后的
 * 个别用词有差异，整卷哈希对不上。用户在真题专区连抽到两份一模一样的听力，
 * 比少一套更伤信任，所以判据只能落在**内容**上。
 */
function spokenKey(item) {
  const t = item.conversation
    ? item.conversation.map((x) => x.text).join(" ")
    : (item.announcement || item.transcript || item.speaker || "");
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function speakingSetKey(set) {
  const list = (set.sentences || []).map((s) => s.sentence)
    .concat((set.questions || []).map((q) => q.question));
  return sha1(list.join("|").toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim());
}

const REPEAT_DIFF = (n) => (n <= 7 ? "easy" : n <= 12 ? "medium" : "hard");
const IV_DIFF = ["personal", "descriptive", "analytical", "evaluative"];

function buildListeningSpeaking(files, stats) {
  const out = { lcr: [], lc: [], la: [], lat: [] };
  const spk = { repeat: [], interview: [] };
  const seenL = new Map();
  const seenS = new Map();

  for (const f of files.sort()) {
    const setname = f.replace(/\.structured\.json$/, "");
    const st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    if (!st.merged_asr) continue;                    // 没跑过合流的卷这期不收
    if (isHeld(setname, "listening") && isHeld(setname, "speaking")) {
      console.warn(`跳过 ${setname} 听力/口语：源料体检标了 blocking`);
      stats.lDroppedHeld += 1;
      continue;
    }
    const meta = {
      real: true, tier: TIER, source: setname, date: setDate(setname),
      source_flags: flagsFor(setname, "listening"),
    };
    const slug = setSlug(setname);

    // 盲审闸（与阅读同一份 .audit.json）
    const auditPath = path.join(OUT_DIR, `${setname}.audit.json`);
    let passedKeys = null, auditedKeys = null;
    if (fs.existsSync(auditPath)) {
      const au = JSON.parse(fs.readFileSync(auditPath, "utf8"));
      if (Array.isArray(au.audited)) {
        passedKeys = new Set(au.audited.filter((a) => a.agree).map((a) => `${a.section}#${a.q}`));
        auditedKeys = new Set(au.audited.map((a) => `${a.section}#${a.q}`));
      }
    }
    if (!passedKeys) {
      console.warn(`跳过 ${setname} 听力：没有可用的盲审结果`);
      stats.lDroppedNoAudit += 1;
    }

    // ── 听力 ──────────────────────────────────────────────────────────
    if (passedKeys) {
      for (const r of st.results || []) {
        if (r.section !== "listening" || r.status !== "ok") continue;
        if (!out[r.type]) continue;
        const kept = [];
        for (const it of r.items || []) {
          const key = `listening#${it.q_number}`;
          stats.lItemsSeen += 1;
          if (!auditedKeys.has(key)) { stats.lDroppedNoAuditQ += 1; continue; }
          if (!passedKeys.has(key)) { stats.lDroppedDisagree += 1; continue; }
          stats.lKeptByAudit += 1;
          kept.push(it);
        }
        if (!kept.length) continue;
        const id = `real_${r.type}_${slug}_${r.module}_${pad2(r.q_start)}`;
        const questions = buildQuestions(kept, meta, stats);
        if (!questions.length) continue;
        const base = {
          id, difficulty: "medium", audio_url: null, audio_pending: true,
          asr_similarity: r.asr_similarity == null ? null : r.asr_similarity,
          source_notes: (r.problems || []).filter((p) => /^[a-z_]+(:|$)/.test(p)),
          ...meta,
        };
        let item = null;
        if (r.type === "lcr") {
          const q = questions[0];
          item = { ...base, context: "campus_academic", situation: "",
            speaker: String(r.transcript_final || "").trim(),
            options: q.options, answer: q.answer, explanation: "", source_q: q.source_q };
        } else if (r.type === "lc") {
          item = { ...base, context: "campus_daily", situation: "",
            speakers: r.speakers, conversation: r.turns || [], questions };
        } else if (r.type === "la") {
          item = { ...base, context: "announcement", situation: "", speaker_role: "staff",
            announcement: String(r.transcript_final || "").trim(), questions };
        } else if (r.type === "lat") {
          item = { ...base, subject: "general", topic: "", transcript: String(r.transcript_final || "").trim(), questions };
        }
        const dk = `${r.type}#${spokenKey(item)}`;
        if (seenL.has(dk)) {
          console.warn(`跳过 ${setname} ${id}：口播内容与 ${seenL.get(dk)} 逐字相同`);
          stats.lDroppedDupItem += 1;
          continue;
        }
        seenL.set(dk, `${setname}/${id}`);
        const res = V[r.type](item);
        if (!res.valid) {
          stats.lDroppedInvalid += 1;
          stats.lInvalidReasons[res.errors[0]] = (stats.lInvalidReasons[res.errors[0]] || 0) + 1;
          stats.lInvalidDetail.push({ set: setname, id, type: r.type, errors: res.errors });
          continue;
        }
        out[r.type].push(item);
      }
    }

    // ── 口语 ──────────────────────────────────────────────────────────
    const sMeta = { ...meta, source_flags: flagsFor(setname, "speaking") };
    for (const r of st.results || []) {
      if (r.section !== "speaking" || r.status !== "ok") continue;
      if (r.type === "repeat") {
        const id = `real_repeat_${slug}_1`;
        const sentences = (r.items || [])
          .filter((it) => it.usable !== false && String(it.sentence_final || "").trim())
          .map((it, i) => {
            const text = String(it.sentence_final).trim();
            const n = text.split(/\s+/).filter(Boolean).length;
            return {
              id: `${id}_s${i + 1}`, sentence: text, difficulty: REPEAT_DIFF(n),
              word_count: n, structure: "", phonetic_focus: "",
              timing_seconds: Math.max(8, Math.round(n * 0.9)),
              audio_url: null, audio_pending: true,
              from_asr: (it.problems || []).includes("sentence_from_asr"),
            };
          });
        const set = { id, scenario: String(r.context || "").slice(0, 300) || "You will hear a series of short instructions. Listen carefully and repeat each sentence exactly as you hear it.", speaker_role: "staff", sentences, ...sMeta };
        const sk = `repeat#${speakingSetKey(set)}`;
        if (seenS.has(sk)) {
          console.warn(`跳过 ${setname} ${id}：复述内容与 ${seenS.get(sk)} 逐字相同`);
          stats.sDroppedDupSet += 1;
          continue;
        }
        seenS.set(sk, `${setname}/${id}`);
        const v = SPV.validateRepeatSet(set);
        if (!v.valid) {
          stats.sDroppedInvalid += 1;
          stats.sInvalidDetail.push({ set: setname, id, type: "repeat", errors: v.errors });
          continue;
        }
        spk.repeat.push(set);
      } else if (r.type === "interview") {
        const id = `real_interview_${slug}_1`;
        const questions = (r.items || [])
          .filter((it) => it.usable !== false && String(it.stem_final || "").trim())
          .map((it, i) => {
            const text = String(it.stem_final).trim();
            return {
              id: `${id}_q${i + 1}`, position: `Q${i + 1}`, question: text,
              difficulty: IV_DIFF[i] || "analytical",
              word_count: text.split(/\s+/).filter(Boolean).length,
              expected_response_topics: [],
              reference_answer: String(it.reference_answer || ""),
              audio_url: null, audio_pending: true,
              from_asr: (it.problems || []).includes("stem_from_asr"),
            };
          });
        const set = { id, topic: "", intro: String(r.context || "").slice(0, 300), questions, ...sMeta };
        const sk = `interview#${speakingSetKey(set)}`;
        if (seenS.has(sk)) {
          console.warn(`跳过 ${setname} ${id}：面试内容与 ${seenS.get(sk)} 逐字相同`);
          stats.sDroppedDupSet += 1;
          continue;
        }
        seenS.set(sk, `${setname}/${id}`);
        const v = SPV.validateInterviewSet(set);
        if (!v.valid) {
          stats.sDroppedInvalid += 1;
          stats.sInvalidDetail.push({ set: setname, id, type: "interview", errors: v.errors });
          continue;
        }
        spk.interview.push(set);
      }
    }
  }
  return { listening: out, speaking: spk };
}

/* ── 配音沿用 ───────────────────────────────────────────────────────────────
 * build_bank 每次都是**全量重建**，条目对象是新造的（audio_url: null）。
 * 直接落盘会把已经花过钱配好的 252 条音频全部作废、逼着重配一遍 ——
 * 所以落盘前拿上一版的库比一次：**口播文本逐字没变**就把 audio_url 接过来，
 * 变了的（或新增的）才留 audio_pending 给 render_real_audio.mjs 去配。
 * 判据只看「会被念出来的那段文本」：选项、参考答案、难度标签改了不该重配音。
 */
function spokenText(kind, it) {
  if (kind === "lcr") return String(it.speaker || "");
  if (kind === "la") return String(it.announcement || "");
  if (kind === "lat") return String(it.transcript || "");
  if (kind === "lc") {
    // 音色由 speakers[].gender 决定（toneDirector 锁声），所以性别也算进口播指纹
    const roster = (it.speakers || []).map((s) => `${s.name}/${s.gender}`).join(",");
    const lines = (it.conversation || []).map((t) => `${t.speaker}: ${t.text}`).join(" / ");
    return roster + " || " + lines;
  }
  return "";
}

function carryAudioUrls(dir, bundle) {
  let n = 0;
  for (const [kind, list] of Object.entries(bundle)) {
    const p = path.join(dir, `${kind}.json`);
    if (!fs.existsSync(p)) continue;
    let prev;
    try { prev = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    const old = new Map();
    for (const it of prev.items || []) {
      if (kind === "repeat" || kind === "interview") {
        const units = kind === "repeat" ? (it.sentences || []) : (it.questions || []);
        for (const u of units) {
          const text = kind === "repeat" ? u.sentence : u.question;
          if (u.audio_url) old.set(u.id, { url: u.audio_url, text: String(text || "") });
        }
      } else if (it.audio_url) {
        old.set(it.id, { url: it.audio_url, text: spokenText(kind, it) });
      }
    }
    for (const it of list) {
      if (kind === "repeat" || kind === "interview") {
        const units = kind === "repeat" ? (it.sentences || []) : (it.questions || []);
        for (const u of units) {
          const hit = old.get(u.id);
          const text = String((kind === "repeat" ? u.sentence : u.question) || "");
          if (hit && hit.text === text) { u.audio_url = hit.url; delete u.audio_pending; n += 1; }
        }
      } else {
        const hit = old.get(it.id);
        if (hit && hit.text === spokenText(kind, it)) {
          it.audio_url = hit.url; delete it.audio_pending; n += 1;
        }
      }
    }
  }
  return n;
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */
function main() {
  const dry = process.argv.includes("--dry");
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json"));
  const out = { ap: [], rdl: [], ctw: [] };
  const stats = {
    sets: 0, itemsSeen: 0, keptByAudit: 0, droppedNoAudit: 0, droppedDisagree: 0,
    built: 0, buildFailed: 0, droppedDupSet: 0, droppedBadOptions: 0, droppedInsert: 0,
    mergedGroups: 0, droppedDupStem: 0, wDroppedDupSet: 0, wSkippedThin: 0,
    droppedHeld: 0, wDroppedHeld: 0, lDroppedHeld: 0,
    lItemsSeen: 0, lKeptByAudit: 0, lDroppedNoAudit: 0, lDroppedNoAuditQ: 0,
    lDroppedDisagree: 0, lDroppedDupItem: 0, lDroppedBadOptions: 0, lDroppedInvalid: 0,
    lInvalidReasons: {}, lInvalidDetail: [],
    sDroppedDupSet: 0, sDroppedInvalid: 0, sInvalidDetail: [],
  };
  const writing = buildWriting(files, stats);
  const ls = buildListeningSpeaking(files, stats);
  // 内容哈希 → 最早消费它的卷。files.sort() 保证遍历顺序稳定（按卷名），
  // 所以「谁算早」是确定的，不会因为目录枚举顺序变来变去。
  const seenHash = new Map();

  for (const f of files.sort()) {
    const setname = f.replace(/\.structured\.json$/, "");
    const st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    const auditPath = path.join(OUT_DIR, `${setname}.audit.json`);
    if (!fs.existsSync(auditPath)) { console.warn(`跳过 ${setname}：没有盲审结果`); continue; }
    const au = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    if (!Array.isArray(au.audited)) {
      console.warn(`跳过 ${setname}：盲审结果是旧格式（没有 audited 明细），无法区分「审过且一致」与「压根没审」`);
      continue;
    }
    // 只有 agree===true 的题号才放行。没出现在 audited 里的 = 没审过 = 不收。
    const passedKeys = new Set(au.audited.filter((a) => a.agree).map((a) => `${a.section}#${a.q}`));
    const auditedKeys = new Set(au.audited.map((a) => `${a.section}#${a.q}`));
    // 跨卷去重：这卷的阅读题目文件如果被更早的卷收过了，整科跳过
    const hashes = readingSourceHashes(setname);
    const dupHash = (hashes || []).find((h) => seenHash.has(h));
    if (dupHash) {
      console.warn(`跳过 ${setname} 阅读：与 ${seenHash.get(dupHash)} 内容相同(hash ${dupHash})`);
      stats.droppedDupSet += 1;
      continue;
    }
    for (const h of hashes || []) seenHash.set(h, setname);
    if (isHeld(setname, "reading")) {
      console.warn(`跳过 ${setname} 阅读：源料体检标了 blocking（整科扣下待人工核对）`);
      stats.droppedHeld += 1;
      continue;
    }
    stats.sets += 1;

    const meta0 = {
      set: setname, slug: setSlug(setname), date: setDate(setname),
      hash: (hashes && hashes[0]) || null,
    };
    // 按 module + 题号排序，保证「相邻合并」和真题屏序一致
    const recs = [];
    for (const r of st.results) {
      if (r.section !== "reading" || r.status !== "ok") continue;
      for (const it of r.items || []) {
        if (!it || typeof it !== "object") continue;
        recs.push({ module: r.module, type: r.type, q: it.q_number ?? r.q_start, item: it });
      }
    }
    recs.sort((a, b) => a.module - b.module || a.q - b.q);

    // CTW 单独走（它是一段一题的整块，不参与材料归并）
    for (const r of recs) {
      if (r.type !== "ctw") continue;
      stats.itemsSeen += 1;
      const built = buildCtw(r.item, { ...meta0, module: r.module, qStart: r.q });
      if (built) { out.ctw.push(built); stats.built += 1; } else stats.buildFailed += 1;
    }

    // 选择题：先过盲审闸，再按材料归并
    const mcq = recs.filter((r) => r.type !== "ctw" && Array.isArray(r.item.options) && r.item.answer_index != null);
    const passed = [];
    for (const r of mcq) {
      stats.itemsSeen += 1;
      const key = `reading#${r.item.q_number}`;
      if (!auditedKeys.has(key)) { stats.droppedNoAudit += 1; continue; }
      if (!passedKeys.has(key)) { stats.droppedDisagree += 1; continue; }
      stats.keptByAudit += 1;
      passed.push(r);
    }
    for (const g of groupByMaterial(passed, stats)) {
      const meta = { ...meta0, module: g.module };
      const built = buildMcqGroup(g, meta, stats);
      if (!built) { stats.buildFailed += 1; continue; }
      (built.passage ? out.ap : out.rdl).push(built);
      stats.built += 1;
    }
  }

  console.log("■ 真题阅读落库");
  console.log(`卷 ${stats.sets} 套；结构化产物里的阅读条目 ${stats.itemsSeen}`);
  console.log(`  盲审通过收下 ${stats.keptByAudit}；盲审不一致丢弃 ${stats.droppedDisagree}；没被盲审覆盖丢弃 ${stats.droppedNoAudit}`);
  console.log(`  跨卷重复跳过 ${stats.droppedDupSet} 套；源料体检 blocking 扣下 ${stats.droppedHeld} 套`);
  console.log(`  选项残缺丢弃 ${stats.droppedBadOptions} 题（OCR 串栏，非 A-D 四选项 / answer_index 越界）；无 ■ 标记的插入题丢弃 ${stats.droppedInsert} 题`);
  console.log(`  材料模糊归并：并掉 ${stats.mergedGroups} 组（同一篇的 OCR 变体，Jaccard≥${MATERIAL_JACCARD_MIN} 或前 ${MATERIAL_PREFIX_CHARS} 字相同）；组内重复题干丢弃 ${stats.droppedDupStem} 题`);
  console.log(`  成品：AP ${out.ap.length} 组 / RDL ${out.rdl.length} 组 / CTW ${out.ctw.length} 段`);
  const qcount = [...out.ap, ...out.rdl].reduce((n, x) => n + x.questions.length, 0);
  console.log(`  选择题合计 ${qcount} 道；CTW 空位合计 ${out.ctw.reduce((n, x) => n + x.blank_count, 0)} 个`);
  console.log(`  构建失败 ${stats.buildFailed}`);

  console.log("\n■ 真题写作落库（不走盲审：三种题型都没有唯一选项答案，闸门是解析器的结构校验）");
  console.log(`  造句 ${writing.bs.length} 题 / 邮件 ${writing.email.length} 题 / 学术讨论 ${writing.discussion.length} 题`);
  console.log(`  跨卷重复跳过 ${stats.wDroppedDupSet} 套；源料体检 blocking 扣下 ${stats.wDroppedHeld} 套；字段不全丢弃 ${stats.wSkippedThin} 条`);

  const L = ls.listening, S = ls.speaking;
  console.log("\n■ 真题听力落库（材料 = 商家音频的 Whisper 逐字稿 + 文档转写合流后的 transcript_final）");
  console.log(`  结构化产物里的听力条目 ${stats.lItemsSeen}；盲审通过 ${stats.lKeptByAudit}；`
    + `不一致丢弃 ${stats.lDroppedDisagree}；没被盲审覆盖丢弃 ${stats.lDroppedNoAuditQ}`);
  console.log(`  跨卷逐条内容重复跳过 ${stats.lDroppedDupItem} 组；无盲审结果跳过 ${stats.lDroppedNoAudit} 套；选项残缺丢弃 ${stats.lDroppedBadOptions} 题`);
  console.log(`  validator 不收丢弃 ${stats.lDroppedInvalid} 组：${JSON.stringify(stats.lInvalidReasons)}`);
  console.log(`  成品：LCR ${L.lcr.length} / LC ${L.lc.length} / LA ${L.la.length} / LAT ${L.lat.length}`);

  console.log("\n■ 真题口语落库（无客观答案，不走盲审；闸门是合流阶段的结构校验 + validator）");
  console.log(`  跨卷内容重复跳过 ${stats.sDroppedDupSet} 套；validator 不收丢弃 ${stats.sDroppedInvalid} 组`);
  console.log(`  成品：复述 ${S.repeat.length} 套（${S.repeat.reduce((n, x) => n + x.sentences.length, 0)} 句）`
    + ` / 面试 ${S.interview.length} 套（${S.interview.reduce((n, x) => n + x.questions.length, 0)} 题）`);
  for (const d of [...stats.lInvalidDetail, ...stats.sInvalidDetail]) {
    console.log(`    ✗ ${d.set} ${d.id} (${d.type}): ${d.errors.slice(0, 3).join(" | ")}`);
  }

  if (dry) { console.log("\n（--dry，未写文件）"); return; }
  fs.mkdirSync(BANK_DIR, { recursive: true });
  for (const [k, v] of Object.entries(out)) {
    const p = path.join(BANK_DIR, `${k}.json`);
    fs.writeFileSync(p, JSON.stringify({ tier: TIER, generated_by: "scripts/realbank/build_bank.mjs", count: v.length, items: v }, null, 2), "utf8");
    console.log(`  → ${path.relative(process.cwd(), p)}  ${v.length} 条`);
  }

  fs.mkdirSync(WRITING_DIR, { recursive: true });
  for (const [k, v] of Object.entries(writing)) {
    const p = path.join(WRITING_DIR, `${k}.json`);
    fs.writeFileSync(p, JSON.stringify({ tier: TIER, generated_by: "scripts/realbank/build_bank.mjs", count: v.length, items: v }, null, 2), "utf8");
    console.log(`  → ${path.relative(process.cwd(), p)}  ${v.length} 条`);
  }

  // 首页真题卡要显示这三个数，但首页**不能** import lib/realBank —— 那会把 238 KB 写作真题
  // JSON + 阅读三个题库整个打进 `/` 的 first-load chunk（实测 255 kB → 318 kB）。
  // 所以额外落一份几十字节的计数文件，给 components/home/* 静态 import。
  // 刻意不写时间戳/生成信息：每次落库都产生无意义 diff，会淹掉真正的题量变化。
  const countsPath = path.join(BANK_DIR, "counts.json");
  const counts = { ctw: out.ctw.length, rdl: out.rdl.length, ap: out.ap.length };
  fs.writeFileSync(countsPath, JSON.stringify(counts, null, 2), "utf8");
  console.log(`  → ${path.relative(process.cwd(), countsPath)}  ${JSON.stringify(counts)}`);

  // 听力 / 口语：同一套写法（每个题型一个文件 + 一份计数），音频先留空。
  // 落库前先把**口播文本没变**的条目的 audio_url 从上一版接过来（见 carryAudioUrls）。
  const carried = carryAudioUrls(LISTENING_DIR, L) + carryAudioUrls(SPEAKING_DIR, S);
  console.log(`
■ 已配音沿用：${carried} 条 audio_url 从上一版接过来（口播文本逐字未变）；`
    + `其余 audio_pending 的交给 render_real_audio.mjs`);
  for (const [dir, bundle] of [[LISTENING_DIR, L], [SPEAKING_DIR, S]]) {
    fs.mkdirSync(dir, { recursive: true });
    const c = {};
    for (const [k, v] of Object.entries(bundle)) {
      const p = path.join(dir, `${k}.json`);
      fs.writeFileSync(p, JSON.stringify({ tier: TIER, generated_by: "scripts/realbank/build_bank.mjs", count: v.length, items: v }, null, 2), "utf8");
      console.log(`  → ${path.relative(process.cwd(), p)}  ${v.length} 条`);
      c[k] = v.length;
    }
    const cp = path.join(dir, "counts.json");
    fs.writeFileSync(cp, JSON.stringify(c, null, 2), "utf8");
    console.log(`  → ${path.relative(process.cwd(), cp)}  ${JSON.stringify(c)}`);
  }
}

main();
