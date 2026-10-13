#!/usr/bin/env node
// 练习答疑窗口（阅读选择题）离线评估。计划见 docs/rag-qa-implementation-plan.md §2。
//
// 测的是「追问 prompt 在 DeepSeek 上守不守规矩」：出处有效率、引文核实率、超纲拒答率、
// 语法误拒率、空回复率、疑似翻案。题目来自真题库，固定随机种子抽 24 道（AP 16 + RDL 8），
// 每道模拟一次错答、问 4 个问题 → 96 次调用。
//
// 用法：
//   node scripts/qa/eval-reading-qa.mjs                 # 默认 dry-run：只打印「将调用 N 次 / 预计 ¥X」
//   node scripts/qa/eval-reading-qa.mjs --run --yes     # 真跑（需要 .env.local 里的 DEEPSEEK_API_KEY）
// 选项：--seed 20261012  --limit 24（只跑前 N 道题）  --tokens-mult 2（max_tokens = 2000 × N）
//       --max-calls 200（超过要 --yes）  --concurrency 4
//       --judge  每条带原文出处的回答再调一次 DeepSeek，逐条判「引的句子能不能推出前面那句话」
//                （出处支撑率；出处有效率只核句号存在、引文一字不差，核不了这个）。调用次数约翻倍。
// 开头那条 MODULE_TYPELESS_PACKAGE_JSON 警告无害（lib/ 是无 "type" 包里的 ESM 源码）。
// 结果写到 .ops/qa-eval/<日期>.json 和同名 .md 摘要。调用走 lib/ai/deepseekHttp，自动记台账。
import { register, createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
register(pathToFileURL(join(__dirname, "_extless-loader.mjs")));
const require = createRequire(import.meta.url);

const qa = await import(pathToFileURL(join(ROOT, "lib", "qa", "questionQa.js")).href);
const { isSentenceSelection } = await import(pathToFileURL(join(ROOT, "lib", "reading", "sentenceSelection.js")).href);
const { QA_SYSTEM, buildEvidence, buildQaMessage, parseAnswer, citationStats, citationClaims, presetText, plainText } = qa;

// 模型直接取线上 /api/ai 用的那个，线上换模型时评估跟着换，不会静默测旧模型。
const { DEFAULT_MODEL: MODEL } = await import(pathToFileURL(join(ROOT, "lib", "ai", "upstream.js")).href);
// token 预算同理，取线上追问用的共享常量（追问 = AI_HELPER_MAX_TOKENS × --tokens-mult，默认 ×2）。
const { AI_HELPER_MAX_TOKENS } = await import(pathToFileURL(join(ROOT, "lib", "ai", "client.js")).href);

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
// 先读 .env.local 再算单价：DEEPSEEK_CNY_PER_MTOK 只写在 .env.local 时，dry-run 的报价也要用它。
loadEnv();
const CNY_PER_MTOK = Number(process.env.DEEPSEEK_CNY_PER_MTOK) || 5.24;

/* ── 参数 ─────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const RUN = flag("run");
const YES = flag("yes");
const SEED = Number(opt("seed", 20261012));
const LIMIT = Number(opt("limit", 24));
const TOKENS_MULT = Number(opt("tokens-mult", 2));
const MAX_CALLS = Number(opt("max-calls", 200));
const CONCURRENCY = Number(opt("concurrency", 4));
const JUDGE = flag("judge");

/* ── 抽样 ─────────────────────────────────────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const loadBank = (name) => JSON.parse(readFileSync(join(ROOT, "data", "realBank", "reading", name), "utf-8")).items;
const flat = (items, subtype) =>
  items.flatMap((it) =>
    (it.questions || []).map((q, i) => ({
      subtype,
      itemId: it.id,
      qIndex: i,
      q,
      passage: subtype === "ap" ? it.passage : it.text || it.passage,
      paragraphs: subtype === "ap" ? it.paragraphs : undefined,
    }))
  ).filter((x) => x.q?.stem && x.q?.options && x.q?.correct_answer && x.passage);

const ap = flat(loadBank("ap.json"), "ap");
const rdl = flat(loadBank("rdl.json"), "rdl");
const take = (pool, n, pred = () => true, used = new Set()) => {
  const out = [];
  for (const x of shuffle(pool)) {
    if (out.length >= n) break;
    const k = `${x.itemId}#${x.qIndex}`;
    if (used.has(k) || !pred(x)) continue;
    used.add(k);
    out.push(x);
  }
  return out;
};
const used = new Set();
const sample = [
  ...take(ap, 2, (x) => x.q.question_type === "sentence_selection", used),
  ...take(ap, 2, (x) => x.q.question_type === "insert_text", used),
  ...take(ap, 12, (x) => !["sentence_selection", "insert_text"].includes(x.q.question_type), used),
  ...take(rdl, 8, () => true, used),
].slice(0, LIMIT);

/* ── 每道题的 4 个问法 ─────────────────────────────────── */
const FIRST_EXPLAIN = "（评估占位）第一轮讲解：正确答案在原文中有直接依据，学生所选选项与原文表述不符。";

function wrongKey(q) {
  const keys = Object.keys(q.options).filter((k) => k !== q.correct_answer);
  return keys[Math.floor(rand() * keys.length)];
}

function buildCases(x) {
  const selected = wrongKey(x.q);
  const detail = {
    qid: `${x.itemId}-q${x.qIndex}`,
    stem: x.q.stem,
    question: x.q,
    options: x.q.options,
    selected,
    correct: x.q.correct_answer,
    passage: x.passage,
    paragraphs: x.paragraphs,
    subtype: x.subtype,
    isCorrect: false,
  };
  const evidence = buildEvidence(detail);
  const longest = evidence.sentences.slice().sort((a, b) => b.text.length - a.text.length)[0];
  // 真题里有一批选句题被拍成了 A–D 普通选项（isSentenceSelection 判为普通选择题），那批照选项键写。
  const optText = isSentenceSelection(x.q) ? "那一句" : `${selected}`;
  const cases = [
    { kind: "parse-key", question: presetText("parse-key") },
    { kind: "my-thinking", question: `${presetText("my-thinking", { selectedLabel: optText })}我觉得这个选项里的说法原文里也提到了，看起来意思差不多。` },
    { kind: "grammar", question: "这句的主干是什么？后面那部分修饰的是谁？", selection: longest ? { kind: "sentence", text: longest.text, sentenceId: longest.id } : null },
    { kind: "out-of-scope", question: "这篇文章的作者是谁？最早发表在哪里？" },
  ];
  return cases.map((c) => ({
    ...c,
    detail,
    evidence,
    message: buildQaMessage({ evidence: evidence.text, firstExplain: FIRST_EXPLAIN, question: c.question, selection: c.selection || null }),
  }));
}

const cases = sample.flatMap((x) => buildCases(x).map((c) => ({ ...c, itemId: x.itemId, qIndex: x.qIndex, subtype: x.subtype, qtype: x.q.question_type })));

/* ── dry-run 预估 ─────────────────────────────────────── */
// 粗估 token：中文按 1 字 ≈ 0.7 token，其余按 4 字符 ≈ 1 token；输出含推理按 1500 计。
const estTokens = (s) => {
  const cjk = (String(s).match(/[一-鿿]/g) || []).length;
  return Math.round(cjk * 0.7 + (String(s).length - cjk) / 4);
};
const inTok = cases.reduce((n, c) => n + estTokens(QA_SYSTEM) + estTokens(c.message), 0);
const outTok = cases.length * 1500;
// 评审调用：只发「结论 + 被引句」配对，输入远小于追问；按每次 ~800 入 / ~600 出估（含推理）。
const judgeCalls = JUDGE ? cases.filter((c) => c.kind !== "out-of-scope").length : 0;
const estCny = ((inTok + outTok + judgeCalls * 1400) / 1e6) * CNY_PER_MTOK;
const totalCalls = cases.length + judgeCalls;
console.log(`抽样：AP ${sample.filter((x) => x.subtype === "ap").length} 道（选句 ${sample.filter((x) => x.q.question_type === "sentence_selection").length}、插入句 ${sample.filter((x) => x.q.question_type === "insert_text").length}），RDL ${sample.filter((x) => x.subtype === "rdl").length} 道；种子 ${SEED}`);
console.log(`将调用 ${totalCalls} 次${JUDGE ? `（追问 ${cases.length} + 评审至多 ${judgeCalls}）` : ""} / 预计输入 ~${inTok} tokens、输出 ~${outTok} tokens / 预计 ¥${estCny.toFixed(2)}（¥${CNY_PER_MTOK}/M）；max_tokens=${AI_HELPER_MAX_TOKENS * TOKENS_MULT}`);
if (flag("show")) console.log(cases.slice(0, 4).concat(cases.filter((c) => c.qtype === "insert_text").slice(0, 1)).map((c) => `---- ${c.itemId} ${c.kind}\n${c.message}`).join("\n\n"));
if (!RUN) {
  console.log("这是 dry-run。确认后加 --run 真跑。");
  process.exit(0);
}
if (totalCalls > MAX_CALLS && !YES) {
  console.error(`调用次数 ${totalCalls} 超过 --max-calls ${MAX_CALLS}，加 --yes 才会跑。`);
  process.exit(1);
}
if (!YES) {
  console.error("真跑要花钱：确认后加 --yes。");
  process.exit(1);
}

/* ── 真跑 ─────────────────────────────────────────────── */
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("缺 DEEPSEEK_API_KEY（.env.local 或环境变量）。");
  process.exit(1);
}
const { callDeepSeekViaCurl } = require(join(ROOT, "lib", "ai", "deepseekHttp.js"));

