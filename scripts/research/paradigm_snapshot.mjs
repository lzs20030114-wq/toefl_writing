/**
 * paradigm_snapshot.mjs — 全科长文本「话语范式」快照器
 *
 * 用同一套检测器同口径测量 生成题库 vs realExam2026 真题,输出各题型的
 * 范式指标(目标维度 + 守护维度)。这是 2026-07 范式修复的验收地基:
 *   1. 改动前跑 --save 存基线;
 *   2. 每个修复 batch 落地后跑 --compare <基线>,目标维度应进带、
 *      其他维度移动超容差(TOLERANCES)即 FAIL,停下审查。
 *
 * 检测器口径说明(与 2026-07-09/10 三科 review 报告同源,重建为可复跑版):
 *   - 所有 rate 均为 0-1 小数;词数按空白分词。
 *   - 启发式分类器(开场形态等)只做守护参考,精度≈0.8-0.9;
 *     正则类(短语黑名单/问号/词数)精度≈1.0,可用于 hard 决策。
 *
 * 用法:
 *   node scripts/research/paradigm_snapshot.mjs                 # 打印全表
 *   node scripts/research/paradigm_snapshot.mjs --save <file>   # 存 JSON 基线
 *   node scripts/research/paradigm_snapshot.mjs --compare <file># 对比基线
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const arr = (d) => d.items || d.sets || d.prompts || d;

const wc = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean);
const sentences = (t) => String(t || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
const lastSentence = (t) => { const s = sentences(t); return s[s.length - 1] || ""; };
const firstSentence = (t) => sentences(t)[0] || "";
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const share = (n, d) => (d ? +(n / d).toFixed(4) : 0);
const r2 = (n) => +(+n).toFixed(2);

// ── 旧世代 cohort 判定 ──────────────────────────────────────────────
const OLD_READING = /routine-2026052[89]|routine-20260530/;
const LC_CUTOFF_MS = Date.parse("2026-06-06T00:00:00Z");
function isOldLC(id) {
  const s = String(id || "");
  // 覆盖 r1 与 r2(retry)两种 id 形态;0601-0605 的夜间批 id 是 base36,由下方分支处理
  if (/routine-(r2-)?2026(0531|060[1-5])/.test(s)) return true;
  if (/^lc_rt_/.test(s)) return true;
  const m = s.match(/^lc_(m[0-9a-z]{6,})_/);
  if (m) { const ts = parseInt(m[1], 36); if (ts && ts < LC_CUTOFF_MS) return true; }
  return false;
}

// ── 各题型指标(gen/real 共用同一函数,输入统一归一化) ────────────

// Speaking · Repeat — 守护维度(2026-07-09 已修复,防回潮)
function repeatMetrics(sets) {
  const all = sets.flatMap((s) => s.texts);
  const n = all.length;
  const tier = (t) => (wc(t) <= 7 ? "e" : wc(t) <= 12 ? "m" : "h");
  let sig232 = 0, lastLongest = 0, wayfind = 0;
  for (const s of sets) {
    const c = { e: 0, m: 0, h: 0 };
    s.texts.forEach((t) => c[tier(t)]++);
    if (c.e === 2 && c.m === 3 && c.h === 2) sig232++;
    const ws = s.texts.map(wc);
    if (ws[ws.length - 1] === Math.max(...ws)) lastLongest++;
    if (/\b(map|schedule|guide|directory|floor plan|catalog)\b/i.test(s.texts[s.texts.length - 1] || "")) wayfind++;
  }
  return {
    sets: sets.length,
    question_rate: share(all.filter((t) => /\?/.test(t)).length, n),
    punitive_rate: share(all.filter((t) => /(will result in|suspension of|incur a|penalt|violation)/i.test(t)).length, n),
    welcome_opener_rate: share(sets.filter((s) => /^(welcome|let'?s)/i.test(s.texts[0] || "")).length, sets.length),
    mean_words: r2(mean(all.map(wc))),
    max_words: Math.max(...all.map(wc)),
    you_rate: share(all.filter((t) => /\byou(r)?\b/i.test(t)).length, n),
    sig232_share: share(sig232, sets.length),
    last_longest_share: share(lastLongest, sets.length),
    wayfind_close_share: share(wayfind, sets.length),
  };
}

// Reading · AP — 目标:末句 However 坍缩;守护:长度/段落/选项
function apMetrics(items) {
  const passages = items.map((i) => i.passage || "");
  const lasts = passages.map(lastSentence);
  const spreads = [];
  let qTotal = 0, insertQ = 0, paraRelQ = 0;
  for (const it of items) {
    for (const q of it.questions || []) {
      qTotal++;
      if (q.question_type === "insert_text") insertQ++;
      if (q.question_type === "paragraph_relationship") paraRelQ++;
      const opts = q.options ? Object.values(q.options) : [];
      if (opts.length >= 3) { const ws = opts.map(wc); spreads.push(Math.max(...ws) - Math.min(...ws)); }
    }
  }
  return {
    n: items.length,
    mean_words: r2(mean(passages.map(wc))),
    last_sent_however_rate: share(lasts.filter((t) => /\bhowever\b/i.test(t)).length, items.length),
    last_sent_limitation_rate: share(lasts.filter((t) => /\b(however|despite|challenge|remain(s)? (unsolved|unclear|unknown)|yet to)\b/i.test(t)).length, items.length),
    opener_copula_rate: share(passages.filter((p) => /^[A-Z][A-Za-z' -]*\s+(is|are)\s+(a|an|the|one)\b/.test(firstSentence(p))).length, items.length),
    // 仅在带结构化 paragraphs 字段的条目上统计(真题 OCR 无段落结构 → null)
    para3_share: (() => { const wp = items.filter((i) => Array.isArray(i.paragraphs)); return wp.length ? share(wp.filter((i) => i.paragraphs.length === 3).length, wp.length) : null; })(),
    option_spread_mean: r2(mean(spreads)),
    insert_text_qshare: share(insertQ, qTotal),
    paragraph_rel_qshare: share(paraRelQ, qTotal),
    old_cohort: items.filter((i) => OLD_READING.test(i.id || "")).length,
  };
}

// Reading · CTW — 目标:首句 richness(真题侧只有首句可靠);守护:词数/blank
function ctwMetrics(items, { blankReliable = true } = {}) {
  const firsts = items.map((i) => i.first_sentence || firstSentence(i.passage || i.paragraph || ""));
  const fWords = firsts.map(words);
  const blanks = blankReliable
    ? items.flatMap((i) => (i.blanks || []).map((b) => (typeof b === "string" ? b : b.original_word || b.word || b.answer || "")))
    : [];
  return {
    n: items.length,
    mean_words: blankReliable ? r2(mean(items.map((i) => wc(i.passage || "")))) : null,
    first_sentence_words: r2(mean(fWords.map((w) => w.length))),
    first_sentence_avg_wlen: r2(mean(fWords.flat().map((w) => w.replace(/[^A-Za-z]/g, "").length).filter(Boolean))),
    first_sentence_longword_share: share(fWords.flat().filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 7).length, fWords.flat().length),
    blank_len_mean: blankReliable ? r2(mean(blanks.map((b) => b.length))) : null,
    blank_ge8_share: blankReliable ? share(blanks.filter((b) => b.length >= 8).length, blanks.length) : null,
    old_cohort: items.filter((i) => OLD_READING.test(i.id || "")).length,
  };
}

// Reading · RDL(无真题锚,内部单一化守护)
function rdlMetrics(items) {
  const stems = items.flatMap((i) => (i.questions || []).map((q) => (q.stem || "").toLowerCase().trim()));
  const prefix5 = stems.map((s) => words(s).slice(0, 5).join(" "));
  const top = {};
  prefix5.forEach((p) => (top[p] = (top[p] || 0) + 1));
  const topShare = stems.length ? Math.max(...Object.values(top)) / stems.length : 0;
  const opener4 = items.map((i) => words((i.text || "").toLowerCase()).slice(0, 4).join(" "));
  return {
    n: items.length,
    stem_infer_share: share(stems.filter((s) => /^what can be inferred/.test(s)).length, stems.length),
    stem_top_prefix_share: r2(topShare),
    opener4_distinct_ratio: r2(new Set(opener4).size / (items.length || 1)),
    old_cohort: items.filter((i) => OLD_READING.test(i.id || "")).length,
  };
}

// Listening · LC — 目标:开场形态;守护:词数/轮次
function lcMetrics(items) {
  const convs = items.map((i) => i.conversation || []);
  const allWords = convs.map((c) => wc(c.map((t) => t.text).join(" ")));
  const firstTurns = convs.map((c) => c[0]?.text || "");
  return {
    n: items.length,
    median_words: median(allWords),
    // 真题多数对话 OCR 存成单块(length=1),只在多轮条目上统计轮次才可比
    median_turns: median(convs.filter((c) => c.length >= 2).map((c) => c.length)),
    long_share_gt110: share(allWords.filter((w) => w > 110).length, items.length),
    greeting_opener_rate: share(firstTurns.filter((t) => /^(hi|hey|hello)\b/i.test(t)).length, items.length),
    peer_topic_opener_rate: share(firstTurns.filter((t) => /^(have you (heard|seen|checked|tried)|did you (hear|see|know|catch))/i.test(t)).length, items.length),
    named_speaker_count: items.filter((i) => (i.speakers || []).some((s) => s.name && !/^(man|woman)$/i.test(s.name))).length,
    old_cohort: items.filter((i) => isOldLC(i.id)).length,
  };
}

// Listening · LA — 目标:开场形态 + 定式短语;守护:长度/口语度
const LA_STOCK = [
  ["reminder_that", /this is a (friendly )?reminder that/i],
  ["light_refreshments", /light refreshments/i],
  ["pleased_to_announce", /i'?m pleased to announce/i],
  ["excited_to", /we'?re (excited|thrilled) to/i],
];
function stripSettingLead(t) {
  const f = firstSentence(t);
  if (/^(listen to|you will hear)\b/i.test(f) || /in (a|an) [a-z ]+ class\.?$/i.test(f)) {
    return t.slice(t.indexOf(f) + f.length).trim() || t;
  }
  return t;
}
function laMetrics(items) {
  const texts = items.map((i) => stripSettingLead(i.announcement || i.transcript || ""));
  const firsts = texts.map(firstSentence);
  const isSalutation = (f) => /^(attention|good (morning|afternoon|evening)|hello|hi\b|greetings|welcome)/i.test(f);
  const out = {
    n: items.length,
    median_words: median(texts.map(wc)),
    salutation_opener_rate: share(firsts.filter(isSalutation).length, items.length),
    direct_opener_rate: share(firsts.filter((f) => !isSalutation(f) && !/^this is a (friendly )?reminder/i.test(f)).length, items.length),
    contractions_per_100w: r2(texts.reduce((a, t) => a + (t.match(/\b\w+'(s|re|ll|ve|d|t|m)\b/gi) || []).length, 0) / (texts.reduce((a, t) => a + wc(t), 0) / 100)),
  };
  for (const [name, re] of LA_STOCK) out[`stock_${name}`] = texts.filter((t) => re.test(t)).length;
  return out;
}

// Listening · LAT — 守护为主(最健康);目标:you-address / recap 亚型
function latMetrics(items) {
  const texts = items.map((i) => stripSettingLead(i.transcript || ""));
  const firsts = texts.map(firstSentence);
  return {
    n: items.length,
    median_words: median(texts.map(wc)),
    you_address_opener_rate: share(firsts.filter((f) => /\b(you|your|we)\b/i.test(f)).length, items.length),
    recap_opener_rate: share(firsts.filter((f) => /^(last (week|time|class)|we'?ve been (talking|discussing|looking)|previously|so far we)/i.test(f)).length, items.length),
    rhetorical_q_opener_rate: share(texts.filter((t) => sentences(t).slice(0, 2).some((s) => s.includes("?"))).length, items.length),
  };
}

// Writing · Discussion — 目标:学生开头公式/名字池/课程;守护:教授帖
const AD_FOUR_POOL = new Set(["Claire", "Andrew", "Paul", "Kelly"]);
function adMetrics(items) {
  const profName = (i) => (typeof i.professor === "string" ? i.professor : i.professor?.name) || "";
  const profText = (i) => (typeof i.professor === "object" ? i.professor?.text : "") || "";
  const profQ = (i) => i.professor_question || profText(i);
  const students = items.flatMap((i) => i.students || []);
  const s1 = items.map((i) => (i.students?.[0]?.text || ""));
  const s2 = items.map((i) => (i.students?.[1]?.text || ""));
  const names = students.map((s) => s.name).filter(Boolean);
  const profTexts = items.map(profText).filter(Boolean);
  return {
    n: items.length,
    prof_dr_share: share(items.filter((i) => /^dr\.?\s/i.test(profName(i))).length, items.length),
    prof_literal_professor: items.filter((i) => profName(i) === "Professor").length,
    prof_words_mean: profTexts.length ? r2(mean(profTexts.map(wc))) : null,
    why_end_share: share(items.filter((i) => /why\?\s*$/i.test(profQ(i).trim())).length, items.length),
    s1_ibelieve_share: share(s1.filter((t) => /^i (believe|think)\b/i.test(t.trim())).length, items.length),
    s2_inmyopinion_share: share(s2.filter((t) => /^in my (opinion|view)\b/i.test(t.trim())).length, items.length),
    skeptic_opener_share: share(students.filter((s) => /^(i'?m (skeptical|not convinced)|i see the point)/i.test((s.text || "").trim())).length, students.length),
    distinct_student_names: new Set(names).size,
    four_pool_share: share(names.filter((n) => AD_FOUR_POOL.has(n)).length, names.length),
    marine_biology_count: items.filter((i) => /marine/i.test(i.course || "")).length,
  };
}

// Writing · Email — 目标:开头四式/动词/主题行;守护:收件人/长度
const EMAIL_VERBS = ["describe", "explain", "ask", "suggest", "request", "inquire", "tell", "propose", "recommend"];
function emailMetrics(items) {
  const scen = items.map((i) => (i.scenario || "").trim());
  const subj = items.map((i) => i.subject || "");
  const recips = items.map((i) => i.to || i.recipient || "");
  const bulletLists = items.map((i) => i.goals || i.bullets || []);
  const verbOf = (b) => (words(String(b).toLowerCase().replace(/^[-•\s]+/, ""))[0] || "");
  const allVerbs = bulletLists.flat().map(verbOf);
  const vshare = {};
  for (const v of EMAIL_VERBS) vshare[`verb_${v}`] = share(allVerbs.filter((x) => x === v).length, allVerbs.length);
  const openClass = (s) =>
    /^you are\b/i.test(s) ? "you_are" :
    /^you (have )?recently\b|^you recently\b/i.test(s) ? "you_recently" :
    /^you and your\b/i.test(s) ? "you_and_your" :
    /^your\b/i.test(s) ? "your" :
    /^you\b/i.test(s) ? "you_other_verb" : "third_person";
  const classes = scen.map(openClass);
  const cshare = {};
  for (const c of ["you_are", "you_recently", "your", "you_and_your", "you_other_verb", "third_person"]) {
    cshare[`opener_${c}`] = share(classes.filter((x) => x === c).length, items.length);
  }
  return {
    n: items.length,
    subject_words_mean: r2(mean(subj.filter(Boolean).map(wc))),
    subject_ge8_count: subj.filter((s) => wc(s) >= 8).length,
    ...cshare,
    ...vshare,
    verbs_all_distinct_share: share(bulletLists.filter((b) => b.length >= 3 && new Set(b.map(verbOf)).size === b.length).length, bulletLists.filter((b) => b.length >= 3).length),
    recipient_title_share: share(recips.filter((r) => /^(mr|ms|mrs|dr|prof(essor)?)\.?\s+[A-Z]/i.test(r)).length, items.length),
    recipient_bad_count: recips.filter((r) => r && !/^(mr|ms|mrs|dr|prof(essor)?)\.?\s+[A-Z]/i.test(r) && !/^[A-Z][a-z]+$/.test(r)).length,
    scenario_words_mean: r2(mean(scen.map(wc))),
  };
}

// ── 装配:每个题型 gen/real 的加载 + 归一化 ──────────────────────────
const SUITES = [
  {
    key: "speaking_repeat", fn: repeatMetrics,
    gen: () => arr(J("data/speaking/bank/repeat.json")).map((it) => ({ texts: (it.sentences || []).map((s) => s.sentence) })),
    real: () => arr(J("data/realExam2026/speaking/repeat.json")).map((it) => ({ texts: (it.sentences || []).map((s) => s.text) })),
  },
  {
    key: "reading_ap", fn: apMetrics,
    gen: () => arr(J("data/reading/bank/ap.json")),
    real: () => arr(J("data/realExam2026/reading/academicPassage.json")),
  },
  {
    key: "reading_ctw",
    gen: () => arr(J("data/reading/bank/ctw.json")),
    real: () => arr(J("data/realExam2026/reading/completeTheWords.json")),
    fn: ctwMetrics,
    realOpts: { blankReliable: false }, // 真题 paragraph 是挖空版,只有首句可靠
  },
  { key: "reading_rdl_short", fn: rdlMetrics, gen: () => arr(J("data/reading/bank/rdl-short.json")), real: null },
  { key: "reading_rdl_long", fn: rdlMetrics, gen: () => arr(J("data/reading/bank/rdl-long.json")), real: null },
  {
    key: "listening_lc", fn: lcMetrics,
    gen: () => arr(J("data/listening/bank/lc.json")),
    real: () => arr(J("data/realExam2026/listening/conversations.json")),
  },
  {
    key: "listening_la", fn: laMetrics,
    gen: () => arr(J("data/listening/bank/la.json")),
    real: () => arr(J("data/realExam2026/listening/announcements.json")),
  },
  {
    key: "listening_lat", fn: latMetrics,
    gen: () => arr(J("data/listening/bank/lat.json")),
    real: () => arr(J("data/realExam2026/listening/lectures.json")),
  },
  {
    key: "writing_ad", fn: adMetrics,
    gen: () => arr(J("data/academicWriting/prompts.json")),
    real: () => arr(J("data/realExam2026/writing/academicDiscussion.json")),
  },
  {
    key: "writing_email", fn: emailMetrics,
    gen: () => arr(J("data/emailWriting/prompts.json")),
    real: () => arr(J("data/realExam2026/writing/email.json")),
  },
];

// 守护容差(--compare 时 gen 侧非目标维度的允许漂移,绝对值)。
// 目标维度本来就要动,对比时人工判读;这里只兜底"别的维度不许悄悄跑"。
const TOLERANCES = {
  default_rate: 0.06,      // 各类 share/rate
  default_scalar: 0.12,    // 相对漂移 12%(词数均值/中位等标量)
  count_free: true,        // *_count / n / old_cohort 不设自动判定
};

function computeAll() {
  const out = {};
  for (const s of SUITES) {
    out[s.key] = { gen: s.fn(s.gen()) };
    if (s.real) out[s.key].real = s.fn(s.real(), s.realOpts || {});
  }
  return out;
}

function printTable(snap) {
  for (const [key, { gen, real }] of Object.entries(snap)) {
    console.log(`\n══ ${key} ══`);
    const names = Object.keys(gen);
    for (const m of names) {
      const g = gen[m], r = real?.[m];
      console.log(`  ${m.padEnd(32)} gen ${String(g).padEnd(10)}${r !== undefined && r !== null ? ` real ${r}` : ""}`);
    }
  }
}

function compare(snap, baseline) {
  let fails = 0;
  for (const [key, cur] of Object.entries(snap)) {
    const base = baseline[key];
    if (!base) continue;
    for (const [m, v] of Object.entries(cur.gen)) {
      const b = base.gen?.[m];
      if (b === undefined || b === null || v === null) continue;
      if (/(^n$|_count$|old_cohort|_ge8_count|distinct_student_names|max_words|^sets$)/.test(m)) continue;
      const isRate = /(_rate|_share)$/.test(m);
      const delta = Math.abs(v - b);
      const tol = isRate ? TOLERANCES.default_rate : Math.abs(b) * TOLERANCES.default_scalar;
      if (delta > tol) {
        fails++;
        console.log(`  ⚠ ${key}.${m}: ${b} → ${v} (Δ${r2(delta)} > tol ${r2(tol)})`);
      }
    }
  }
  console.log(fails ? `\n${fails} 个维度漂移超容差 — 逐条判读:目标维度=预期,其他=退化嫌疑` : "\n✓ 全部维度在容差带内");
  return fails;
}

const argv = process.argv.slice(2);
const snap = computeAll();
if (argv[0] === "--save") {
  const file = argv[1] || `scripts/research/baselines/paradigm-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify({ saved_at: new Date().toISOString(), snapshot: snap }, null, 2));
  console.log("baseline saved:", file);
  printTable(snap);
} else if (argv[0] === "--compare") {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, argv[1]), "utf8")).snapshot;
  printTable(snap);
  console.log("\n── 对比基线:", argv[1], "──");
  process.exitCode = compare(snap, baseline) ? 0 : 0; // 判定交人工,不阻塞脚本
} else {
  printTable(snap);
}
