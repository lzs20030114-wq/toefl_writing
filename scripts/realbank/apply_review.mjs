#!/usr/bin/env node
/**
 * 真题录入 —— 人工/独立复核结论落地（build_bank 之后的最后一道闸）。
 *
 * 读 data/realBank/review-holds.json，对已落库的 data/realBank/** 做两件事：
 *   1. patches：对个别字段做确定性文本修补（截掉串进来的无关尾巴、补句号、改错字）；
 *   2. holds：把复核判定「不能上线」的条目下架 —— 整条(unit) / 单题(question) /
 *      单句(sentence) / 单个面试问题(iq) 三种粒度。
 * 然后重算 CTW 的派生字段（word_count / blanked_text）和各科 counts.json。
 *
 * 为什么不是改 build_bank 的输入：复核是对**成品**做的（盲解 + 结构体检），结论按成品 id 记；
 * 源料在 .codex-tmp（不在 git 里），下一次 build_bank 重跑会把这些条目原样再产出来，
 * 所以 build_bank 末尾会自动调一次本脚本，holds 文件才是长期有效的「不上线清单」。
 * __tests__/real-bank-review-holds.test.js 锁死：清单里的 id 不许出现在成品里。
 *
 * 幂等：重复跑无副作用（patch 用 from→to 精确替换，找不到 from 就跳过并提示）。
 *
 * 阅读条目 id 会变（data/realBank/reading/id-aliases.json）：
 *   · reclassified（ap ↔ rdl 归位，同一份材料换了前缀）→ 清单里记在旧 file+id 上的下架 / patch
 *     **照样生效**：顺着账本搬到新 file+id，patch 路径跟着翻译（AP passage ↔ RDL text）。
 *   · consolidated（跨卷同篇合并，副本被合进保留方）→ **不搬**：下架的是那份坏副本，它已经不在库里了，
 *     搬到保留方头上等于把好的那份删掉。
 *
 * 用法: node scripts/realbank/apply_review.mjs [--dry]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { reclassifiedRedirects } = require("./id_aliases.js");

const FILES = {
  "reading/ctw": "reading", "reading/rdl": "reading", "reading/ap": "reading",
  "listening/lcr": "listening", "listening/lc": "listening", "listening/la": "listening", "listening/lat": "listening",
  "speaking/repeat": "speaking", "speaking/interview": "speaking",
  "writing/bs": "writing", "writing/email": "writing", "writing/discussion": "writing",
};
const COUNTS = {
  reading: ["ctw", "rdl", "ap"],
  listening: ["lcr", "lc", "la", "lat"],
  speaking: ["repeat", "interview"],
};

const stripTrailingPunct = (w) => String(w || "").replace(/[.,;:!?]+$/, "");

/** CTW：passage 改动后按 blanks 重算 word_count / blanked_text（与 build_bank.buildCtw 同一口径）。 */
function refreshCtw(item) {
  const toks = String(item.passage || "").trim().split(/\s+/).filter(Boolean);
  item.passage = toks.join(" ");
  item.word_count = toks.length;
  for (const b of item.blanks) {
    if (b.position >= toks.length) throw new Error(`[apply_review] ${item.id}: blank position ${b.position} 越界（patch 把挖空的词截掉了）`);
    const ow = stripTrailingPunct(toks[b.position]);
    if (ow !== b.original_word) throw new Error(`[apply_review] ${item.id}: blank@${b.position} 词变了 ${b.original_word} → ${ow}`);
  }
  const bt = toks.slice();
  for (const b of item.blanks) bt[b.position] = `${b.displayed_fragment}${"_".repeat(Math.max(1, b.hidden_length))}`;
  item.blanked_text = bt.join(" ");
}

// 路径段以 # 开头 = 在数组里按 id 找元素（"sentences.#real_repeat_x_s3.sentence"）。
// 复述句 / 面试题会被 sentence/iq 级下架过滤，下标会漂，所以带 id 的数组一律按 id 寻址。
const step = (o, k) => (o == null ? undefined : k.startsWith("#") && Array.isArray(o) ? o.find((x) => x?.id === k.slice(1)) : o[k]);
function getPath(obj, p) { return p.split(".").reduce(step, obj); }
function setPath(obj, p, v) { const ks = p.split("."); const last = ks.pop(); const o = ks.reduce(step, obj); if (o == null) throw new Error(`[apply_review] 路径 ${p} 不存在`); o[last] = v; }