const REFUSE_RE = /材料里没有/;
const JUDGE_SYSTEM =
  "你是严格的阅读理解评审。下面每一条是一句中文讲解和它引用的英文原文句子。" +
  "逐条判断：只看所给原文句子，能不能直接读出或合理推出这句讲解说的内容。" +
  "讲解若只是在引述、翻译或分析这句原文本身（语法、词义、句意），算支撑。" +
  "讲解里有原文句子推不出的事实、或把原文意思说反、说过头，算不支撑。" +
  '只输出 JSON 数组，例如 [{"i":1,"support":true},{"i":2,"support":false,"why":"原文只说 X，没说 Y"}]，不要别的文字。';

async function judgeClaims(claims) {
  if (!claims.length) return [];
  const body = claims.map((c, k) => `${k + 1}. 讲解：${c.claim}\n   原文：${c.sentences.join(" ")}`).join("\n");
  const raw = await callDeepSeekViaCurl({
    apiKey,
    payload: { model: MODEL, max_tokens: 2000, temperature: 0, messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: body }] },
    timeoutMs: 120000,
    meta: { script: "qa/eval-reading-qa", label: "judge" },
  });
  const m = String(raw || "").match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : [];
  return claims.map((c, k) => {
    const v = arr.find((x) => Number(x?.i) === k + 1);
    return { ...c, support: v ? v.support === true : null, why: v?.why || "" };
  });
}

