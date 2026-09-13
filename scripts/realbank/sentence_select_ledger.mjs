#!/usr/bin/env node
/**
 * 真题「点选句子」题账本（data/realBank/reading/sentence-select.json）的抽取与合并。
 *
 * 三步（中间那步是 Python，因为截图定位 + Qwen3-VL 的客户端都在 Python 侧，复用不重写）：
 *
 *   1. node scripts/realbank/sentence_select_ledger.mjs --list
 *        扫第一来源全部卷的学术阅读题号带（M1 26-35 / M2 11-15），挑出
 *          · 答案页给的不是单个字母（"urban planners"、"however…"），或
 *          · OCR 那一屏（截到下一个页眉 / 分页为止）里有 identify / select the sentence
 *        → .codex-tmp/realbank/sentence-select.todo.json
 *   2. python scripts/realbank/sentence_select_stems.py [--dry-run]
 *        对 todo 每条，找到那一屏源截图，Qwen3-VL **逐字转写**题干（不改写、不纠错）
 *        → .codex-tmp/realbank/sentence-select.stems.json
 *   3. node scripts/realbank/sentence_select_ledger.mjs --merge
 *        题干（去界面指令）+ 段号 + 答案开头词 + 正确句（在**该卷该篇**第 N 段里唯一匹配句首得出）
 *        → data/realBank/reading/sentence-select.json（进仓库；建库不依赖 .codex-tmp）
 *
 * 然后建库 → node scripts/realbank/audit_sentence_select.mjs 盲审（只审哈希失配的）→ 再建库上线。
 *
 * 为什么题干不直接用 structured.json 里的：那是 DeepSeek 读 OCR 之后的结构化输出，可能被顺手「修」过。
 * 题干是上线给用户看的原文，必须是转写（Qwen 看截图），structured 的只拿来做一致性核对，记在账本里给人看。
 *
 * 用法：
 *   node scripts/realbank/sentence_select_ledger.mjs --list [--set 5.3新托福真题]
 *   node scripts/realbank/sentence_select_ledger.mjs --merge [--dry-run]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const SS = require("./sentence_select.js");

const ROOT = process.cwd();
const RB = path.join(ROOT, ".codex-tmp", "realbank");
const OCR_DIRS = [path.join(ROOT, ".codex-tmp", "ocr"), path.join(ROOT, ".codex-tmp", "exam_txt")];
const LEDGER = path.join(ROOT, "data", "realBank", "reading", "sentence-select.json");
const TODO = path.join(RB, "sentence-select.todo.json");
const STEMS = path.join(RB, "sentence-select.stems.json");

const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const argVal = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };

/** 卷名 → id 里的短标识。与 build_bank.mjs 的 setSlug 逐字同口径（那边有 main() 副作用，不能 import）。 */
function setSlug(setname) {
  if (/^r[fp]\d{4}$/.test(String(setname))) return String(setname);
  const m = String(setname).match(/^(\d{1,2})[.．](\d{1,2})/);
  const base = m ? `${m[1]}${m[2]}` : "x";
  const variant = String(setname).match(/([ABC])卷/);
  const rev = String(setname).match(/_v(\d+)$/);
  return base + (variant ? variant[1].toLowerCase() : "") + (rev ? `v${rev[1]}` : "");
}

const inApBand = (module, q) => (module === 1 && q >= 26 && q <= 35) || (module === 2 && q >= 11 && q <= 15);
const isLetterAnswer = (a) => /^\s*[a-h]\s*[.,，]?\s*$/i.test(String(a || ""));
const SELECT_RE = /identify\s*the\s*sentence|select\s*the\s*sentence/i;
const HEADER_RE = /reading\W{0,6}question\W{0,3}(\d+)\W{0,3}(?:-\W{0,3}\d+\W{0,3})?of\W{0,3}(\d+)/gi;

