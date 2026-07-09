#!/usr/bin/env node
/**
 * R0 — Anchor Re-measure / Spec-vs-Code consistency diff.
 *
 * For each question type, re-computes (deterministically, no LLM, no network)
 * the key quantitative metrics that its docs/eval-spec/*.md file CLAIMS were
 * "measured from the anchor corpus", straight from the anchor JSON/markdown,
 * and lines them up against:
 *   - the value the spec claims (hard-coded here, with a source line ref),
 *   - the matching constant in the validators,
 *   - the matching band in lib/quality/scoreBatch.mjs,
 *   - the matching frozen tolerance in lib/gate/gate-registry.js.
 *
 * Output:
 *   - markdown report at data/claudeGen/reports/R0-anchor-remeasure-2026-07-09.md
 *   - stdout summary (per-type MATCH / DRIFT / UNVERIFIABLE counts).
 *
 * Anchor recompute is REAL (computed here). Spec "claim" values are transcribed
 * constants (allowed by the task); code constants are pulled LIVE where the file
 * is requireable (etsProfile, readingEtsProfile, ctw gate measurer, gate-registry),
 * else transcribed with a file:line ref.
 *
 * Usage:  node scripts/audit/measure-anchors.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = join(ROOT, "data/claudeGen/reports/R0-anchor-remeasure-2026-07-09.md");

// ── Live code constants (requireable CJS) ─────────────────────────────
let etsProfile = {}, readingProfile = {}, ctwMeasurer = null, gateRegistry = null;
const loadWarn = [];
try { etsProfile = require(join(ROOT, "lib/questionBank/etsProfile.js")); }
catch (e) { loadWarn.push(`etsProfile: ${e.message}`); }
try { readingProfile = require(join(ROOT, "lib/readingBank/readingEtsProfile.js")); }
catch (e) { loadWarn.push(`readingEtsProfile: ${e.message}`); }
try { ctwMeasurer = require(join(ROOT, "lib/gate/measurers/ctw.js")); }
catch (e) { loadWarn.push(`ctw measurer: ${e.message}`); }
try { gateRegistry = require(join(ROOT, "lib/gate/gate-registry.js")); }
catch (e) { loadWarn.push(`gate-registry: ${e.message}`); }

// ── Generic helpers ───────────────────────────────────────────────────
function loadJSON(relPath) {
  const p = join(ROOT, relPath);
  return JSON.parse(readFileSync(p, "utf8"));
}
/** Shape-tolerant item extractor: {items:[]} | {sets:[]} | {question_sets:[]} | [] */
function itemsOf(data) {
  if (Array.isArray(data)) return data;
  for (const k of ["items", "sets", "question_sets", "prompts"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return null; // caller must handle null (report parse-fail, don't swallow)
}
/** Word count: whitespace split, keep only tokens with an alphanumeric char (drops standalone ? . , tiles). */
function wc(s) {
  return String(s || "").trim().split(/\s+/).filter((t) => /[a-z0-9]/i.test(t)).length;
}
function sentenceCount(s) {
  return String(s || "").trim().split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 1).length;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(n, d) { return d ? n / d : NaN; }
function r1(x) { return Number.isFinite(x) ? Math.round(x * 10) / 10 : x; }
function r2(x) { return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }
function pctStr(x) { return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—"; }

// ── Verdict engine ────────────────────────────────────────────────────
// kind: "rate" (0..1, tol default 0.03 abs) | "count"/"word" (abs tol default 0.6) | "int"
function verdict(anchor, spec, { kind = "rate", tol } = {}) {
  if (!Number.isFinite(anchor) || spec == null || !Number.isFinite(spec)) return "n/a";
  const t = tol != null ? tol : (kind === "rate" ? 0.03 : 0.6);
  const diff = Math.abs(anchor - spec);
  if (diff <= t) return "MATCH";
  const disp = kind === "rate" ? `${(diff * 100).toFixed(1)}pp` : `${r2(diff)}`;
  return `DRIFT(Δ${disp})`;
}

const REPORT = [];
const SUMMARY = {}; // type -> {MATCH, DRIFT, UNVERIFIABLE}

function tallyVerdict(type, v) {
  SUMMARY[type] = SUMMARY[type] || { MATCH: 0, DRIFT: 0, UNVERIFIABLE: 0 };
  if (v === "UNVERIFIABLE") SUMMARY[type].UNVERIFIABLE++;
  else if (String(v).startsWith("MATCH")) SUMMARY[type].MATCH++;
  else if (String(v).startsWith("DRIFT")) SUMMARY[type].DRIFT++;
}

/** row = {metric, spec, anchor, validator, scoreBatch, gate, verdict} */
function section(type, title, rows, notes) {
  REPORT.push(`\n## ${title}\n`);
  if (notes) REPORT.push(notes + "\n");
  REPORT.push(`| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |`);
  REPORT.push(`|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    tallyVerdict(type, r.verdict);
    REPORT.push(`| ${r.metric} | ${r.spec ?? "—"} | ${r.anchor ?? "—"} | ${r.validator ?? "N/A"} | ${r.scoreBatch ?? "N/A"} | ${r.gate ?? "N/A"} | ${r.verdict} |`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// BS — Build a Sentence  (anchor: buildSentence-targets.json, 504 targets)
// ══════════════════════════════════════════════════════════════════════
function auditBS() {
  const rows = [];
  const data = loadJSON("data/realExam2026/writing/buildSentence-targets.json");
  const items = itemsOf(data);
  if (!items) { section("bs", "Build a Sentence (`bs`)", [{ metric: "PARSE", spec: "-", anchor: "解析失败: 无 items/sets", verdict: "UNVERIFIABLE" }]); return; }
  const targets = items.map((it) => String(it.target || ""));
  const n = targets.length;
  const lens = targets.map(wc);

  // D1 answer length
  const mn = mean(lens), md = median(lens), lo = Math.min(...lens), hi = Math.max(...lens);
  const tpo = etsProfile.TPO_REFERENCE_PROFILE || {};
  rows.push({ metric: "D1 答案词数 mean", spec: "9.16 (bs.md L35)", anchor: r2(mn),
    validator: "bsQuality lenOK 7-15w", scoreBatch: "ans 7-15w", gate: "N/A",
    verdict: verdict(mn, 9.16, { kind: "word" }) });
  rows.push({ metric: "D1 答案词数 median/min/max", spec: "9 / 4 / 15", anchor: `${md} / ${lo} / ${hi}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(md, 9, { kind: "word", tol: 0 }) });
  rows.push({ metric: "avgAnswerWords vs code-const", spec: `code=${tpo.avgAnswerWords}`, anchor: r2(mn),
    validator: "—", scoreBatch: "—", gate: "N/A",
    verdict: verdict(mn, tpo.avgAnswerWords, { kind: "word" }) });

  // D2 difficulty bands by length ≤7 / 8-11 / ≥12
  const easy = lens.filter((l) => l <= 7).length;
  const medm = lens.filter((l) => l >= 8 && l <= 11).length;
  const hard = lens.filter((l) => l >= 12).length;
  const dr = etsProfile.ETS_DIFFICULTY_RATIO || {};
  rows.push({ metric: "D2 easy(≤7w) 占比", spec: "24.6% (bs.md L43)", anchor: pctStr(pct(easy, n)),
    validator: `ETS_DIFFICULTY_RATIO.easy=${dr.easy}`, scoreBatch: "—", gate: "N/A",
    verdict: verdict(pct(easy, n), 0.246) });
  rows.push({ metric: "D2 medium(8-11w) 占比", spec: "59.5%", anchor: pctStr(pct(medm, n)),
    validator: `ratio.medium=${dr.medium}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(medm, n), 0.595) });
  rows.push({ metric: "D2 hard(≥12w) 占比", spec: "15.9%", anchor: pctStr(pct(hard, n)),
    validator: `ratio.hard=${dr.hard}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(hard, n), 0.159) });

  // D4 qmark
  const qm = targets.filter((t) => t.trim().endsWith("?")).length;
  rows.push({ metric: "D4 结尾 ? 占比", spec: "14.5% (bs.md L63)", anchor: pctStr(pct(qm, n)),
    validator: `qmarkMin/Max 0/2 per set`, scoreBatch: "—", gate: "N/A",
    verdict: verdict(pct(qm, n), 0.145) });
  rows.push({ metric: "qmarkRatio vs code-const", spec: `code=${tpo.qmarkRatio}`, anchor: pctStr(pct(qm, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(qm, n), tpo.qmarkRatio) });

  // D5 signature "Do you know / Can you tell me + if/whether/wh"
  const sigRe = /^\s*(do you know|can you tell me|could you tell me|do you think (it|that))\s+(if|whether|wh|when|where|why|how|who|what|which)/i;
  const sig = targets.filter((t) => sigRe.test(t)).length;
  rows.push({ metric: "D5 'Do you know if…' signature", spec: "17.3% (bs.md L70)", anchor: pctStr(pct(sig, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(sig, n), 0.173) });

  // D6 negation. spec explicitly counts casual "no, I…" → report strict(no bare-no)–inclusive as a bracket.
  const negStrict = /\b(not|never|cannot|can't|won't|don't|doesn't|didn't|haven't|hasn't|isn't|wasn't|aren't|weren't|couldn't|wouldn't|shouldn't|n't)\b/i;
  const negIncl = /\b(not|never|no|none|nothing|cannot|can't|won't|don't|doesn't|didn't|haven't|hasn't|isn't|wasn't|aren't|weren't|couldn't|wouldn't|shouldn't|n't)\b/i;
  const negLo = pct(targets.filter((t) => negStrict.test(t)).length, n);
  const negHi = pct(targets.filter((t) => negIncl.test(t)).length, n);
  const negBracket = (0.24 >= negLo - 0.005 && 0.24 <= negHi + 0.005) ? "MATCH" : verdict(negHi, 0.24);
  rows.push({ metric: "D6 negation 占比 (strict–含 casual 'no')", spec: "24.0% (bs.md L78)", anchor: `${pctStr(negLo)}–${pctStr(negHi)}`,
    validator: `negationMin/Max 1/3 per set`, scoreBatch: "—", gate: "N/A", verdict: negBracket });
  rows.push({ metric: "negationRatio 代码常量 vs 锚实测", spec: `code=${tpo.negationRatio} (0.2)`, anchor: `真实 ${pctStr(negLo)}–${pctStr(negHi)}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(negHi, tpo.negationRatio) });

  // D8 passive (approx detector)
  const passRe = /\b(is|are|was|were|be|been|being)\s+\w+(ed|en|t)\b/i;
  const pass = targets.filter((t) => passRe.test(t)).length;
  rows.push({ metric: "D8 passive 占比 (近似检测器)", spec: "8.3% (bs.md L93)", anchor: pctStr(pct(pass, n)),
    validator: `passiveRatio=${tpo.passiveRatio}`, scoreBatch: "—", gate: "N/A",
    verdict: verdict(pct(pass, n), 0.083, { tol: 0.05 }) });

  // D9 contraction
  const conRe = /\b\w+'(m|re|ve|ll|d|s|t)\b|\bn't\b/i;
  const con = targets.filter((t) => conRe.test(t)).length;
  rows.push({ metric: "D9 contraction 占比", spec: "23.0% (bs.md L100)", anchor: pctStr(pct(con, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(con, n), 0.23, { tol: 0.04 }) });

  // D11 first person (starts I/I'm/My/No, I)
  const fpRe = /^\s*(i\b|i'm\b|i've\b|i'd\b|my\b|no,?\s+i\b|yes,?\s+i\b)/i;
  const fp = targets.filter((t) => fpRe.test(t)).length;
  rows.push({ metric: "D11 first-person 开头 占比", spec: "40.3% (bs.md L115)", anchor: pctStr(pct(fp, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(fp, n), 0.403, { tol: 0.04 }) });

  // D12 distractor — UNVERIFIABLE (structured targets carry no tile/distractor field; render-level 0/14)
  rows.push({ metric: "D12 distractor 密度", spec: "0/14 renders (bs.md L122)", anchor: "结构化 target 无 tile 字段",
    validator: `distractorMin/Max 6/10; distractorRatio=${tpo.distractorRatio}`, scoreBatch: "distractorOK 计数", gate: "N/A",
    verdict: "UNVERIFIABLE" });

  // Person-prefilled from TPO source (tpo_source.md, 60 items)
  const pfRes = measureTPOPersonPrefilled();
  if (pfRes.ok) {
    const pf = etsProfile.PREFILLED_PROFILE || {};
    const subjTgt = pf.wordTypeRatio?.["subject-pronoun"];
    rows.push({ metric: "D15 person-prefilled 比率 (TPO 实测, 前导主语代词)", spec: `subject-pronoun 目标 ${subjTgt} (etsProfile)`, anchor: `${pctStr(pfRes.personFrac)} (${pfRes.person}/${pfRes.total})`,
      validator: "scoreBatch person 带 0.10-0.40; PERSON_PREFILLED_GATE 0.45", scoreBatch: "personFrac 带", gate: "N/A",
      verdict: verdict(pfRes.personFrac, subjTgt, { tol: 0.08 }) });
    rows.push({ metric: "prefilled presence (TPO 实测)", spec: `presenceRatio ${pf.presenceRatio} (etsProfile)`, anchor: `${pctStr(pfRes.presenceFrac)} (${pfRes.present}/${pfRes.total})`,
      validator: `givenWordRatio=${tpo.givenWordRatio}`, scoreBatch: "—", gate: "N/A",
      verdict: verdict(pfRes.presenceFrac, pf.presenceRatio, { tol: 0.06 }) });
    rows.push({ metric: "prefilled multi-segment (TPO 实测)", spec: `multiSegmentRatio ${pf.multiSegmentRatio} (etsProfile); renders ~21% (bs.md L136)`, anchor: `${pctStr(pfRes.multiFrac)} (${pfRes.multi}/${pfRes.present})`,
      validator: "—", scoreBatch: "—", gate: "N/A",
      verdict: verdict(pfRes.multiFrac, pf.multiSegmentRatio, { tol: 0.08 }) });
  } else {
    rows.push({ metric: "D15 person-prefilled (TPO)", spec: "-", anchor: `tpo_source 解析失败: ${pfRes.reason}`, verdict: "UNVERIFIABLE" });
  }

  const note = `**锚**: \`data/realExam2026/writing/buildSentence-targets.json\` (n=${n} targets, tier=recalled). ` +
    `词数 = 空白切分后仅计含字母数字的 token(丢弃独立 ? . 标点 tile)。` +
    `passive/contraction/relative 用重实现的近似检测器(spec 的检测器为手校验), 数字接近即判 MATCH; ` +
    `person-prefilled 取自 \`data/buildSentence/tpo_source.md\`(60 TPO 项, 前导 prefilled 为主语代词=person)。`;
  section("bs", "Build a Sentence (`bs`)", rows, note);
}

function measureTPOPersonPrefilled() {
  let s;
  try { s = readFileSync(join(ROOT, "data/buildSentence/tpo_source.md"), "utf8"); }
  catch (e) { return { ok: false, reason: e.message }; }
  s = s.replace(/\\([._!?])/g, "$1"); // unescape markdown
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^_{0,2}\d+\._{0,2}\s*/.test(lines[i])) markers.push(i);
  }
  if (markers.length < 30) return { ok: false, reason: `only ${markers.length} markers` };
  const SUBJ = new Set(["i", "he", "she", "they", "we", "you", "it"]);
  let total = 0, person = 0, present = 0, multi = 0;
  for (const idx of markers) {
    // template line = first line within idx+1..idx+3 that carries blank runs
    // (the marker line sometimes holds only "__1.__", with prompt on idx+1 and
    // the blank template on idx+2; and a blank line can separate them).
    let tmpl = "";
    for (let k = 1; k <= 3; k++) { if (/_{2,}/.test(lines[idx + k] || "")) { tmpl = lines[idx + k]; break; } }
    if (!/_{2,}/.test(tmpl)) continue; // template line must carry blanks
    total++;
    // Split by blank runs → segments of prefilled words
    const segs = tmpl.split(/_{2,}/).map((x) => x.replace(/[.?!,]/g, " ").trim()).filter(Boolean);
    if (segs.length) present++;
    if (segs.length >= 2) multi++;
    // person = leading segment's first token is a subject pronoun
    const leadFirst = (segs[0] || "").split(/\s+/)[0]?.toLowerCase() || "";
    // "leading" only if template does NOT start with a blank
    const startsWithPrefill = !/^_{2,}/.test(tmpl);
    if (startsWithPrefill && SUBJ.has(leadFirst)) person++;
  }
  return { ok: true, total, person, present, multi,
    personFrac: pct(person, total), presenceFrac: pct(present, total), multiFrac: pct(multi, present) };
}

// ══════════════════════════════════════════════════════════════════════
// AD — Academic Discussion  (anchor: academicDiscussion.json, 50 items)
// ══════════════════════════════════════════════════════════════════════
function auditAD() {
  const rows = [];
  const items = itemsOf(loadJSON("data/realExam2026/writing/academicDiscussion.json"));
  if (!items) { section("ad", "Academic Discussion (`ad`)", [{ metric: "PARSE", anchor: "解析失败", verdict: "UNVERIFIABLE" }]); return; }
  const n = items.length;

  // D10 students per item
  const spc = items.map((it) => (it.students || []).length);
  const two = spc.filter((x) => x === 2).length;
  rows.push({ metric: "D10 每题学生数=2", spec: "47/50 (ad.md L111)", anchor: `${two}/${n} (${pctStr(pct(two, n))})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(two, n), 47 / 50, { tol: 0.04 }) });

  // D11 student post length (words)
  const posts = items.flatMap((it) => (it.students || []).map((s) => String(s.text || "")));
  const plens = posts.map(wc).filter((x) => x > 0);
  rows.push({ metric: "D11 学生贴词数 mean/median", spec: "42.7 / 40 (ad.md L115)", anchor: `${r1(mean(plens))} / ${median(plens)}`,
    validator: "—", scoreBatch: "discQuality s1/s2 250-700 chars", gate: "N/A",
    verdict: verdict(mean(plens), 42.7, { kind: "word", tol: 3 }) });

  // D12 student sentences
  const psent = posts.map(sentenceCount).filter((x) => x > 0);
  rows.push({ metric: "D12 学生贴句数 mean/median", spec: "3 / 3 (ad.md L122)", anchor: `${r1(mean(psent))} / ${median(psent)}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(psent), 3, { kind: "word", tol: 0.6 }) });

  // D13 student opener
  let ib = 0, imo = 0;
  for (const t of posts) {
    if (/^\s*i\s+(believe|think)/i.test(t)) ib++;
    else if (/^\s*in my opinion/i.test(t)) imo++;
  }
  rows.push({ metric: "D13 学生开头 'I believe/think'", spec: "56% (ad.md L128)", anchor: pctStr(pct(ib, posts.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(ib, posts.length), 0.56, { tol: 0.05 }) });
  rows.push({ metric: "D13 学生开头 'In my opinion'", spec: "21%", anchor: pctStr(pct(imo, posts.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(imo, posts.length), 0.21, { tol: 0.05 }) });

  // D15 S2 references S1 by name
  let s2ref = 0, both = 0;
  for (const it of items) {
    const st = (it.students || []).filter((s) => s && s.name && /[a-z]/i.test(s.name));
    if (st.length >= 2) {
      both++;
      const n1 = String(st[0].name).trim();
      const n2t = String(st[1].text || "");
      if (n1 && new RegExp(`\\b${n1.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`).test(n2t)) s2ref++;
    }
  }
  rows.push({ metric: "D15 S2 点名 S1", spec: "0% (ad.md L142)", anchor: `${pctStr(pct(s2ref, both))} (${s2ref}/${both})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(s2ref, both), 0, { tol: 0.02 }) });

  // D19 student name pool {Claire,Paul,Andrew,Kelly}
  const POOL = new Set(["claire", "paul", "andrew", "kelly"]);
  const allNames = items.flatMap((it) => (it.students || []).map((s) => String(s.name || "").trim().toLowerCase()))
    .filter((x) => x && x !== "i think");
  const inPool = allNames.filter((x) => POOL.has(x)).length;
  rows.push({ metric: "D19 学生名∈{Claire,Paul,Andrew,Kelly}", spec: "100% (ad.md L169)", anchor: `${pctStr(pct(inPool, allNames.length))} (${inPool}/${allNames.length})`,
    validator: "—", scoreBatch: "discDiversity 名字越多越好", gate: "N/A",
    verdict: verdict(pct(inPool, allNames.length), 1.0, { tol: 0.02 }) });

  // D1 professor name Dr. <Surname>
  const drN = items.filter((it) => /^dr\.\s/i.test(String(it.professor || ""))).length;
  rows.push({ metric: "D1 教授名 'Dr. <Surname>'", spec: "49/50 (ad.md L45)", anchor: `${drN}/${n} (${pctStr(pct(drN, n))})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(drN, n), 49 / 50, { tol: 0.04 }) });

  // D6 Why? tag on professor_question (NOTE: structured 50-item question, not the n=36 full-post set)
  const whyRe = /Why(\?| or why not\?| do you think so\?)|Explain your (views|reasoning)|Give reasons/i;
  const why = items.filter((it) => whyRe.test(String(it.professor_question || ""))).length;
  rows.push({ metric: "D6 教授问句 Why? 尾标 (在 50 题 professor_question 上)", spec: "53% (ad.md L86, 源自 n=36 全贴)", anchor: pctStr(pct(why, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(why, n), 0.53, { tol: 0.05 }) });

  // D21 topic recurrence — distinct professor_question strings
  const distinctQ = new Set(items.map((it) => String(it.professor_question || "").toLowerCase().trim())).size;
  rows.push({ metric: "D21 distinct question strings", spec: "35/50 distinct (66% cores; ad.md L182)", anchor: `${distinctQ}/${n} (${pctStr(pct(distinctQ, n))})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(distinctQ, n), 35 / 50, { tol: 0.06 }) });

  // D2/D3/D4 professor opener/framing/contractions — UNVERIFIABLE (full post not in structured JSON)
  rows.push({ metric: "D2/D3/D4 教授 opener/two-sided/contraction", spec: "61%/81%/72% (ad.md L53/61/72)", anchor: "结构化 JSON 只存 professor_question, 无完整教授贴",
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/writing/academicDiscussion.json\` (n=${n}, tier=recalled)。` +
    `⚠ 该结构化文件只抽取了 \`professor_question\`(最后一问), 未存完整教授贴 → D2/D3/D4/D5/D7/D8/D9(教授 opener/framing/gloss/长度/句数) 全部 UNVERIFIABLE(spec 自己也标注这些取自 scripts/research 手抄的 n=36 全贴)。学生侧字段完整可复算。`;
  section("ad", "Academic Discussion (`ad`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// Email  (anchor: email.json, 51 items)
// ══════════════════════════════════════════════════════════════════════
function auditEmail() {
  const rows = [];
  const items = itemsOf(loadJSON("data/realExam2026/writing/email.json"));
  if (!items) { section("email", "Email (`email`)", [{ metric: "PARSE", anchor: "解析失败", verdict: "UNVERIFIABLE" }]); return; }
  const n = items.length;

  // D1 bullet count
  const three = items.filter((it) => (it.bullets || []).length === 3).length;
  rows.push({ metric: "D1 bullet 数=3", spec: "51/51 (email.md L32)", anchor: `${three}/${n} (${pctStr(pct(three, n))})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(three, n), 1.0, { tol: 0.01 }) });

  // D2 bullet lead-verb distribution (Explain/Describe share)
  const allBullets = items.flatMap((it) => (it.bullets || []).map(String));
  const leadVerb = (b) => (b.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z]/g, "");
  const verbs = allBullets.map(leadVerb);
  const explain = verbs.filter((v) => v === "explain").length;
  const describe = verbs.filter((v) => v === "describe").length;
  rows.push({ metric: "D2 bullet lead-verb Explain", spec: "29.4% (email.md L36)", anchor: pctStr(pct(explain, verbs.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(explain, verbs.length), 0.294, { tol: 0.04 }) });
  rows.push({ metric: "D2 bullet lead-verb Describe", spec: "26.8%", anchor: pctStr(pct(describe, verbs.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(describe, verbs.length), 0.268, { tol: 0.04 }) });
  rows.push({ metric: "D2 Explain+Describe 合计", spec: "56%", anchor: pctStr(pct(explain + describe, verbs.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(explain + describe, verbs.length), 0.56, { tol: 0.05 }) });

  // D4 distinct-verbs-per-item (3 distinct)
  const distinct3 = items.filter((it) => new Set((it.bullets || []).map(leadVerb)).size === 3).length;
  rows.push({ metric: "D4 三 bullet 动词全不同", spec: "90.2% (email.md L50)", anchor: pctStr(pct(distinct3, n)),
    validator: "prompt: each DIFFERENT verb", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(distinct3, n), 0.902, { tol: 0.05 }) });

  // D6 recipient surface form
  const recForm = (r) => {
    const t = String(r || "").trim();
    if (/^(mr|ms|mrs|dr|professor|prof)\.?\s+\S+/i.test(t)) return "title_surname";
    if (/^[A-Z][a-z]+$/.test(t)) return "first_only";
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(t)) return "first_last";
    return "other";
  };
  const forms = items.map((it) => recForm(it.recipient));
  const ts = forms.filter((f) => f === "title_surname").length;
  const fo = forms.filter((f) => f === "first_only").length;
  rows.push({ metric: "D6 recipient Title+Surname", spec: "82.4% (email.md L68)", anchor: pctStr(pct(ts, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(ts, n), 0.824, { tol: 0.05 }) });
  rows.push({ metric: "D6 recipient first-name-only", spec: "17.6%", anchor: pctStr(pct(fo, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(fo, n), 0.176, { tol: 0.05 }) });

  // D8 scenario opener
  const opener = (sc) => {
    const t = String(sc || "").trim().toLowerCase();
    if (/^you are\b/.test(t)) return "you_are";
    if (/^you recently\b/.test(t)) return "you_recently";
    if (/^your\b/.test(t)) return "your_x";
    if (/^you and your\b/.test(t)) return "you_and";
    return "other";
  };
  const ops = items.map((it) => opener(it.scenario));
  rows.push({ metric: "D8 scenario opener 'You are'", spec: "49% (email.md L83)", anchor: pctStr(pct(ops.filter((o) => o === "you_are").length, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(ops.filter((o) => o === "you_are").length, n), 0.49, { tol: 0.05 }) });
  rows.push({ metric: "D8 scenario opener 'You recently'", spec: "33.3%", anchor: pctStr(pct(ops.filter((o) => o === "you_recently").length, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(ops.filter((o) => o === "you_recently").length, n), 0.333, { tol: 0.05 }) });

  // D9 scenario word count
  const swc = items.map((it) => wc(it.scenario));
  rows.push({ metric: "D9 scenario 词数 mean/median", spec: "39.5 / 39 (email.md L91)", anchor: `${r1(mean(swc))} / ${median(swc)}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(swc), 39.5, { kind: "word", tol: 2 }) });

  // D10 scenario sentences
  const ssc = items.map((it) => sentenceCount(it.scenario));
  rows.push({ metric: "D10 scenario 句数 mean", spec: "3.4 (email.md L96)", anchor: r1(mean(ssc)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(ssc), 3.4, { kind: "word", tol: 0.5 }) });

  // D11 bullet word length
  const bwl = allBullets.map(wc);
  rows.push({ metric: "D11 bullet 词数 mean/median", spec: "9.2 / 9 (email.md L102)", anchor: `${r1(mean(bwl))} / ${median(bwl)}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(bwl), 9.2, { kind: "word", tol: 0.8 }) });

  // D12 subject word count
  const subwc = items.map((it) => wc(it.subject));
  rows.push({ metric: "D12 subject 词数 mean/median", spec: "4.1 / 4 (email.md L105)", anchor: `${r1(mean(subwc))} / ${median(subwc)}`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(subwc), 4.1, { kind: "word", tol: 0.6 }) });

  // D13 scenario specificity (quote char)
  const quoted = items.filter((it) => /["'“”‘’]/.test(String(it.scenario || ""))).length;
  rows.push({ metric: "D13 scenario 含引号命名", spec: "29.4% (email.md L112)", anchor: pctStr(pct(quoted, n)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(quoted, n), 0.294, { tol: 0.06 }) });

  // D5 macro / D7 role / D14 topic — UNVERIFIABLE (需语义分类, 无结构化标签)
  rows.push({ metric: "D5/D7/D14 macro function/role/topic 域", spec: "31.4%/74.5%/64.7% (email.md L57/76/117)", anchor: "需语义分类器(scenario 无结构化域标签)",
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/writing/email.json\` (n=${n}, bullets/recipient/subject OCR-verbatim)。` +
    `D5(macro function)/D7(role)/D14(topic 域) 是语义分类维度, 无结构化标签可确定性复算 → UNVERIFIABLE。`;
  section("email", "Email (`email`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// AP — Academic Passage  (anchor: academicPassage.json, 64 items raw)
// ══════════════════════════════════════════════════════════════════════
function auditAP() {
  const rows = [];
  const items = itemsOf(loadJSON("data/realExam2026/reading/academicPassage.json"));
  if (!items) { section("ap", "Academic Passage (`ap`)", [{ metric: "PARSE", anchor: "解析失败", verdict: "UNVERIFIABLE" }]); return; }
  const n = items.length;
  const AP = readingProfile.AP_PROFILE || {};
  const FLA = readingProfile.ETS_FLAVOR || {};

  // dedup by passage text
  const seen = new Set();
  const uniq = items.filter((it) => { const k = String(it.passage || "").slice(0, 120); if (seen.has(k)) return false; seen.add(k); return true; });
  const pw = items.map((it) => wc(it.passage));
  const pwU = uniq.map((it) => wc(it.passage));

  rows.push({ metric: "D2 passage 词数 mean (raw n=64)", spec: "182.5 (clean n=39; ap.md L47)", anchor: r1(mean(pw)),
    validator: "passage 110-230 (real 150-210)", scoreBatch: "reading-ap 160-210", gate: "N/A",
    verdict: verdict(mean(pw), 182.5, { kind: "word", tol: 6 }) });
  rows.push({ metric: "D2 passage 词数 mean (dedup n=" + uniq.length + ")", spec: "182.5 / median 189 / max 209", anchor: `${r1(mean(pwU))} / ${median(pwU)} / ${Math.max(...pwU)}`,
    validator: `AP_PROFILE ${AP.passageWordCount?.min}-${AP.passageWordCount?.max} tgt${AP.passageWordCount?.target}`, scoreBatch: "160-210", gate: "N/A",
    verdict: verdict(mean(pwU), 182.5, { kind: "word", tol: 6 }) });

  // D4 avg sentence length (spec basis n=64 → use all items, not dedup)
  const asl = [];
  for (const it of items) {
    const sents = String(it.passage || "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 1);
    for (const s of sents) { const w = wc(s); if (w > 0) asl.push(w); }
  }
  rows.push({ metric: "D4 平均句长 (词/句, n=64)", spec: "16.6 (ap.md L60)", anchor: r1(mean(asl)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(asl), 16.6, { kind: "word", tol: 1 }) });

  // D8 options per question
  const optCounts = items.flatMap((it) => (it.questions || []).map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const four = optCounts.filter((c) => c === 4).length;
  rows.push({ metric: "D8 每题 4 选项", spec: "205/207 (ap.md L98)", anchor: `${four}/${optCounts.length} (${pctStr(pct(four, optCounts.length))})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(four, optCounts.length), 205 / 207, { tol: 0.03 }) });

  // D18 lexical register — avg word length & long-word ratio (spec basis n=64)
  let allLens = [];
  for (const it of items) {
    const toks = String(it.passage || "").toLowerCase().match(/[a-z]+/g) || [];
    allLens = allLens.concat(toks.map((t) => t.length));
  }
  const awl = mean(allLens);
  const longShare = pct(allLens.filter((l) => l >= 7).length, allLens.length);
  rows.push({ metric: "D18 avg word length", spec: "5.63 (ap.md L152)", anchor: r2(awl),
    validator: `ETS_FLAVOR.avgWordLength=${FLA.avgWordLength}`, scoreBatch: "—", gate: "N/A",
    verdict: verdict(awl, 5.63, { kind: "word", tol: 0.15 }) });
  rows.push({ metric: "D18 long-word(≥7ch) ratio", spec: "0.371 (ap.md L152)", anchor: r2(longShare),
    validator: `ETS_FLAVOR.longWordRatio=${FLA.longWordRatio}`, scoreBatch: "—", gate: "N/A",
    verdict: verdict(longShare, 0.371, { tol: 0.03 }) });

  // D1/D5/D6 questions per passage & type mix — UNVERIFIABLE (JSON under-extracted, no type labels)
  const qpp = mean(items.map((it) => (it.questions || []).length));
  rows.push({ metric: "D1 每篇题数 (JSON raw)", spec: "5 (真值; JSON 欠抽取 ~3.2; ap.md L40)", anchor: `raw mean ${r2(qpp)}`,
    validator: "question_count 必须=5", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });
  rows.push({ metric: "D5/D6 题型分布 & insert_text", spec: "见 ap.md L66/79", anchor: "JSON 问题欠抽取且无 question_type 字段 → 手抄自 OCR",
    validator: `AP_PROFILE.questionTypeTargets`, scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/reading/academicPassage.json\` (raw n=${n}; dedup-by-passage n=${uniq.length})。` +
    `⚠ spec 的 182.5 是在「dedup + 剔除 3 条 RIDL 泄漏 = clean n=39」上测的; 本脚本只能按 passage 文本去重(无法确定性剔 RIDL), 故 raw/dedup 两口径都给。题数/题型分布因 JSON 欠抽取且无 question_type 标签 → UNVERIFIABLE。`;
  section("ap", "Academic Passage (`ap`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// CTW — Complete the Words  (anchor: completeTheWords.json, 75 paragraphs)
//   Uses the SAME detector as the frozen gate (lib/gate/measurers/ctw.js).
// ══════════════════════════════════════════════════════════════════════
function auditCTW() {
  const rows = [];
  const items = itemsOf(loadJSON("data/realExam2026/reading/completeTheWords.json"));
  if (!items) { section("ctw", "Complete the Words (`ctw`)", [{ metric: "PARSE", anchor: "解析失败", verdict: "UNVERIFIABLE" }]); return; }
  const n = items.length;
  const CTW = readingProfile.CTW_PROFILE || {};

  let measured = null;
  if (ctwMeasurer) measured = ctwMeasurer.measure(items);

  // gate tolerances
  const gdims = {};
  try { for (const d of gateRegistry.REGISTRY.ctw.dimensions) gdims[d.name] = d; } catch { /* */ }

  if (measured) {
    const pwMean = mean(measured.map((m) => m.passage_word_count));
    const s1wMean = mean(measured.map((m) => m.first_sentence_words));
    const s1lenMean = mean(measured.map((m) => m.first_sentence_avg_word_len));
    const s1longMean = mean(measured.map((m) => m.first_sentence_long_word_share));
    const scMean = mean(measured.map((m) => m.sentence_count));

    rows.push({ metric: "D2 passage 词数 mean (gate detector, OCR)", spec: "69.3 OCR / ~71.8 glue-repaired (ctw.md L36)", anchor: r1(pwMean),
      validator: "<45 err / >120 warn; tgt " + CTW.passageWordCount?.target, scoreBatch: "reading-ctw 60-95", gate: `hard tol±${gdims.passage_word_count?.tol}`,
      verdict: verdict(pwMean, 69.3, { kind: "word", tol: gdims.passage_word_count?.tol ?? 9 }) });
    rows.push({ metric: "D7 首句词数 mean", spec: "16.7 (ctw.md L74)", anchor: r1(s1wMean),
      validator: "—", scoreBatch: "—", gate: `hard tol±${gdims.first_sentence_words?.tol}`,
      verdict: verdict(s1wMean, 16.7, { kind: "word", tol: gdims.first_sentence_words?.tol ?? 3 }) });
    rows.push({ metric: "D7 首句 avg word length", spec: "5.89 (ctw.md L74)", anchor: r2(s1lenMean),
      validator: "prompt 4.5-5.5 (偏低)", scoreBatch: "—", gate: `hard tol±${gdims.first_sentence_avg_word_len?.tol}`,
      verdict: verdict(s1lenMean, 5.89, { kind: "word", tol: gdims.first_sentence_avg_word_len?.tol ?? 0.45 }) });
    rows.push({ metric: "D7 首句 long-word(≥7ch) share", spec: "38.9% (ctw.md L74)", anchor: pctStr(s1longMean),
      validator: "—", scoreBatch: "—", gate: `hard tol±${gdims.first_sentence_long_word_share?.tol}`,
      verdict: verdict(s1longMean, 0.389, { tol: gdims.first_sentence_long_word_share?.tol ?? 0.10 }) });
    rows.push({ metric: "sentence_count mean", spec: "4-5 mode (ctw.md L36)", anchor: r1(scMean),
      validator: `${CTW.sentenceCount?.min}-${CTW.sentenceCount?.max}`, scoreBatch: "—", gate: "monitor",
      verdict: verdict(scMean, 4.5, { kind: "word", tol: 1 }) });
  } else {
    rows.push({ metric: "gate 检测器载入", spec: "-", anchor: "无法 require lib/gate/measurers/ctw.js", verdict: "UNVERIFIABLE" });
  }

  // D1/D3/D4 blank-level — UNVERIFIABLE (structured anchor has no blanks[]; answer keys live in .codex-tmp)
  rows.push({ metric: "D1/D3/D4 blank 数/POS/词长", spec: "10 blanks; 33.9% fn; 5.77ch (ctw.md L28/44/52)", anchor: "结构化锚只有 paragraph OCR, 无 blanks[]; 答案键在 .codex-tmp(非 data/)",
    validator: `blankCount ${CTW.blankCount}; blankAvgLength tgt ${CTW.blankAvgLength?.target}`, scoreBatch: "—", gate: "N/A",
    verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/reading/completeTheWords.json\` (n=${n}, 字段=paragraph OCR)。` +
    `passage 级维度用**与冻结 gate 相同的检测器** \`lib/gate/measurers/ctw.js\` 计算, 直接对齐 gate-registry 冻结带。` +
    `⚠ OCR 会把词黏连(glue) → 词数系统性偏低(spec 承认 69.3 OCR vs ~71.8 真值)。blank 级维度锚里没有 → UNVERIFIABLE。`;
  section("ctw", "Complete the Words (`ctw`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// RDL — Read in Daily Life  (anchor: readInDailyLife/*.json, silver = goarno+third_party)
// ══════════════════════════════════════════════════════════════════════
function auditRDL() {
  const rows = [];
  const g = itemsOf(loadJSON("data/reading/samples/readInDailyLife/goarno.json")) || [];
  const t = itemsOf(loadJSON("data/reading/samples/readInDailyLife/third_party.json")) || [];
  const o = itemsOf(loadJSON("data/reading/samples/readInDailyLife/ets_official.json")) || [];
  const f = itemsOf(loadJSON("data/reading/samples/readInDailyLife/ets_fulllength.json")) || [];
  const silver = [...g, ...t];
  const RDL = readingProfile.RDL_PROFILE || {};
  const nS = silver.length;

  // D2 questions per text (silver)
  const qpt = silver.map((it) => (it.questions || []).length);
  rows.push({ metric: "D2 每篇题数 mean (银层 n=" + nS + ")", spec: "≈2.9 (152/52; rdl.md L32)", anchor: r2(mean(qpt)),
    validator: "short=2 / 通用 2-4", scoreBatch: "—", gate: "N/A", verdict: verdict(mean(qpt), 2.9, { kind: "word", tol: 0.3 }) });

  // D3 question type distribution (silver, from question_type field)
  const typeCount = {};
  let nq = 0;
  for (const it of silver) for (const q of (it.questions || [])) { typeCount[q.question_type] = (typeCount[q.question_type] || 0) + 1; nq++; }
  const tt = RDL.questionTypeTargets || {};
  rows.push({ metric: "D3 题型 detail 占比", spec: "≈55% (rdl.md L36)", anchor: pctStr(pct(typeCount.detail || 0, nq)),
    validator: `RDL_PROFILE.detail=${tt.detail}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(typeCount.detail || 0, nq), 0.55, { tol: 0.04 }) });
  rows.push({ metric: "D3 题型 inference 占比", spec: "≈28%", anchor: pctStr(pct(typeCount.inference || 0, nq)),
    validator: `inference=${tt.inference}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(typeCount.inference || 0, nq), 0.28, { tol: 0.04 }) });
  rows.push({ metric: "D3 题型 main_idea 占比", spec: "≈12%", anchor: pctStr(pct(typeCount.main_idea || 0, nq)),
    validator: `main_idea=${tt.main_idea}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(typeCount.main_idea || 0, nq), 0.12, { tol: 0.04 }) });
  rows.push({ metric: "D3 题型 vocab 占比", spec: "≈5%", anchor: pctStr(pct(typeCount.vocabulary_in_context || 0, nq)),
    validator: `vocab=${tt.vocabulary_in_context}`, scoreBatch: "—", gate: "N/A", verdict: verdict(pct(typeCount.vocabulary_in_context || 0, nq), 0.05, { tol: 0.03 }) });

  // D8 NOT questions
  const notRe = /\bNOT\b|\bEXCEPT\b/;
  let notCount = 0;
  for (const it of silver) for (const q of (it.questions || [])) if (notRe.test(String(q.stem || ""))) notCount++;
  rows.push({ metric: "D8 NOT/EXCEPT 题占比", spec: "≈11% (17/152; rdl.md L61)", anchor: pctStr(pct(notCount, nq)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(notCount, nq), 0.11, { tol: 0.04 }) });

  // D8 referencesGenre — stem names the document genre ("the email/notice/...").
  // Broader than "According to the email" (spec detector counts any genre reference).
  const refRe = /\b(the|this)\s+(email|notice|announcement|message|memo|post|text|schedule|flyer|letter|policy|syllabus|sign|receipt|review|poster|form|website|app|menu|invitation|newsletter|bulletin|guide|document|article|passage)\b/i;
  let refCount = 0;
  for (const it of silver) for (const q of (it.questions || [])) if (refRe.test(String(q.stem || ""))) refCount++;
  rows.push({ metric: "D8 referencesGenre 占比", spec: "≈34% (51/152; rdl.md L61)", anchor: pctStr(pct(refCount, nq)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(refCount, nq), 0.34, { tol: 0.06 }) });

  // D1 word count band — official 6 groups
  const ets6 = [...o, ...f];
  const ets6wc = ets6.map((it) => Number(it.word_count) || wc(it.text));
  rows.push({ metric: "D1 官方 6 组字数 range/median", spec: "43-153, median 140 (rdl.md L29)", anchor: `${Math.min(...ets6wc)}-${Math.max(...ets6wc)}, median ${median(ets6wc)}`,
    validator: "short 38-62 / long 80-150", scoreBatch: "rdl-short 38-62 / rdl-long 80-150", gate: "N/A",
    verdict: verdict(median(ets6wc), 140, { kind: "word", tol: 5 }) });

  // D10 guessability / D4 改写深度 / D5 干扰项 — UNVERIFIABLE (需 solver / 语义标注)
  rows.push({ metric: "D10 可猜率 / D4 改写深度 / D5 干扰项构造", spec: "18.4% / overlap 0.60… (rdl.md L69/44/48)", anchor: "需 solver 或语义/词重叠标注 → 非确定性结构复算",
    validator: "answerAuditor 可测(merge 层)", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/reading/samples/readInDailyLife/\` 银层 goarno(${g.length})+third_party(${t.length})=${nS} 组 / ${nq} 题(spec 定量口径); 官方金层 ${ets6.length} 组另算字数带。` +
    `题型分布用样本自带 \`question_type\` 字段。可猜率/改写深度/干扰项构造需 solver 或语义标注 → UNVERIFIABLE。`;
  section("rdl", "Read in Daily Life (`rdl`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// Listening — LC / LA / LAT / short-response
// ══════════════════════════════════════════════════════════════════════
function auditListening() {
  const rows = [];

  // ---- LC (conversations) ----
  const conv = itemsOf(loadJSON("data/realExam2026/listening/conversations.json")) || [];
  const convWords = conv.map((it) => (Array.isArray(it.conversation) ? it.conversation.reduce((s, tt) => s + wc(tt.text), 0) : 0));
  const convClean = convWords.filter((w) => w > 0 && w <= 150); // spec clean filter: drop >150w ASR merges
  rows.push({ metric: "A1 conversation 词数 median/mean (clean ≤150w, n=" + convClean.length + ")", spec: "median 89 / mean 90 (listening.md L40)", anchor: `${median(convClean)} / ${r1(mean(convClean))}`,
    validator: "conv 80-250w (err<60/>280)", scoreBatch: "listening-lc 68-105", gate: "N/A",
    verdict: verdict(median(convClean), 89, { kind: "word", tol: 5 }) });
  // A2 turn count — UNVERIFIABLE (150/155 是单 blob ASR, JSON 无真实 turn)
  const multiTurn = conv.filter((it) => Array.isArray(it.conversation) && it.conversation.length >= 3).length;
  rows.push({ metric: "A2 turn 数", spec: "median 6 (listening.md L52)", anchor: `JSON 中 ${conv.length - multiTurn}/${conv.length} 是单 blob ASR(turn=1); 仅 ${multiTurn} 条多轮`,
    validator: "turns 6-15", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  // ---- LA (announcements) ----
  const ann = itemsOf(loadJSON("data/realExam2026/listening/announcements.json")) || [];
  const annWords = ann.map((it) => wc(it.transcript));
  const annClean = annWords.filter((w) => w > 0 && w <= 150);
  rows.push({ metric: "B1 announcement 词数 median/mean (clean ≤150w, n=" + annClean.length + ")", spec: "median 83 / mean 82 (listening.md L105)", anchor: `${median(annClean)} / ${r1(mean(annClean))}`,
    validator: "anno 40-150w (err<30/>170)", scoreBatch: "listening-la 55-120", gate: "N/A",
    verdict: verdict(median(annClean), 83, { kind: "word", tol: 5 }) });
  // B2 opener "Attention" — spec detector strips Man:/Woman: + setting lead-in, classifies first ~45 chars
  const stripLbl = (s) => String(s || "").replace(/^\s*(man|woman|speaker)\s*:\s*/i, "");
  const attn = ann.filter((it) => /attention/i.test(stripLbl(it.transcript).slice(0, 45))).length;
  rows.push({ metric: "B2 'Attention' opener 占比 (前45字符)", spec: "21% (listening.md L118)", anchor: `${pctStr(pct(attn, ann.length))} (${attn}/${ann.length})`,
    validator: "OPENING_PATTERNS Attention rate:64 (spec 称 FALSE)", scoreBatch: "—", gate: "N/A",
    verdict: verdict(pct(attn, ann.length), 0.21, { tol: 0.06 }) });

  // ---- LAT (lectures) ----
  const lec = itemsOf(loadJSON("data/realExam2026/listening/lectures.json")) || [];
  const lecWords = lec.map((it) => wc(it.transcript));
  const lecClean = lecWords.filter((w) => w > 0 && w <= 330); // spec clean filter: drop >330w merges
  rows.push({ metric: "C1 lecture 词数 median/mean (clean ≤330w, n=" + lecClean.length + ")", spec: "median 250 / mean 246 (listening.md L149)", anchor: `${median(lecClean)} / ${r1(mean(lecClean))}`,
    validator: "transcript 120-300w (err<100/>320)", scoreBatch: "listening-lat 200-330", gate: "N/A",
    verdict: verdict(median(lecClean), 250, { kind: "word", tol: 8 }) });

  // ---- short-response ----
  const sr = itemsOf(loadJSON("data/realExam2026/listening/shortResponse.json")) || [];
  const prompts = sr.flatMap((it) => (it.prompts || []).map(String));
  const pw = prompts.map(wc);
  rows.push({ metric: "D1 short-response prompt 词数 median/mean (n=" + prompts.length + ")", spec: "median 8 / mean 7.9 (listening.md L204)", anchor: `${median(pw)} / ${r1(mean(pw))}`,
    validator: "lcr speaker 4-20w", scoreBatch: "listening-lcr 3-14", gate: "N/A",
    verdict: verdict(median(pw), 8, { kind: "word", tol: 1 }) });
  // D2 sentence type wh / yes-no / statement.
  // ⚠ spec caveat (listening.md D2): MUST strip leaked "Man:/Woman:" labels first,
  // else wh badly undercounts (e.g. "Woman: Where is…?" reads as non-wh).
  let wh = 0, yn = 0, stmt = 0;
  const WH = /^(who|what|where|when|why|how|which|whose)\b/i;
  const stripSpk = (p) => String(p || "").replace(/^\s*(man|woman|speaker)\s*:\s*/i, "").trim();
  for (const raw of prompts) {
    const p = stripSpk(raw);
    const isQ = p.endsWith("?");
    if (!isQ) { stmt++; continue; }
    if (WH.test(p)) wh++; else yn++;
  }
  rows.push({ metric: "D2 short-response wh-question 占比", spec: "49% (listening.md L217)", anchor: pctStr(pct(wh, prompts.length)),
    validator: "lcr statements 30% / questions 70%", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(wh, prompts.length), 0.49, { tol: 0.05 }) });
  rows.push({ metric: "D2 short-response question 合计", spec: "74% (wh49+yn24)", anchor: pctStr(pct(wh + yn, prompts.length)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(wh + yn, prompts.length), 0.74, { tol: 0.05 }) });

  // E1 answer-position / C5 lecture q-count — UNVERIFIABLE
  rows.push({ metric: "E1 答案位分布 / C5 lecture 题数", spec: "A24/B28/C28/D20; 4 题 (listening.md L245/197)", anchor: "答案键在 .codex-tmp(非 data/); lecture questions JSON 多为空 → 手抄自 OCR",
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/listening/{conversations,announcements,lectures,shortResponse}.json\`。` +
    `长度维度按 spec 的 clean filter 剔 ASR 拼接离群(conv/ann >150w, lec >330w)。` +
    `⚠ conversation 的 turn 数不可复算(155 条里 150 条是单 blob ASR, JSON 无真实分轮); 答案位/题型分布锚在 .codex-tmp → UNVERIFIABLE。`;
  section("listening", "Listening (LC / LA / LAT / short-response)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// Speaking repeat  (anchor: repeat.json, 51 sets / 351 sentences → sets key)
// ══════════════════════════════════════════════════════════════════════
function auditSpeakingRepeat() {
  const rows = [];
  const data = loadJSON("data/realExam2026/speaking/repeat.json");
  const sets = itemsOf(data); // handles {sets:[]}
  if (!sets) { section("speaking_repeat", "Speaking · Listen-and-Repeat (`speaking_repeat`)", [{ metric: "PARSE", anchor: "解析失败(键非 items/sets)", verdict: "UNVERIFIABLE" }]); return; }
  const nSets = sets.length;
  const allSent = sets.flatMap((s) => (s.sentences || []));
  const nSent = allSent.length;

  // D1 sentences per set = 7
  const seven = sets.filter((s) => (s.sentences || []).length === 7).length;
  rows.push({ metric: "D1 每套句数=7", spec: "47/51 (92%; repeat.md L26)", anchor: `${seven}/${nSets} (${pctStr(pct(seven, nSets))})`,
    validator: "validateRepeatSet: !==7", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(seven, nSets), 47 / 51, { tol: 0.05 }) });

  // D2 sentence length words
  const slens = allSent.map((x) => Number(x.words) || wc(x.text));
  rows.push({ metric: "D2 句词数 mean/median/min/max", spec: "9.56 / 9 / 4 / 17 (repeat.md L32)", anchor: `${r2(mean(slens))} / ${median(slens)} / ${Math.min(...slens)} / ${Math.max(...slens)}`,
    validator: "REPEAT_WORD_RANGES easy4-7/med8-12/hard13-20", scoreBatch: "repeatQuality word band", gate: "N/A",
    verdict: verdict(mean(slens), 9.56, { kind: "word", tol: 0.6 }) });

  // D3 difficulty tier mix (file labels)
  const dc = { easy: 0, medium: 0, hard: 0 };
  for (const s of allSent) if (dc[s.difficulty] != null) dc[s.difficulty]++;
  rows.push({ metric: "D3 tier easy 占比 (file 标签)", spec: "≈26% (repeat.md L44)", anchor: pctStr(pct(dc.easy, nSent)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(dc.easy, nSent), 0.26, { tol: 0.05 }) });
  rows.push({ metric: "D3 tier medium 占比", spec: "≈52%", anchor: pctStr(pct(dc.medium, nSent)),
    validator: "prog: mediumCount≥45%", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(dc.medium, nSent), 0.52, { tol: 0.05 }) });
  rows.push({ metric: "D3 tier hard 占比", spec: "≈16%", anchor: pctStr(pct(dc.hard, nSent)),
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(dc.hard, nSent), 0.16, { tol: 0.05 }) });

  // D3 exact 2/3/2 signature share
  const s232 = sets.filter((s) => {
    const c = { easy: 0, medium: 0, hard: 0 };
    for (const x of (s.sentences || [])) if (c[x.difficulty] != null) c[x.difficulty]++;
    return (s.sentences || []).length === 7 && c.easy === 2 && c.medium === 3 && c.hard === 2;
  }).length;
  rows.push({ metric: "D3 精确 2/3/2 signature 占比", spec: "6.4% (3/47; repeat.md L44)", anchor: `${pctStr(pct(s232, nSets))} (${s232}/${nSets})`,
    validator: "validateRepeatSet warns unless 2/3/2 (100% gen)", scoreBatch: "—", gate: "N/A",
    verdict: verdict(pct(s232, nSets), 0.064, { tol: 0.04 }) });

  // D4 last sentence longest
  let lastLongest = 0, considered = 0;
  for (const s of sets) {
    const arr = (s.sentences || []).map((x) => Number(x.words) || wc(x.text));
    if (arr.length < 2) continue;
    considered++;
    if (arr[arr.length - 1] >= Math.max(...arr)) lastLongest++;
  }
  rows.push({ metric: "D4 末句最长(或并列最长)", spec: "91.8% (45/49; repeat.md L52)", anchor: `${pctStr(pct(lastLongest, considered))} (${lastLongest}/${considered})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(lastLongest, considered), 0.918, { tol: 0.06 }) });

  // D5 S1 opener "Welcome"
  const welc = sets.filter((s) => /^\s*(welcome|let's)\b/i.test(String((s.sentences || [])[0]?.text || ""))).length;
  rows.push({ metric: "D5 S1 'Welcome/Let's' 开头", spec: "16% (8/51; repeat.md L58)", anchor: `${pctStr(pct(welc, nSets))} (${welc}/${nSets})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(welc, nSets), 0.16, { tol: 0.05 }) });

  // D7 yes/no questions (qmark)
  const qmk = allSent.filter((x) => String(x.text || "").trim().endsWith("?")).length;
  rows.push({ metric: "D7 含问号句占比", spec: "0% (0/351; repeat.md L66)", anchor: `${pctStr(pct(qmk, nSent))} (${qmk}/${nSent})`,
    validator: "easy structures 列 yes/no question", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(qmk, nSent), 0, { tol: 0.02 }) });

  // D9 direct address you/your
  const addr = allSent.filter((x) => /\byou(r)?\b/i.test(String(x.text || ""))).length;
  rows.push({ metric: "D9 direct address (you/your) 占比", spec: "37.3% (repeat.md L80)", anchor: pctStr(pct(addr, nSent)),
    validator: "natural_spoken_register 峰值 addrRate=0.37", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(addr, nSent), 0.373, { tol: 0.04 }) });

  // D11 conditional if
  const iff = allSent.filter((x) => /^\s*if\b|\bif you\b/i.test(String(x.text || ""))).length;
  rows.push({ metric: "D11 if 条件句占比", spec: "10% (35/351; repeat.md L94)", anchor: pctStr(pct(iff, nSent)),
    validator: "hard.structures leads conditional", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(iff, nSent), 0.10, { tol: 0.04 }) });

  // D12 punitive trope
  const punRe = /will result in|suspension|privileges|incur|penalt|violation/i;
  const pun = allSent.filter((x) => punRe.test(String(x.text || ""))).length;
  rows.push({ metric: "D12 punitive-warning 占比", spec: "0% (0/351; repeat.md L99)", anchor: `${pctStr(pct(pun, nSent))} (${pun}/${nSent})`,
    validator: "hard.structures 列 result/consequence", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(pun, nSent), 0, { tol: 0.02 }) });

  // D13 wayfinding closer (last sentence mentions map/schedule/guide…)
  const wayRe = /\b(map|schedule|guide|directory|floor plan|catalog|catalogue)\b/i;
  let way = 0;
  for (const s of sets) { const last = (s.sentences || [])[(s.sentences || []).length - 1]; if (last && wayRe.test(String(last.text || ""))) way++; }
  rows.push({ metric: "D13 末句 wayfinding(map/schedule) 占比", spec: "33% (17/51; repeat.md L107)", anchor: `${pctStr(pct(way, nSets))} (${way}/${nSets})`,
    validator: "—", scoreBatch: "—", gate: "N/A", verdict: verdict(pct(way, nSets), 0.33, { tol: 0.07 }) });

  const note = `**锚**: \`data/realExam2026/speaking/repeat.json\` (键=**sets**, ${nSets} 套 / ${nSent} 句; 每句带 words+difficulty)。词数优先用 sentences[].words 字段。`;
  section("speaking_repeat", "Speaking · Listen-and-Repeat (`speaking_repeat`)", rows, note);
}

// ══════════════════════════════════════════════════════════════════════
// Speaking interview  (anchor: interview.json, 14 sets)
// ══════════════════════════════════════════════════════════════════════
function auditInterview() {
  const rows = [];
  const sets = itemsOf(loadJSON("data/realExam2026/speaking/interview.json"));
  if (!sets) { section("speaking_interview", "Speaking · Interview (`speaking_interview`)", [{ metric: "PARSE", anchor: "解析失败", verdict: "UNVERIFIABLE" }]); return; }
  const n = sets.length;

  // D-questions per set
  const qc = sets.map((s) => (s.questions || []).length);
  rows.push({ metric: "每套问题数 median/mean/range", spec: "3-9, median 6-7 (interview.md L24)", anchor: `median ${median(qc)} / mean ${r1(mean(qc))} / ${Math.min(...qc)}-${Math.max(...qc)}`,
    validator: "validateInterviewSet: 必须=4 (App 设计)", scoreBatch: "interviewQuality 期望 4", gate: "N/A",
    verdict: (median(qc) >= 6 && median(qc) <= 7) ? "MATCH" : verdict(median(qc), 6.5, { kind: "word", tol: 0.6 }) });

  // all interrogative (end ?)
  const allQ = sets.flatMap((s) => (s.questions || []).map(String));
  const q = allQ.filter((x) => x.trim().endsWith("?")).length;
  rows.push({ metric: "D3 全部疑问句(结尾?)", spec: "solid (全疑问; interview.md L46)", anchor: `${pctStr(pct(q, allQ.length))} (${q}/${allQ.length})`,
    validator: "validator 问号检查 + 去重", scoreBatch: "allQ 批级复核", gate: "N/A",
    verdict: verdict(pct(q, allQ.length), 1.0, { tol: 0.05 }) });

  // question word count — UNVERIFIABLE per spec (recall-compressed)
  const qwc = allQ.map(wc);
  rows.push({ metric: "问题字数 median (回忆压缩)", spec: "7-14 词但 spec 判**不可信** (interview.md L25)", anchor: `median ${median(qwc)} / mean ${r1(mean(qwc))}`,
    validator: "INTERVIEW_WORD_RANGES 25-50", scoreBatch: "interviewQuality 20-60", gate: "N/A",
    verdict: "UNVERIFIABLE" });

  const note = `**锚**: \`data/realExam2026/speaking/interview.json\` (n=${n} 套, questions[] 为字符串)。` +
    `问题字数 spec 自己判**不可信**(回忆者写的是压缩转述, 非考场完整口语) → UNVERIFIABLE; 只有「每套问数」「全疑问」可结构复算。`;
  section("speaking_interview", "Speaking · Interview (`speaking_interview`)", rows, note);
}

// ── Run all ───────────────────────────────────────────────────────────
function run() {
  const errs = [];
  const runners = [
    ["bs", auditBS], ["ad", auditAD], ["email", auditEmail], ["ap", auditAP],
    ["ctw", auditCTW], ["rdl", auditRDL], ["listening", auditListening],
    ["speaking_repeat", auditSpeakingRepeat], ["speaking_interview", auditInterview],
  ];
  for (const [name, fn] of runners) {
    try { fn(); }
    catch (e) { errs.push(`${name}: ${e.stack || e.message}`); REPORT.push(`\n## ${name}\n\n解析/计算异常(如实记录, 未吞掉): \`${e.message}\`\n`); SUMMARY[name] = SUMMARY[name] || { MATCH: 0, DRIFT: 0, UNVERIFIABLE: 0 }; }
  }

  // Header
  const totals = { MATCH: 0, DRIFT: 0, UNVERIFIABLE: 0 };
  for (const s of Object.values(SUMMARY)) { totals.MATCH += s.MATCH; totals.DRIFT += s.DRIFT; totals.UNVERIFIABLE += s.UNVERIFIABLE; }

  const header = [];
  header.push(`# R0 — 评价标准数字复算 (anchor re-measure)\n`);
  header.push(`> 生成: \`node scripts/audit/measure-anchors.mjs\` · 日期 2026-07-09 · 确定性/无 LLM/无网络。`);
  header.push(`> 对每个题型, 从锚语料**重新计算** spec 里声称的定量指标, 对照 validator / scoreBatch / gate 里同维度常量。`);
  header.push(`> 判定 = spec 声称值 vs 锚实测(现在)。MATCH=容差内; DRIFT(Δ)=偏差; UNVERIFIABLE=锚非结构化/回忆压缩/spec 未给数字。\n`);
  if (loadWarn.length) header.push(`> ⚠ 代码常量载入警告: ${loadWarn.join("; ")}\n`);
  header.push(`## 总览\n`);
  header.push(`| 题型 | MATCH | DRIFT | UNVERIFIABLE |`);
  header.push(`|---|---|---|---|`);
  for (const [type, s] of Object.entries(SUMMARY)) header.push(`| ${type} | ${s.MATCH} | ${s.DRIFT} | ${s.UNVERIFIABLE} |`);
  header.push(`| **合计** | **${totals.MATCH}** | **${totals.DRIFT}** | **${totals.UNVERIFIABLE}** |\n`);

  const md = header.join("\n") + "\n" + REPORT.join("\n") + "\n";
  // NaN/undefined leak guard
  const leaks = (md.match(/\b(NaN|undefined)\b/g) || []).length;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, md + (leaks ? `\n> ⚠ 报告含 ${leaks} 处 NaN/undefined, 需排查。\n` : ""));

  // stdout summary
  console.log("R0 anchor re-measure — per-type verdict counts:");
  for (const [type, s] of Object.entries(SUMMARY)) {
    console.log(`  ${type.padEnd(20)} MATCH=${s.MATCH}  DRIFT=${s.DRIFT}  UNVERIFIABLE=${s.UNVERIFIABLE}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)} MATCH=${totals.MATCH}  DRIFT=${totals.DRIFT}  UNVERIFIABLE=${totals.UNVERIFIABLE}`);
  console.log(`\nReport → ${OUT}`);
  if (leaks) console.log(`⚠ report contains ${leaks} NaN/undefined token(s) — inspect.`);
  if (errs.length) { console.log(`\n⚠ ${errs.length} runner error(s):`); errs.forEach((e) => console.log("  " + e.split("\n")[0])); }
}

run();