const OVERTURN_RE = /答案应为|答案应该是|答案有误|答案错了|标准答案不对|正确答案其实/;

async function runOne(c, i) {
  const t0 = Date.now();
  let answer = "";
  let error = null;
  try {
    answer = await callDeepSeekViaCurl({
      apiKey,
      payload: {
        model: MODEL,
        max_tokens: AI_HELPER_MAX_TOKENS * TOKENS_MULT,
        temperature: 0.3,
        messages: [
          { role: "system", content: QA_SYSTEM },
          { role: "user", content: c.message },
        ],
      },
      timeoutMs: 120000,
      meta: { script: "qa/eval-reading-qa", label: c.kind },
    });
  } catch (e) {
    error = String(e?.message || e).slice(0, 300);
  }
  const text = plainText(answer);
  const segs = parseAnswer(text, c.evidence.sentences, c.evidence.materials);
  const stats = citationStats(segs);
  const quotes = segs.filter((s) => s.type === "quote").length;
  let judged = [];
  if (JUDGE && text && c.kind !== "out-of-scope") {
    try {
      judged = await judgeClaims(citationClaims(segs));
    } catch (e) {
      judged = citationClaims(segs).map((x) => ({ ...x, support: null, why: `评审失败：${String(e?.message || e).slice(0, 80)}` }));
    }
  }
  const row = {
    i,
    itemId: c.itemId,
    qIndex: c.qIndex,
    subtype: c.subtype,
    qtype: c.qtype,
    kind: c.kind,
    question: c.question,
    answer: text,
    error,
    ms: Date.now() - t0,
    ...stats,
    quotes,
    sentenceCites: segs.filter((s) => s.type === "cite" && s.kind === "sentence").length,
    validCites: segs.filter((s) => s.type === "cite" && s.valid).length,
    validQuotes: segs.filter((s) => s.type === "quote" && s.valid).length,
    empty: !text,
    // 没有句末标点多半是被 max_tokens 截断
    truncated: !!text && !/[。！？.!?」）)\]】"”]\s*$/.test(text),
    refused: REFUSE_RE.test(text),
    overturn: OVERTURN_RE.test(text),
    badCiteIds: segs.filter((s) => s.type === "cite" && !s.valid).map((s) => s.id),
    badQuoteTexts: segs.filter((s) => s.type === "quote" && !s.valid).map((s) => s.text),
    judged,
  };
  process.stdout.write(`[${i + 1}/${cases.length}] ${c.itemId} ${c.kind} 出处 ${stats.cites}（错 ${stats.badCites}） 引文 ${quotes}（错 ${stats.badQuotes}）${row.empty ? " 空" : ""}${row.error ? ` 错误：${row.error.slice(0, 60)}` : ""}\n`);
  return row;
}