/**
 * 条目换了题型文件时，patch 的字段路径跟着翻译。AP 的材料在 passage（paragraphs 是它的派生），
 * RDL 的材料在 text；题目路径 questions.* 两边一样。翻不了的（AP 的 paragraphs.N 没有 RDL 对应物）→ null。
 */
function translatePatchPath(p, fromType, toType) {
  if (!p || fromType === toType) return p;
  if (fromType === "ap" && toType === "rdl") {
    if (p === "passage") return "text";
    if (p === "topic") return "genre";
    if (/^(paragraphs|subtopic)(\.|$)/.test(p)) return null;
    return p;
  }
  if (fromType === "rdl" && toType === "ap") {
    if (p === "text") return "passage";
    if (p === "genre") return "topic";
    if (/^format_metadata(\.|$)/.test(p)) return null;
    return p;
  }
  return p;
}

/** AP 的 paragraphs 是 passage 按空行切出来的（build_bank.buildMcqGroup 同口径）；passage 被 patch 过就得重切，
 *  否则两份文字对不上 —— 点选句子题的选项是按 paragraphs 定位的。 */
function refreshApParagraphs(item) {
  if (typeof item.passage !== "string") return;
  item.paragraphs = item.passage.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
}

/** 读别名账本（不存在 / 坏了 = 空账本，行为与没有账本时完全一致）。 */
function readAliasLedger(bankDir) {
  try { return JSON.parse(fs.readFileSync(path.join(bankDir, "reading", "id-aliases.json"), "utf8")); } catch { return null; }
}

/** 这条 AP / RDL 里有没有插入句题（题干口径与 build_bank.looksLikeInsertQuestion 一致）。 */
function hasInsertQuestion(item) {
  const qs = Array.isArray(item && item.questions) ? item.questions : [];
  return qs.some((q) => /insert|slot\s*\d|■|four locations|where would the following sentence/i
    .test(String((q && (q.stem || q.question)) || "")));
}

function applyPatch(item, patch, log) {
  const cur = getPath(item, patch.path);
  if (patch.op === "set") { // 整个字段赋值（非字符串字段，如 distractors 数组）
    if (JSON.stringify(cur) === JSON.stringify(patch.to)) return false;
    setPath(item, patch.path, patch.to);
    return true;
  }
  if (typeof cur !== "string") { log.push(`  ! ${item.id} ${patch.path}: 不是字符串，跳过`); return false; }
  let next = cur;
  switch (patch.op) {
    case "replace":
      if (!cur.includes(patch.from)) return false; // 已修过（幂等）

      next = cur.replace(patch.from, patch.to);
      break;
    case "trim_tail": // 从 from 首次出现处截到末尾
      if (!cur.includes(patch.from)) return false; // 已修过
      next = cur.slice(0, cur.indexOf(patch.from)).trimEnd();
      break;
    case "trim_head": // 截掉开头的 from
      if (!cur.startsWith(patch.from)) return false; // 已修过
      next = cur.slice(patch.from.length).trimStart();
      break;
    case "append":
      if (cur.endsWith(patch.to)) return false;
      next = cur + patch.to;
      break;
    case "strip_insert_markers": // 无插句题却带着 [A]~[D] 位置标记：纯视觉噪声
      // 前提是「无插句题」。插入题被找回之后（parse_reformatted 合成 [A]~[D] 选项 / insert_promote 转正），
      // 这些标记就是作答必需的定位符 —— 真题练习按 passage 渲染，再剥就是造死题。前提不成立时跳过，条目不删。
      if (hasInsertQuestion(item)) {
        log.push("  · " + item.id + " " + patch.path + "：已有插入句题，跳过 strip_insert_markers");
        return false;
      }
      next = cur.replace(/\s*\[[A-D]\]\s*/g, " ").replace(/[ \t]{2,}/g, " ").replace(/ \n/g, "\n").trim();
      if (next === cur) return false;
      break;
    default:
      throw new Error(`[apply_review] 未知 op ${patch.op}`);
  }
  setPath(item, patch.path, next);
  return true;
}

/**
 * 真题音频一律是自家 TTS 按口播文本配的（render_real_audio.mjs），音频内容 == 配音时的文本。
 * patch 改了口播文本，桶里那条 mp3 就过期了：清掉 audio_url、标 audio_pending，前端回退浏览器朗读
 * （文本是对的），render_real_audio.mjs 下次只补这几条（它只挑没有 audio_url 的）。
 * 口播字段：LAT transcript / LA announcement / LCR speaker / LC conversation[].text /
 *           repeat sentences[].sentence / interview questions[].question。题干、选项不发音，不算。
 */