/** 某卷 OCR 里「Reading Question q of T」那一屏的文字（截到下一个页眉或分页符为止）。 */
function ocrBlocks(set) {
  const out = [];
  for (const dir of OCR_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${set}__`) && !/答案|原文|listening|听力|口语|speaking|写作/i.test(f))) {
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      const hits = [...txt.matchAll(HEADER_RE)];
      for (let i = 0; i < hits.length; i += 1) {
        const start = hits[i].index;
        let end = i + 1 < hits.length ? hits[i + 1].index : txt.length;
        const pm = txt.slice(start, end).search(/=====\s*PAGE\s+\d+\s*=====/);
        if (pm > 0) end = start + pm;
        const total = Number(hits[i][2]);
        out.push({ q: Number(hits[i][1]), module: total === 35 ? 1 : total === 15 ? 2 : null, text: txt.slice(start, end), file: `${path.basename(dir)}/${f}` });
      }
    }
  }
  return out;
}

function cmdList() {
  const only = argVal("--set");
  const sets = fs.readdirSync(RB).filter((f) => f.endsWith(".structured.json") && !/^r[fp]\d{4}/.test(f))
    .map((f) => f.replace(/\.structured\.json$/, "")).filter((s) => !only || s === only).sort();
  const entries = [];
  for (const set of sets) {
    const scan = readJ(path.join(RB, `${set}.json`));
    const st = readJ(path.join(RB, `${set}.structured.json`));
    const answers = new Map();
    for (const m of scan?.alignment?.reading?.modules || []) for (const x of m.matched || []) answers.set(`${m.module}#${x.n}`, x.answer);
    const blocks = ocrBlocks(set);
    const cand = new Map();
    for (const [k, a] of answers) {
      const [module, q] = k.split("#").map(Number);
      if (inApBand(module, q) && !isLetterAnswer(a)) cand.set(k, { why: "answer_not_letter" });
    }
    for (const b of blocks) {
      if (!b.module || !inApBand(b.module, b.q) || !SELECT_RE.test(b.text)) continue;
      const k = `${b.module}#${b.q}`;
      cand.set(k, { ...(cand.get(k) || {}), why: cand.has(k) ? "answer_not_letter+ocr_select" : "ocr_select" });
    }
    for (const [k, c] of cand) {
      const [module, q] = k.split("#").map(Number);
      const rec = (st?.results || []).find((r) => r.section === "reading" && r.module === module
        && (r.items || []).some((it) => it && it.q_number === q));
      const it = rec ? rec.items.find((x) => x && x.q_number === q) : null;
      const block = blocks.find((b) => b.module === module && b.q === q && SELECT_RE.test(b.text))
        || blocks.find((b) => b.module === module && b.q === q);
      entries.push({
        key: `${set}#${module}#${q}`, set, slug: setSlug(set), module, q_number: q, why: c.why,
        answer_raw: answers.get(k) ?? null,
        stem_structured: it ? String(it.stem || "") : null,
        material: it ? String(it.material || "") : null,
        ocr_file: block ? block.file : null,
        ocr_block: block ? block.text.slice(0, 4000) : null,
      });
    }
  }
  fs.mkdirSync(RB, { recursive: true });
  fs.writeFileSync(TODO, JSON.stringify({ generated_by: "scripts/realbank/sentence_select_ledger.mjs --list", entries }, null, 2), "utf8");
  console.log(`■ 点选句子题候选 ${entries.length} 道（${sets.length} 套第一来源卷）→ ${path.relative(ROOT, TODO)}`);
  for (const e of entries) console.log(`  · ${e.key}  答案=${JSON.stringify(e.answer_raw)}  [${e.why}]`);
}