const rows = new Array(cases.length);
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (next < cases.length) {
    const i = next++;
    rows[i] = await runOne(cases[i], i);
  }
}));

/* ── 指标 ─────────────────────────────────────────────── */
const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const cites = sum((r) => r.cites);
const badCites = sum((r) => r.badCites);
const quotes = sum((r) => r.quotes);
const badQuotes = sum((r) => r.badQuotes);
const oos = rows.filter((r) => r.kind === "out-of-scope");
const gram = rows.filter((r) => r.kind === "grammar");
// 覆盖率：聚合比例只看「给了的出处对不对」，一两条合格出处就能撑起 100%；
// 这里再按回答数，要求该讲题的回答大多各自给出出处和引文。只算 prompt 要求标出处的两类：
// 语法分析按规则 3 不用标注，超纲题应拒答，两类都不计。
const CITE_KINDS = new Set(["parse-key", "my-thinking"]);
const inScope = rows.filter((r) => CITE_KINDS.has(r.kind) && !r.empty && !r.error);
const citedRows = inScope.filter((r) => r.validCites > 0).length;
const quotedRows = inScope.filter((r) => r.validQuotes > 0).length;
// 分母为 0（模型一条出处 / 引文都没给）算不过线：完全不守引用规则正是要拦的退化。
const judgedAll = rows.flatMap((r) => r.judged || []).filter((x) => x.support != null);
const metrics = [
  { name: "出处有效率", value: pct(cites - badCites, cites), pass: (v) => v != null && v >= 95, line: "≥ 95%", detail: `${cites - badCites}/${cites}` },
  { name: "引文核实率", value: pct(quotes - badQuotes, quotes), pass: (v) => v != null && v >= 95, line: "≥ 95%", detail: `${quotes - badQuotes}/${quotes}` },
  { name: "出处覆盖率", value: pct(citedRows, inScope.length), pass: (v) => v != null && v >= 80, line: "≥ 80% 的回答带有效出处", detail: `${citedRows}/${inScope.length}` },
  { name: "引文覆盖率", value: pct(quotedRows, inScope.length), pass: (v) => v != null && v >= 50, line: "≥ 50% 的回答带核实过的引文", detail: `${quotedRows}/${inScope.length}` },
  // 带原话的原文出处才核得了内容；比例低说明模型在用光秃秃的 [Sx] 撑「有出处」。
  { name: "出处带原话率", value: pct(sum((r) => r.sentenceCites - r.unbound), sum((r) => r.sentenceCites)), pass: (v) => v != null && v >= 70, line: "≥ 70% 的原文出处前面带英文原话（新指标，首跑后再定线）", detail: `${sum((r) => r.sentenceCites - r.unbound)}/${sum((r) => r.sentenceCites)}` },
  ...(JUDGE ? [{ name: "出处支撑率", value: pct(judgedAll.filter((x) => x.support).length, judgedAll.length), pass: (v) => v != null && v >= 90, line: "≥ 90% 的引句能推出前面那句讲解（评审模型判）", detail: `${judgedAll.filter((x) => x.support).length}/${judgedAll.length}` }] : []),
  { name: "超纲拒答率", value: pct(oos.filter((r) => r.refused).length, oos.length), pass: (v) => v >= 90, line: "≥ 90%", detail: `${oos.filter((r) => r.refused).length}/${oos.length}` },
  { name: "语法误拒率", value: pct(gram.filter((r) => r.refused).length, gram.length), pass: (v) => v <= 5, line: "≤ 5%", detail: `${gram.filter((r) => r.refused).length}/${gram.length}` },
  { name: "空回复/截断率", value: pct(rows.filter((r) => r.empty || r.truncated || r.error).length, rows.length), pass: (v) => v <= 2, line: "≤ 2%", detail: `${rows.filter((r) => r.empty || r.truncated || r.error).length}/${rows.length}` },
  { name: "疑似翻案", value: rows.filter((r) => r.overturn).length, pass: () => true, line: "逐条人工复核，应为 0", detail: "" },
];

