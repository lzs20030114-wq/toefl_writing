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

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const BANK_DIR = path.join(process.cwd(), "data", "realBank", "reading");
const LETTERS = "ABCDEFGH";
const TIER = "recalled";

/** 卷名 → 日期。文件夹名形如 "3.10新托福真题A卷"。 */
function setDate(setname) {
  const m = String(setname).match(/^(\d{1,2})[.．](\d{1,2})/);
  return m ? `2026-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}` : "2026";
}
function setSlug(setname) {
  const m = String(setname).match(/^(\d{1,2})[.．](\d{1,2})/);
  const base = m ? `${m[1]}${m[2]}` : "x";
  const variant = String(setname).match(/([ABC])卷/);
  return base + (variant ? variant[1].toLowerCase() : "");
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
  return /insert|slot\s*\d|■/i.test(probe);
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
    if (looksLikeInsertQuestion(it) && !/■/.test(String(it.material || material))) {
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

/* ── 主流程 ─────────────────────────────────────────────────────────────── */
function main() {
  const dry = process.argv.includes("--dry");
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json"));
  const out = { ap: [], rdl: [], ctw: [] };
  const stats = {
    sets: 0, itemsSeen: 0, keptByAudit: 0, droppedNoAudit: 0, droppedDisagree: 0,
    built: 0, buildFailed: 0, droppedDupSet: 0, droppedBadOptions: 0, droppedInsert: 0,
    mergedGroups: 0, droppedDupStem: 0,
  };
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
  console.log(`  跨卷重复跳过 ${stats.droppedDupSet} 套`);
  console.log(`  选项残缺丢弃 ${stats.droppedBadOptions} 题（OCR 串栏，非 A-D 四选项 / answer_index 越界）；无 ■ 标记的插入题丢弃 ${stats.droppedInsert} 题`);
  console.log(`  材料模糊归并：并掉 ${stats.mergedGroups} 组（同一篇的 OCR 变体，Jaccard≥${MATERIAL_JACCARD_MIN} 或前 ${MATERIAL_PREFIX_CHARS} 字相同）；组内重复题干丢弃 ${stats.droppedDupStem} 题`);
  console.log(`  成品：AP ${out.ap.length} 组 / RDL ${out.rdl.length} 组 / CTW ${out.ctw.length} 段`);
  const qcount = [...out.ap, ...out.rdl].reduce((n, x) => n + x.questions.length, 0);
  console.log(`  选择题合计 ${qcount} 道；CTW 空位合计 ${out.ctw.reduce((n, x) => n + x.blank_count, 0)} 个`);
  console.log(`  构建失败 ${stats.buildFailed}`);

  if (dry) { console.log("\n（--dry，未写文件）"); return; }
  fs.mkdirSync(BANK_DIR, { recursive: true });
  for (const [k, v] of Object.entries(out)) {
    const p = path.join(BANK_DIR, `${k}.json`);
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
}

main();