function markAudioStale(item, patchPath) {
  const m = patchPath.match(/^(sentences|questions)\.#([^.]+)\.(sentence|question)$/);
  const owner = m ? (item[m[1]] || []).find((x) => x?.id === m[2]) : /^(transcript|announcement|speaker|conversation(\.\d+\.text)?)$/.test(patchPath) ? item : null;
  if (!owner || !owner.audio_url) return false;
  owner.audio_url = null;
  owner.audio_pending = true;
  return true;
}

/**
 * @param {{root?: string, dry?: boolean, aliases?: object|null}} opts
 *   aliases  id 别名账本（id-aliases.json 的形状）。缺省读 data/realBank/reading/id-aliases.json；
 *            build_bank 在落账本之前调本函数，会把本次重建算出来的账本直接传进来。
 */
export function applyReview({ root = process.cwd(), dry = false, aliases } = {}) {
  const bankDir = path.join(root, "data", "realBank");
  const holdsFile = path.join(bankDir, "review-holds.json");
  if (!fs.existsSync(holdsFile)) { console.warn(`[apply_review] 没有 ${holdsFile}，跳过`); return null; }
  const review = JSON.parse(fs.readFileSync(holdsFile, "utf8"));
  const log = [];
  const stats = { patched: 0, patchGone: 0, holdGone: 0, audioStale: 0, units: 0, questions: 0, sentences: 0, iqs: 0, redirected: 0 };

  // ── 阅读条目被归位（ap ↔ rdl）后，清单里记在旧 file+id 上的条目顺着账本搬到新 file+id ──
  // 只搬「旧 id 在它原来的文件里已经找不到」的：同一个 id 两边都在（归位前的旧库还没重建）时不动。
  const redirects = reclassifiedRedirects(aliases === undefined ? readAliasLedger(bankDir) : aliases);
  const readingIds = {};
  for (const f of ["reading/ap", "reading/rdl"]) {
    try { readingIds[f] = new Set(JSON.parse(fs.readFileSync(path.join(bankDir, `${f}.json`), "utf8")).items.map((it) => it.id)); }
    catch { readingIds[f] = new Set(); }
  }
  const redirect = (x, isPatch) => {
    if (!x || !readingIds[x.file] || readingIds[x.file].has(x.id)) return x;
    const r = redirects.get(String(x.id));
    if (!r || !readingIds[r.file] || !readingIds[r.file].has(r.id)) return x;
    const fromType = x.file.slice("reading/".length);
    const toType = r.file.slice("reading/".length);
    const moved = { ...x, file: r.file, id: r.id, redirected_from: `${x.file}:${x.id}` };
    if (isPatch) {
      const p = translatePatchPath(x.path, fromType, toType);
      if (p == null) return { ...moved, untranslatable: true };
      moved.path = p;
    }
    stats.redirected += 1;
    return moved;
  };
  const holds = (review.holds || []).map((h) => redirect(h, false));
  const patches = (review.patches || []).map((p) => redirect(p, true));

  const holdByFile = {};
  for (const h of holds) (holdByFile[h.file] = holdByFile[h.file] || []).push(h);
  const patchByFile = {};
  for (const p of patches) (patchByFile[p.file] = patchByFile[p.file] || []).push(p);

  const unknown = [...holds, ...patches].filter((x) => !FILES[x.file]).map((x) => x.file);
  if (unknown.length) throw new Error(`[apply_review] 未知 file: ${[...new Set(unknown)].join(", ")}`);

  for (const file of Object.keys(FILES)) {
    const p = path.join(bankDir, `${file}.json`);
    if (!fs.existsSync(p)) continue;
    const bank = JSON.parse(fs.readFileSync(p, "utf8"));
    const byId = new Map(bank.items.map((it) => [it.id, it]));
    const isCtw = file === "reading/ctw";

    for (const patch of patchByFile[file] || []) {
      const it = byId.get(patch.id);
      if (!it) { stats.patchGone += 1; continue; } // 条目已下架（holds 里同一条），patch 自然作废
      if (patch.untranslatable) { stats.patchGone += 1; log.push(`  ! ${patch.redirected_from} → ${file}:${patch.id} 路径 ${patch.path} 在新题型里没有对应字段，跳过`); continue; }
      if (getPath(it, patch.path) === undefined) { stats.patchGone += 1; continue; } // 目标句/题已被 sentence/iq 级下架
      if (applyPatch(it, patch, log)) {
        stats.patched += 1;
        if (isCtw && patch.path === "passage") refreshCtw(it);
        if (file === "reading/ap" && patch.path === "passage") refreshApParagraphs(it);
        if (markAudioStale(it, patch.path)) stats.audioStale += 1;
      }
    }

    const unitHold = new Set();
    const qHold = new Map(); // id → Set(下标)；同一条多题下架必须一次性按下标过滤，逐个 filter 会错位
    for (const h of holdByFile[file] || []) {
      const it = byId.get(h.id);
      if (!it) { stats.holdGone += 1; continue; } // 上一次已下架：幂等重跑的正常情况
      switch (h.scope) {
        case "unit": unitHold.add(h.id); break;
        case "question": (qHold.get(h.id) || qHold.set(h.id, new Set()).get(h.id)).add(h.q); break;
        case "sentence": {
          const before = it.sentences.length;
          it.sentences = it.sentences.filter((s) => s.id !== h.sid);
          if (it.sentences.length !== before) stats.sentences += 1;
          if (it.sentences.length === 0) unitHold.add(h.id);
          break;
        }
        case "iq": {
          const before = it.questions.length;
          it.questions = it.questions.filter((q) => q.id !== h.qid);
          if (it.questions.length !== before) stats.iqs += 1;
          if (it.questions.length === 0) unitHold.add(h.id);
          break;
        }
        default: throw new Error(`[apply_review] 未知 scope ${h.scope}`);
      }
    }
    for (const [id] of qHold) {
      const it = byId.get(id);
      // 定位：**先按 stem 前缀找**，同前缀有多道时才用下标 q 挑。只按下标会漂 —— 挂上点选句子题、
      // 跨卷合并按题号重排之后，同一道题的下标就变了，按旧下标核 stem 对不上只能放过，下架的题就复活了。
      // 清单条目没带 stem 的（老数据）才退回纯下标。已经扣掉的题找不到 → holdGone（幂等）。
      const before = it.questions.length;
      const wanted = holds.filter((h) => h.file === file && h.id === id && h.scope === "question");
      const drop = new Set();
      for (const h of wanted) {
        let at = -1;
        if (h.stem) {
          const hits = [];
          it.questions.forEach((q, i) => { if (!drop.has(i) && String(q.stem || "").startsWith(h.stem)) hits.push(i); });
          at = hits.includes(h.q) ? h.q : (hits.length ? hits[0] : -1);
        } else if (Number.isInteger(h.q) && h.q >= 0 && h.q < it.questions.length && !drop.has(h.q)) {
          at = h.q;
        }
        if (at < 0) { stats.holdGone += 1; continue; }
        drop.add(at);
      }
      it.questions = it.questions.filter((_, i) => !drop.has(i));
      stats.questions += before - it.questions.length;
      if (it.questions.length === 0) { unitHold.add(id); log.push(`  · ${id} 题全被扣光，整条下架`); }
    }
    const kept = bank.items.filter((it) => !unitHold.has(it.id));
    stats.units += bank.items.length - kept.length;
    bank.items = kept;
    bank.count = kept.length;
    if (!dry) fs.writeFileSync(p, JSON.stringify(bank, null, 2), "utf8");
  }

  // counts.json 镜像（首页卡片只 import 这几十字节）
  for (const [dir, keys] of Object.entries(COUNTS)) {
    const c = {};
    for (const k of keys) {
      const p = path.join(bankDir, dir, `${k}.json`);
      if (fs.existsSync(p)) c[k] = JSON.parse(fs.readFileSync(p, "utf8")).items.length;
    }
    if (!dry) fs.writeFileSync(path.join(bankDir, dir, "counts.json"), JSON.stringify(c, null, 2), "utf8");
  }
  return { stats, log };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const dry = process.argv.includes("--dry");
  const r = applyReview({ dry });
  if (r) {
    console.log(`■ apply_review${dry ? "（--dry）" : ""}：patch ${r.stats.patched} 处；下架 整条 ${r.stats.units} / 单题 ${r.stats.questions} / 复述句 ${r.stats.sentences} / 面试题 ${r.stats.iqs}`
      + `（清单里已不在库的 ${r.stats.holdGone} 条、随整条下架作废的 patch ${r.stats.patchGone} 处；`
      + `顺着 id-aliases.json 归位搬到新 file+id 的 ${r.stats.redirected} 条）`);
    if (r.stats.audioStale) console.log(`  口播文本改动 → ${r.stats.audioStale} 条音频作废（audio_pending），本机跑 render_real_audio.mjs 补配`);
    for (const l of r.log) console.log(l);
  }
}