const date = new Date().toISOString().slice(0, 10);
const outDir = join(ROOT, ".ops", "qa-eval");
mkdirSync(outDir, { recursive: true });
// 文件名带上影响结果的参数和时刻：同一天换 --limit / --tokens-mult 再跑不会覆盖上一次的结果。
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const base = join(outDir, `${date}-seed${SEED}-n${LIMIT}-x${TOKENS_MULT}-${String(MODEL).replace(/[^\w.-]+/g, "_")}-${stamp}`);
writeFileSync(`${base}.json`, JSON.stringify({ date, seed: SEED, model: MODEL, maxTokens: AI_HELPER_MAX_TOKENS * TOKENS_MULT, metrics: metrics.map(({ pass, ...m }) => ({ ...m, ok: pass(m.value) })), rows }, null, 2));

const md = [
  `# 答疑窗口离线评估 ${date}`,
  "",
  `种子 ${SEED} · ${rows.length} 次调用 · ${MODEL} · max_tokens ${AI_HELPER_MAX_TOKENS * TOKENS_MULT}`,
  "",
  "| 指标 | 结果 | 及格线 | 过线 |",
  "|---|---|---|---|",
  ...metrics.map((m) => `| ${m.name} | ${m.value ?? "—"}${typeof m.value === "number" && m.name !== "疑似翻案" ? "%" : ""} ${m.detail ? `(${m.detail})` : ""} | ${m.line} | ${m.pass(m.value) ? "是" : "否"} |`),
  "",
  "## 需要人工看的",
  "",
  ...rows.filter((r) => (r.judged || []).some((x) => x.support === false) || r.overturn || r.badCites || r.badQuotes || r.empty || r.truncated || r.error || (r.kind === "out-of-scope" && !r.refused) || (r.kind === "grammar" && r.refused))
    .map((r) => `- #${r.i + 1} ${r.itemId} q${r.qIndex} ${r.kind}${r.overturn ? " 【疑似翻案】" : ""}${r.badCiteIds.length ? ` 坏出处 ${r.badCiteIds.join(",")}` : ""}${r.badQuoteTexts.length ? ` 坏引文 ${r.badQuoteTexts.join(" / ").slice(0, 120)}` : ""}${r.error ? ` 错误 ${r.error.slice(0, 80)}` : ""}${r.empty ? " 空回复" : ""}${r.truncated ? " 疑似截断" : ""}${r.kind === "out-of-scope" && !r.refused ? " 超纲未拒答" : ""}${r.kind === "grammar" && r.refused ? " 语法被误拒" : ""}\n  > ${r.answer.replace(/\n/g, " ").slice(0, 300)}${(r.judged || []).filter((x) => x.support === false).map((x) => `\n  - 不支撑 ${x.ids.join(",")}：${x.claim.slice(0, 80)}（${x.why}）`).join("")}`),
];
writeFileSync(`${base}.md`, md.join("\n"));
console.log("\n" + md.slice(4, 6 + metrics.length).join("\n"));
console.log(`\n明细：${base.replace(/\\/g, "/")}.json\n摘要：${base.replace(/\\/g, "/")}.md`);