function cmdMerge() {
  const dry = process.argv.includes("--dry-run");
  const todo = readJ(TODO);
  if (!todo) { console.error(`没有 ${TODO}，先跑 --list`); process.exit(2); }
  const stems = new Map(((readJ(STEMS) || {}).entries || []).map((s) => [`${s.set}#${s.module}#${s.q_number}`, s]));
  const prev = readJ(LEDGER) || { entries: [], rejected: [] };
  const prevByKey = new Map((prev.entries || []).map((e) => [e.key, e]));

  const entries = [];
  const rejected = [];
  for (const t of todo.entries || []) {
    const reject = (why, extra = {}) => rejected.push({ key: t.key, why, ...extra });
    // 先看答案键：答案页漏了这一题就定不了正确句（stems 那一步也不会为它花钱转写）
    if (t.answer_raw == null || isLetterAnswer(t.answer_raw)) { reject(t.answer_raw == null ? "no_answer_key" : "answer_is_letter", { answer_raw: t.answer_raw }); continue; }
    const s = stems.get(t.key);
    if (!s || !String(s.stem_raw || "").trim()) { reject("no_transcribed_stem"); continue; }
    const stem = SS.cleanStem(s.stem_raw);
    if (!/identify\s+the\s+sentence|select\s+the\s+sentence|which\s+sentence/i.test(stem)) { reject("not_sentence_select_stem", { stem }); continue; }
    const paragraph = SS.paragraphOf(stem);
    if (paragraph == null) { reject("no_paragraph_number", { stem }); continue; }
    const prefixWords = SS.answerPrefixWords(t.answer_raw);
    if (!prefixWords.length) { reject("empty_answer_prefix", { answer_raw: t.answer_raw }); continue; }

    // 正确句：在「该卷该篇」（这道题自己那一屏的结构化材料）第 N 段里唯一匹配句首。
    // 定不下来不算致命 —— 建库时还会在宿主条目的第 N 段里再唯一匹配一次，盲审再核一次语义；
    // 这里记下来的句子是给宿主换了 OCR 变体时做交叉核对用的。
    const paras = String(t.material || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    const n = SS.expectedParagraphIndex(paras, paragraph);        // 与建库同口径：先判 paragraphs[0] 是不是标题
    const sents = n != null ? SS.splitSentences(paras[n]) : [];
    const m = sents.length ? SS.matchByPrefix(sents, prefixWords) : { error: "paragraph_out_of_range" };
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const entry = {
      key: t.key, set: t.set, slug: t.slug, module: t.module, q_number: t.q_number,
      stem, stem_raw: s.stem_raw, stem_source: s.model || "qwen3-vl",
      stem_matches_structured: t.stem_structured != null ? norm(SS.cleanStem(t.stem_structured)) === norm(stem) : null,
      paragraph,
      answer_raw: t.answer_raw,
      answer_prefix: prefixWords.join(" "),
      correct_sentence: m.error ? null : sents[m.index],
      correct_sentence_note: m.error ? `own_material_${m.error}` : null,
      source_page: s.source_page || null,
      audits: (prevByKey.get(t.key) || {}).audits || [],
    };
    entries.push(entry);
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  rejected.sort((a, b) => a.key.localeCompare(b.key));
  const doc = {
    generated_by: "scripts/realbank/sentence_select_ledger.mjs --merge",
    _purpose: "真题学术阅读「点选句子」题：题干为截图逐字转写，正确句由答案页开头词在该段唯一匹配句首得出；"
      + "audits 按「题干 + 用户看到的段落文字」哈希记盲审结论，build_bank 核哈希放行。",
    entries, rejected,
  };
  console.log(`■ 点选句子题账本：收 ${entries.length} 道 / 拒 ${rejected.length} 道`);
  for (const e of entries) console.log(`  ✓ ${e.key}  第 ${e.paragraph} 段  「${e.answer_prefix}」→ ${e.correct_sentence ? e.correct_sentence.slice(0, 60) : `（该卷材料里定不下：${e.correct_sentence_note}）`}${e.stem_matches_structured === false ? "  ⚠ 转写题干与 structured 不一致" : ""}`);
  for (const r of rejected) console.log(`  ✗ ${r.key}  ${r.why}`);
  if (dry) { console.log("（--dry-run，未写账本）"); return; }
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`→ ${path.relative(ROOT, LEDGER)}`);
}

if (process.argv.includes("--list")) cmdList();
else if (process.argv.includes("--merge")) cmdMerge();
else { console.error("用法：--list | --merge [--dry-run]"); process.exit(2); }
