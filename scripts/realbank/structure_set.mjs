#!/usr/bin/env node
/**
 * 真题录入 —— 语义结构化阶段（第二半）。
 *
 * 输入：.codex-tmp/realbank/<套名>.json（ingest_set.py 的确定性产物，题干已配上答案）
 * 输出：.codex-tmp/realbank/<套名>.structured.json
 *
 * 铁律：**LLM 只转写，绝不解题**。
 *   正确答案来自答案 PDF，由代码盖章（stampAnswer），不进 prompt、不让模型产出。
 *   模型唯一的任务是把左右分栏交错的 OCR 汤理成结构化字段，并**原样保留选项顺序**
 *   —— 答案 key 给的是「第几个选项」，顺序一乱答案就错位，所以顺序是硬约束，
 *   落库前用 verifyItem 逐条查。
 *
 * 两类题走两条完全不同的路：
 *   零 token 路：repeat（复述句）与 build（造句目标句）—— 答案 PDF 里就是句子本身，
 *                根本不需要模型。
 *   转写路：CTW 与各类选择题 —— 需要模型理分栏，但产出全部可机器校验。
 *
 * 用法：
 *   node scripts/realbank/structure_set.mjs "3.10新托福真题"
 *   node scripts/realbank/structure_set.mjs "3.10新托福真题" --limit 6   # 先试跑几块
 *   node scripts/realbank/structure_set.mjs "3.10新托福真题" --dry       # 只出类型路由表，不调 API
 *   node scripts/realbank/structure_set.mjs "3.10新托福真题" --force     # 越过防覆盖守卫强行落盘
 *
 * 退出码：0 正常；2 用法/输入缺失；3 系统性 API 失败或拒绝覆盖既有产物（run_pipeline 见 3 即整批停）。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../../lib/ai/deepseekHttp");
// CTW 逐空校验抽成纯函数（可单测）：./ctw_verify.js —— 那里写着「答案页只给后半截」为什么能收。
const { verifyCtw } = require("./ctw_verify.js");
// 就地修补（--merge / --only-failed / --reverify-ctw）写回时统一走这里：同步第一来源的 rw 阅读基线。
const { writeStructured } = require("./structured_io.js");
// 调用预算（按题型给，超时从预算推导）+ 宽松 JSON 解析 + 解析失败文案，抽成纯函数可单测：./model_output.js ——
// 那里写着「无法解析为 JSON」的真因（推理 token 吃光 max_tokens，正文为空或被截断），
// 以及为什么 2026-09-14 把这条预算从只给 CTW 放开到全部题型。
const { callBudget, retryBudget, parseJsonLoose, unparsableProblem, isBudgetProblem, ctwVisionCacheFile }
  = require("./model_output.js");
// 失败分级（硬失败整卷作废 / 单块超时只记这一块）：./failure_policy.js
const { classifySystemicFailure, escalate, shouldResweep, isMergeOwned, reverifyStructure }
  = require("./failure_policy.js");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const MODEL = "deepseek-v4-flash";
// 专用退出码：3 = 系统性 API 失败 / 拒绝覆盖既有产物。
// 与 2（用法或输入缺失）和 1（未捕获异常）区分开，run_pipeline.mjs 见到 3 就整批停下。
const EXIT_SYSTEMIC = 3;
// 并发。单套卷 73 块在 4 并发下要十几分钟，全库 54 套按那个速度是几个小时。
// DeepSeek 侧扛得住，瓶颈在等待不在算力，所以拉到 10；--concurrency 可覆盖。
const CONCURRENCY = Number(process.env.REALBANK_CONCURRENCY || 10);

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(process.cwd(), p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 没有 .env 就靠进程环境变量 */ }
  }
}

/* ── 1. 类型路由（确定性，看 OCR 正文里的官方指令语） ───────────────────── */
// 真题每道题上方都有 ETS 的固定指令句，比任何启发式都可靠。
const ROUTES = [
  [/fill\s*in\s*the\s*missing\s*letters/i, "ctw"],
  [/listen\s*and\s*repeat/i, "repeat"],
  [/choose\s*the\s*best\s*response/i, "lcr"],
  [/listen\s*to\s*a\s*conversation/i, "lc"],
  [/listen\s*to\s*an?\s*announcement/i, "la"],
  [/listen\s*to\s*an?\s*(academic\s*)?(talk|lecture|discussion)/i, "lat"],
];

function routeType(block) {
  const body = block.body || "";
  for (const [re, type] of ROUTES) if (re.test(body)) return type;
  if (block.section === "writing") return "build";
  if (block.section === "listening") return "listening_mcq"; // 归属段落在音频里，稍后按音频分段并回
  if (block.section === "reading") {
    // 学术短文 vs 日常阅读：真题里日常阅读的材料是海报/说明/网页，普遍短且带
    // "Read a poster / Read some instructions" 这类指令；学术短文明显更长。
    if (/read\s+(a|an|some)\s+(poster|instructions?|notice|advertisement|web\s*page|page\s*from|email|menu|schedule|flyer|message)/i.test(body)) return "rdl";
    return countWords(body) >= 160 ? "ap" : "rdl";
  }
  if (block.section === "speaking") return "interview"; // 题干在音频里
  return "unknown";
}

const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/* ── 2. 转写 prompt（每类一套，全部禁止解题） ───────────────────────────── */
const NO_SOLVE = `绝对禁止：不要解题、不要判断哪个选项正确、不要输出 answer 字段。正确答案由调用方从官方答案页注入。
输出必须是**纯 JSON**，不带 markdown 代码围栏、不带任何解释文字。`;

const OCR_NOTE = `输入是对考试截图做 OCR 得到的文本，有三种典型噪声，请在转写时修掉：
- 单词粘连、空格丢失（"Ith_ two whe" / "andapl tos"）；
- 左右分栏交错：屏幕左边是材料、右边是题干与选项，OCR 会把两栏的行交替吐出来；
- 页眉残留（"Hide Time"、倒计时、"Question 21 of 35"）与卖家水印，一律丢弃。
只转写你在文本里真实看到的内容，看不到就留空，**不要补写、不要润色、不要翻译**。`;

// 答案页有时只给要填的后半截（13 套第一来源卷如此，见 ctw_verify.js）。提示里说的是「完整词列表」，
// 列表里却混着 "le" 这种残片，模型要在两者之间自己圆 —— 这 13 套里 17 块真填词在旧提示下没吐出合法 JSON。
const CTW_ANSWER_NOTE = "注意：答案页有时只给出被砍掉的**后半截**字母（例如列表写 le、OCR 里残留 ma → 这个空的 word 是 male、given 是 ma）。"
  + "遇到这种条目，word 一律写**完整词**，given 写屏幕上残留的前缀，blanks 的个数与顺序仍与列表一一对应。";

const PROMPTS = {
  mcq: `你是 TOEFL 真题转写器。${OCR_NOTE}

把输入整理成一道选择题，返回 JSON 对象：
{
  "material": "屏幕上供阅读的材料原文（海报/说明/网页/图表说明等）。如果这道题的材料在音频里、屏幕上没有材料，填 \\"\\"",
  "material_kind": "poster|instructions|website|email|notice|schedule|advertisement|chart|passage|none",
  "stem": "题干问句",
  "options": ["选项1", "选项2", "选项3", "选项4"]
}
关键约束：
- "options" 必须是**数组**，且**严格按屏幕上从上到下的原始顺序**排列。顺序即答案编号，错一位整题作废。
- 选项文本去掉前面的 A./B./1) 之类编号，保留原文措辞。
- 真题选择题**恒 4 个选项**。只认出 3 个，多半是分栏没理干净、或某一项被 OCR 吃了 ——
  回到输入里再找一遍，漏掉的那项常常混在材料那一栏里。
- **实在找不到第 4 个，就照实只给你看到的那几个，绝对不要自己编一个凑满 4 个。**
  编出来的假选项会当成真题上线，比这道题作废严重得多；不足 4 项的题系统会标记后另行处理。
- **选项经常长得像材料的片段**：材料是一份四步说明书时，四个选项可能就是 "Step 1"…"Step 4"；
  材料是海报时，选项可能是海报里句子的改写。判据是位置——屏幕右栏、紧跟题干、彼此并列且长度相近的
  那一组才是选项，左栏成段的是材料。不要因为"这看起来是材料的一部分"就把选项漏掉。
${NO_SOLVE}`,

  mcq_repair: `你是 TOEFL 真题转写器。${OCR_NOTE}

输入是**连续几道题**的 OCR，而且分栏识别乱了序：某道题的题干、材料、选项可能散落在相邻题的文本里。
请通读全部输入，把指定题号的题各自还原出来。

返回 JSON **数组**，每个元素：
{
  "q_number": 题号（整数，必须是调用方指定的题号之一）,
  "material": "屏幕上供阅读的材料原文；材料在音频里、屏幕没有材料就填 \\"\\"",
  "material_kind": "poster|instructions|website|email|notice|schedule|advertisement|chart|passage|none",
  "stem": "题干问句（听力题常见 \\"Choose the best response.\\" 这类指令语不是题干，题干是真正的问句；
            若这道题除了指令语没有别的问句，stem 就填那句指令语）",
  "options": ["选项1", "选项2", "选项3", "选项4"]
}
关键约束：
- 只返回调用方指定的题号，一个题号一个元素，不要多返也不要少返。
- "options" 严格按屏幕从上到下的原始顺序，顺序即答案编号。
- 一组并列的 4 个短句/短语属于**同一道题**，不要拆到两道题上去。
- 真题选择题恒 4 个选项；只找到 3 个时回头再找一遍（常混在材料栏里），
  **但绝对不要编一个凑数** —— 照实给出看到的那几个即可。
${NO_SOLVE}`,

  ctw: `你是 TOEFL "Complete the Words"（C-test 单词补全）真题还原器。${OCR_NOTE}

这类题给出一段短文，其中若干个词被砍掉后半截，屏幕上只显示前几个字母 + 一段空白。
OCR 会把空白吃掉，于是残缺词看起来像 "h_"、"whe"、"apl"（其实是 "a pl"）。

调用方已经从官方答案页拿到**被挖掉的词的完整列表（按出现顺序）**，见输入末尾。
你的任务是还原原文并标出空位，返回 JSON 对象：
{
  "passage": "把被挖的词补回去之后的完整段落，一段连续正常英文（词间空格补好）",
  "blanks": [ { "word": "被挖的完整词（必须与给定列表逐一对应、顺序一致）", "given": "屏幕上保留的前缀字母" } ],
  "topic": "学科标签，如 biology / history / technology，判断不了写 other"
}
关键约束：
- "blanks" 的长度和顺序必须与给定的答案词列表完全一致。
- "given" 必须是对应 word 的真前缀（例如 word="place" 时 given 可以是 "pl"）。前缀取 OCR 里实际残留的那几个字母。
- "passage" 是**补全后**的完整原文，不要留下划线或空格占位。
${NO_SOLVE}`,
};

/* ── 3. 模型调用 ─────────────────────────────────────────────────────────── */

/*
 * 系统性 API 失败识别 + 软失败升级判据抽成纯函数：./failure_policy.js
 * 那里写着「为什么单块超时不再整卷作废」（一块慢 = 整卷白跑，正好砸在最该救的那些块上）。
 */

// 一旦置位就代表整卷作废：不再派新活、不写产物、以 EXIT_SYSTEMIC 退出。只记第一次。
let systemicFailure = null;
let softFailures = 0;

function noteSystemicFailure(info) {
  if (!systemicFailure) systemicFailure = info;
}

/** 有系统性失败就打印原因并中止；没有则原样返回。 */
function abortIfSystemic() {
  if (!systemicFailure) return;
  const { httpStatus, apiMessage, reason, text } = systemicFailure;
  console.error(`\n[中止] 系统性 API 失败（${reason}）：`
    + `${httpStatus ? `HTTP ${httpStatus}` : "无状态码"}`
    + `${apiMessage ? ` · API 返回「${apiMessage}」` : ""}`);
  console.error(`  原始错误：${text.slice(0, 300)}`);
  console.error(`  已中止本卷，**未写出** .structured.json —— 避免用失败结果覆盖上一次的好产物。`);
  process.exit(EXIT_SYSTEMIC);
}

async function callModel(systemPrompt, userText, budget = callBudget()) {
  // —— 测试钩子，只用于验证守卫，正常运行不会触发 ——
  // REALBANK_FAKE_API_ERROR=402   每次调用都抛该状态码的 API 错误（验证「系统性失败即中止」）
  // REALBANK_FAKE_MODEL_JSON=<json>  每次调用都返回这段 JSON、不发网络请求（验证一代备份）
  if (process.env.REALBANK_FAKE_API_ERROR) {
    throw new Error(`DeepSeek ${process.env.REALBANK_FAKE_API_ERROR}: `
      + `{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}`);
  }
  if (process.env.REALBANK_FAKE_MODEL_JSON) return process.env.REALBANK_FAKE_MODEL_JSON;

  const content = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: budget.timeoutMs,
    payload: {
      model: MODEL,
      temperature: 0,
      // deepseek-v4-flash 是推理模型：max_tokens 含推理 token，预算给小了推理会把正文吃光、返回空串
      // （写作评分那次的同一个坑）。CTW 推理特别长，预算单独放宽，见 model_output.js。
      max_tokens: budget.maxTokens,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    },
  });
  return content;
}

/**
 * 要 JSON 的调用统一走这里：解析不出、且失败签名是「预算形」（正文为空 / 吐到一半被截断）
 * 就**加倍预算重试一次**。
 *
 * 为什么要在这里自愈，而不是记 flagged 等下一次 --only-failed：
 * flagged 块从不进盲审，也就从不进库 —— 一次预算抖动 = 一道真题永久消失，
 * 而「下一次什么时候重跑」全看有没有人想起来。09-13 那轮原地重跑 165 块救回 81 块（≈50%），
 * 救回的正是这一类，本就该在第一次调用里自动做掉。
 * 成本只落在本来就已经失败的块上，而且 max_tokens 是上限不是账单 —— 用不到不花钱。
 *
 * 返回 { raw, obj, budgetRetried }；obj 为 null 表示两次都没解析出来。
 */
async function callForJson(systemPrompt, userText, budget = callBudget()) {
  const first = await callModel(systemPrompt, userText, budget);
  const firstObj = parseJsonLoose(first);
  if (firstObj) return { raw: first, obj: firstObj, budgetRetried: false };
  if (!isBudgetProblem(unparsableProblem(first))) return { raw: first, obj: null, budgetRetried: false };
  const raw = await callModel(systemPrompt, userText, retryBudget(budget));
  return { raw, obj: parseJsonLoose(raw) || null, budgetRetried: true };
}

// parseJsonLoose 见 ./model_output.js（旧两步原样保留，另加按括号配对取第一个完整 JSON 值）。

/* ── 4. 盖答案 + 校验 ────────────────────────────────────────────────────── */
const LETTERS = "abcdefgh";
const CJK = /[一-鿿]/;
const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;

/** 把答案 key 的字母映射成选项下标，并盖到 item 上。返回问题清单（空数组=通过）。 */
function stampAnswer(item, answerLetter) {
  const problems = [];
  const letter = String(answerLetter || "").trim().toLowerCase();
  if (!/^[a-h]$/.test(letter)) {
    problems.push(`答案不是单个字母：${JSON.stringify(answerLetter)}`);
    return problems;
  }
  const idx = LETTERS.indexOf(letter);
  if (!Array.isArray(item.options) || item.options.length < 2) {
    problems.push("选项数组缺失或不足 2 个");
    return problems;
  }
  if (idx >= item.options.length) {
    problems.push(`答案 ${letter} 越界：只转写出 ${item.options.length} 个选项`);
    return problems;
  }
  item.answer_index = idx;
  item.answer_text = item.options[idx];
  return problems;
}

function verifyMcq(item) {
  const p = [];
  if (!item.stem || countWords(item.stem) < 2) p.push("题干缺失或过短");
  if (!Array.isArray(item.options)) p.push("options 不是数组");
  else {
    // 恒 4 个。为什么不是「3~5 都放行」（2026-09-14 改）：落库那一步
    // build_bank.optionsMap 只收恰好 4 个，不是 4 个就整题作废。放行 3 个的后果是这道题
    //   ① 拿到 status=ok → `--only-failed` 判它 already_done，**永远不会重扫**；
    //   ② 却每次重建都被 build_bank 扔掉 —— 不会被重试、也永远进不了库，永久困死；
    //   ③ 中间还白花一笔盲审的钱（audit_answers 只审 status=ok 的块）。
    // 早拒 = 标 flagged = 进重扫名单 + 省下盲审的钱 + 损失当场可见。
    // 实测依据：线上 690 道阅读题 + 773 道听力题，选项数**全部恰好 4 个**（少于 4 的早被扔光了）。
    if (item.options.length !== 4) p.push(`选项数异常：${item.options.length}（真题选择题恒 4 个，多半是分栏没理干净或某项被 OCR 吃了）`);
    if (new Set(item.options.map((o) => String(o).trim().toLowerCase())).size !== item.options.length) {
      p.push("存在重复选项（多半是分栏没理干净）");
    }
    item.options.forEach((o, i) => { if (!String(o || "").trim()) p.push(`第 ${i + 1} 个选项为空`); });
  }
  const blob = [item.stem, item.material, ...(item.options || [])].join(" ");
  if (CJK.test(blob)) p.push("英文字段里混入中文");
  if (WATERMARK.test(blob)) p.push("水印未清干净");
  return p;
}

// verifyCtw 见 ./ctw_verify.js（整词 / 后半截两种答案页写法）。

/* ── 5. 驱动 ─────────────────────────────────────────────────────────────── */
/** 把 alignment 摊平成待处理单元：同一 block 只处理一次，携带它名下所有答案。 */
function collectUnits(scan) {
  const byBlock = new Map();
  for (const [section, a] of Object.entries(scan.alignment)) {
    for (const mod of a.modules || []) {
      for (const m of mod.matched) {
        const b = m.block;
        const key = `${section}|${mod.module}|${b.start}-${b.end}|${b.total}`;
        if (!byBlock.has(key)) {
          byBlock.set(key, {
            key, section, module: mod.module, start: b.start, end: b.end,
            total: b.total, body: b.body, type: routeType({ ...b, section }),
            answers: [],
          });
        }
        byBlock.get(key).answers.push({ n: m.n, answer: m.answer });
      }
    }
  }
  for (const u of byBlock.values()) u.answers.sort((x, y) => x.n - y.n);
  // 按屏幕顺序排好，第二轮修复与材料承接都要靠「相邻」这个关系
  const units = [...byBlock.values()].sort((a, b) =>
    a.section.localeCompare(b.section) || a.module - b.module || a.start - b.start);
  return carryPassages(units);
}

/** 这一块看起来有没有选项：末尾若干行里有 ≥3 条长度相近的并列短行。 */
function hasOptionLines(body) {
  const lines = String(body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-8).filter((l) => { const w = countWords(l); return w >= 1 && w <= 18; });
  return tail.length >= 3;
}

/**
 * 材料承接：合集卷里学术短文独占一屏、题目在后面几屏。
 *
 * 实测 1.21A 的「Q27 块」是 1017 字的短文正文，一个题干一个选项都没有 —— 提取器把它
 * 判成"题干缺失"直接扔掉，后面几道题又因为看不到短文而只能猜。这不是数据坏，是版式
 * 不同（分科卷一屏一题、合集卷一文多屏）。
 *
 * 处理：正文够长又没有选项 = 材料屏。把它记为 carry，往后传给同科同 module 的题块，
 * 直到遇到下一个材料屏。材料屏自身不再作为题目处理。
 */
function carryPassages(units) {
  let carry = null, carryKey = null;
  for (const u of units) {
    if (u.section !== "reading") { carry = null; continue; }
    const key = `${u.section}|${u.module}`;
    if (key !== carryKey) { carry = null; carryKey = key; }
    const long = countWords(u.body) >= 70;
    if (long && !hasOptionLines(u.body)) {
      carry = u.body;
      u.isPassageScreen = true;      // 材料屏：不当题目处理
      continue;
    }
    if (carry && countWords(u.body) < 160) u.carryMaterial = carry;
  }
  return units;
}

const MCQ_TYPES = new Set(["rdl", "ap", "lcr", "lc", "la", "lat", "listening_mcq"]);
// 真 CTW 块恒 10 空；答案不足这个数的「填词块」是路由误判（--only-failed 不为它烧钱）。
const CTW_MIN_ANSWERS = 5;

/**
 * 第二轮：修 OCR 分栏乱序切坏的题块。
 *
 * 不用「body 短于 N 字就合并」这种拍脑袋阈值——直接拿第一轮的**失败信号**当触发器，
 * 把失败块与同科同 module 的左右邻块拼起来重问，并**指名要第几题**。
 * 指名是关键：模型必须给出 q_number，我们只认要的那个，认不出就还是扣下。
 */
async function repairUnit(units, idx) {
  const u = units[idx];
  const near = [];
  for (let j = idx - 1; j <= idx + 1; j++) {
    const v = units[j];
    if (v && v.section === u.section && v.module === u.module) near.push(v);
  }
  const targets = u.answers.map((a) => a.n);
  const body = near.map((v) => `[Q${v.start}${v.end !== v.start ? `-${v.end}` : ""} 区段]\n${v.body}`).join("\n\n");
  const { raw, obj: arr } = await callForJson(PROMPTS.mcq_repair,
    `【OCR 文本（跨 ${near.length} 道题，分栏可能乱序）】\n${body}\n\n【请只还原这些题号】${targets.join(", ")}`,
    callBudget("mcq_repair"));
  if (!Array.isArray(arr)) {
    // 预算病与格式病分开报：报成同一句话，下次排查又得重新抓原始响应。
    const why = arr === null ? unparsableProblem(raw) : "修复轮输出不是 JSON 数组";
    return { repaired: false, problems: [why], items: [] };
  }

  const items = [];
  const problems = [];
  for (const a of u.answers) {
    const hit = arr.find((x) => Number(x?.q_number) === a.n);
    if (!hit) { problems.push(`修复轮没返回第 ${a.n} 题`); continue; }
    const p = [...verifyMcq(hit), ...stampAnswer(hit, a.answer)];
    hit.answer_key = a.answer;
    if (p.length) problems.push(`第 ${a.n} 题仍有问题：${p.join("；")}`);
    else items.push(hit);
  }
  return { repaired: items.length === u.answers.length, problems, items };
}

async function processUnit(u) {
  const base = {
    key: u.key, section: u.section, module: u.module, type: u.type,
    q_start: u.start, q_end: u.end, tier: "recalled",
  };

  // 零 token 路：答案页里就是句子本身
  if (u.type === "repeat" || u.type === "build") {
    const sentences = u.answers.map((a) => ({ n: a.n, sentence: a.answer }));
    const bad = sentences.filter((s) => countWords(s.sentence) < 3 || CJK.test(s.sentence));
    return {
      ...base, source: "answer-key-only", items: sentences,
      status: bad.length ? "flagged" : "ok",
      problems: bad.map((s) => `第 ${s.n} 句不像句子：${s.sentence}`),
    };
  }
  if (u.type === "interview" || u.type === "listening_mcq_audio") {
    return { ...base, status: "deferred", problems: ["题干/材料只在音频里，等 ASR 分段后再处理"], items: [] };
  }

  if (u.type === "ctw") {
    const words = u.answers.map((a) => a.answer);
    // --ctw-vision-body 换过输入的块在产物上记一笔来源（见 main 里的说明）
    const src = u.bodySource ? { body_source: u.bodySource } : {};
    const { raw, obj } = await callForJson(PROMPTS.ctw,
      `【OCR 文本】\n${u.body}\n\n【被挖掉的词（按顺序）】\n${words.map((w, i) => `${i + 1}. ${w}`).join("\n")}\n\n${CTW_ANSWER_NOTE}`,
      callBudget("ctw"));
    if (!obj) return { ...base, ...src, status: "flagged", problems: [unparsableProblem(raw)], items: [] };
    const problems = verifyCtw(obj, words);
    return { ...base, ...src, status: problems.length ? "flagged" : "ok", problems, items: [obj] };
  }

  // 材料屏本身不是题（它的题号只是页眉），交给后面的题块当 carryMaterial 用
  if (u.isPassageScreen) {
    return { ...base, status: "passage_screen", problems: [], items: [], material: u.body };
  }

  // 选择题：一个 block 对应一道题（真题一屏一题）
  const ans = u.answers[0];
  // 按题型取预算（不再一律吃 default）：带 carryMaterial 的块要把整篇材料转写出来，
  // 16000 实证会顶满 —— 顶满即正文空/截断 → flagged → 这道真题永远进不了库。
  const { raw, obj } = await callForJson(PROMPTS.mcq,
    (u.carryMaterial ? `【材料（在前一屏，本题就是问它）】\n${u.carryMaterial}\n\n` : "")
    + `【OCR 文本】\n${u.body}`,
    callBudget(u.type));
  if (!obj) return { ...base, status: "flagged", problems: [unparsableProblem(raw)], items: [] };
  const problems = [...verifyMcq(obj), ...stampAnswer(obj, ans?.answer)];
  obj.q_number = ans?.n;
  obj.answer_key = ans?.answer;
  return { ...base, status: problems.length ? "flagged" : "ok", problems, items: [obj] };
}

async function runPool(units, worker, concurrency) {
  const out = new Array(units.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
    while (cursor < units.length) {
      const i = cursor++;
      try {
        out[i] = await worker(units[i]);
      } catch (e) {
        // 两轮共用这个池，第二轮传进来的不是 unit，所以只取能安全取到的字段
        const u = units[i] || {};
        out[i] = {
          key: u.key, section: u.section, type: u.type, repaired: false,
          status: "error", problems: [formatDeepSeekError ? formatDeepSeekError(e) : String(e)], items: [],
        };
        // 系统性失败（欠费/鉴权/断网…）：把游标推到末尾，不再派新活。
        // 已经在飞的请求让它们自己结束即可，反正结果不会落盘。
        const step = escalate(classifySystemicFailure(e), softFailures);
        softFailures = step.softFailures;
        if (step.abort) { noteSystemicFailure(step.info); cursor = units.length; }
      }
      process.stdout.write(`\r  进度 ${out.filter(Boolean).length}/${units.length}   `);
    }
  });
  await Promise.all(runners);
  process.stdout.write("\n");
  return out;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const setname = args.find((a) => !a.startsWith("--"));
  const dry = args.includes("--dry");
  const force = args.includes("--force");   // 越过防覆盖守卫（只有明确知道自己在干嘛才用）
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : 0;
  // 科目过滤。听力/口语的题面依赖音频、且提取链路尚未达标（盲审约 60%），
  // 一期只放不碰音频的阅读与写作造句 —— 用 --sections reading,writing 显式圈定，
  // 而不是靠"跑了就当能用"。
  const secIdx = args.indexOf("--sections");
  const onlySections = secIdx >= 0
    ? new Set(String(args[secIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  // --types ctw：只处理这些题型的块（与 --sections 同理，显式圈定）。
  const typIdx = args.indexOf("--types");
  const onlyTypes = typIdx >= 0
    ? new Set(String(args[typIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  // 就地修补模式（都要求磁盘上已有 structured.json；写回时同步第一来源的 rw 阅读基线）：
  //   --merge        本次结果按块 key 并回既有产物，只替换本次处理的块，其余原样保留；
  //   --only-failed  隐含 --merge，且只处理既有产物里不是 ok 的块；
  //   --reverify-ctw 不调模型，只拿当前 ctw_verify.js 重判既有 CTW 块（判据更新后零成本回收）。
  // 三者都**不会**拿新结果盖掉既有的 ok 块。
  const onlyFailed = args.includes("--only-failed");
  const merge = onlyFailed || args.includes("--merge");
  const reverifyCtw = args.includes("--reverify-ctw");
  const reverifyMcq = args.includes("--reverify-mcq");
  if (!setname) {
    console.error("用法: node scripts/realbank/structure_set.mjs <卷名> [--dry] [--limit N] [--force]"
      + " [--sections a,b] [--types ctw] [--merge | --only-failed | --reverify-ctw | --reverify-mcq] [--ctw-vision-body]");
    process.exit(2);
  }
  const scanPath = path.join(OUT_DIR, `${setname}.json`);
  if (!fs.existsSync(scanPath)) {
    console.error(`缺少确定性阶段产物: ${scanPath}\n先跑: python scripts/realbank/ingest_set.py "${setname}" --json`);
    process.exit(2);
  }
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  let units = collectUnits(scan);
  if (onlySections) {
    const before = units.length;
    units = units.filter((u) => onlySections.has(u.section));
    console.log(`科目过滤 [${[...onlySections].join(",")}]：${before} → ${units.length} 块`);
  }
  if (onlyTypes) {
    const before = units.length;
    units = units.filter((u) => onlyTypes.has(u.type));
    console.log(`题型过滤 [${[...onlyTypes].join(",")}]：${before} → ${units.length} 块`);
  }
  // --ctw-vision-body：填词块的输入换成 Qwen3-VL 看源截图的逐字转写
  // （scripts/realbank/ctw_vision_transcribe.py 写的缓存 .codex-tmp/ocr/ctwvis__<卷>_M<m>_<起>-<止>__img1.txt）。
  // 2026-09-13 实测：第一来源本地 OCR 常把填词屏整行吃掉，模型为了交出「补全后的完整原文」会把缺的句子编出来
  // （3.30 M1 11-20 丢了开头整句，产物写成「Health innovations such as…」；3.15 M1 1-10 编出
  //  「they were also interested in the process of dancing」）。挖空逐空校验照样过，但正文不是原文。
  // 看图转写的行是全的、挖空词只留露出的前缀 + "_"。没有缓存的块照旧用本地 OCR。只影响输入，不动任何判据。
  if (args.includes("--ctw-vision-body")) {
    const ocrDir = path.join(process.cwd(), ".codex-tmp", "ocr");
    let hit = 0, ctwUnits = 0;
    for (const u of units) {
      if (u.type !== "ctw") continue;
      ctwUnits += 1;
      const p = path.join(ocrDir, ctwVisionCacheFile(setname, u.module, u.start, u.end));
      const text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      if (text.trim()) { u.body = text; u.bodySource = "qwen3-vl"; hit += 1; }
    }
    console.log(`--ctw-vision-body：${ctwUnits} 个填词块里 ${hit} 个改用看图逐字转写当输入，其余照旧用本地 OCR`);
  }
  const outPath = path.join(OUT_DIR, `${setname}.structured.json`);
  const prevPath = path.join(OUT_DIR, `${setname}.structured.prev.json`);
  let existing = null;
  if (merge || reverifyCtw || reverifyMcq) {
    if (!fs.existsSync(outPath)) {
      console.error(`--merge / --only-failed / --reverify-ctw / --reverify-mcq 需要既有产物：${outPath}`);
      process.exit(2);
    }
    existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
  }
  if (reverifyCtw) {
    const byKey = new Map(collectUnits(scan).map((u) => [u.key, u]));
    let healed = 0, still = 0, orphan = 0;
    const results = existing.results.map((r) => {
      if (r.type !== "ctw" || !Array.isArray(r.items) || !r.items.length) return r;
      const u = byKey.get(r.key);
      if (!u) { orphan += 1; return r; }
      const problems = verifyCtw(r.items[0], u.answers.map((a) => a.answer));
      if (!problems.length && r.status !== "ok") healed += 1;
      if (problems.length) still += 1;
      return { ...r, status: problems.length ? "flagged" : "ok", problems };
    });
    console.log(`■ ${setname} 重判 CTW：转 ok ${healed} 块；仍 flagged ${still} 块；找不到对应答案块 ${orphan} 块`);
    if (dry) { console.log("（--dry，未写盘）"); return; }
    const { synced } = writeStructured(OUT_DIR, setname, { ...existing, results },
      { freshKeys: new Set(results.map((r) => r.key)) });
    console.log(`产物 → ${outPath}${synced ? "（已同步 rw 阅读基线）" : ""}`);
    return;
  }
  // 零 token 重判选择题结构闸。
  //
  // 为什么需要它：`--only-failed` 读的是**磁盘上存着的** status，而不是拿当前判据重算。
  // 2026-09-14 把「选项 3~5 个都放行」收紧成「恒 4 个」之后，既有产物里那些 3 选项的块
  // 仍然写着 status=ok —— 于是新闸对存量一条都管不到：重扫不捡它（already_done），
  // 落库照样扔它（build_bank 只收恰好 4 个）。死循环没被解开。
  //
  // 这一步就是把存量按新判据重判一遍，零调用、零花费。
  // **只降级不升级**：ok → flagged 可以，flagged → ok 不行 —— 原本因为别的原因
  // （答案不是单个字母、修复轮没还原出来…）扣下的块，不能因为结构闸过了就被放行。
  // 跳过带 merged_by 的记录：那是合流产出的听力/口语，降级它们会让线上听力题被 build_bank 丢掉。
  if (reverifyMcq) {
    const { results, demoted, kept, skippedMerged, detail } =
      reverifyStructure(existing.results, verifyMcq, MCQ_TYPES);
    console.log(`■ ${setname} 按当前结构闸重判选择题：`
      + `ok → flagged ${demoted} 块；仍 ok ${kept} 块；跳过合流产出 ${skippedMerged} 块`);
    detail.slice(0, 12).forEach((d) => console.log(`   ✗ ${d}`));
    if (!demoted) { console.log("  （没有需要降级的块，产物未改动）"); return; }
    if (dry) { console.log("（--dry，未写盘）"); return; }
    const { synced } = writeStructured(OUT_DIR, setname, { ...existing, results },
      { freshKeys: new Set(results.map((r) => r.key)) });
    console.log(`产物 → ${outPath}${synced ? "（已同步 rw 阅读基线）" : ""}`);
    console.log("  降级的块现在会被 --only-failed 捡起来重扫。");
    return;
  }

  if (onlyFailed) {
    const prev = new Map(existing.results.map((r) => [r.key, r]));
    const before = units.length;
    // 重扫判据（含「合流层扣下的块不重跑」）见 ./failure_policy.js 的 shouldResweep。
    const skipped = {};
    units = units.filter((u) => {
      // 合流跑过的卷，听力/口语已归合流所有：key 格式都换了，这里查不到、全量重跑还付全额。
      // 详见 failure_policy.isMergeOwned 的注释。
      if (isMergeOwned(u.section, existing)) { skipped.merge_owned = (skipped.merge_owned || 0) + 1; return false; }
      const { resweep, skip } = shouldResweep(u, prev.get(u.key), CTW_MIN_ANSWERS);
      if (!resweep) skipped[skip] = (skipped[skip] || 0) + 1;
      return resweep;
    });
    console.log(`--only-failed：${before} → ${units.length} 块`
      + `（既有 ok 的不重跑；答案不足 ${CTW_MIN_ANSWERS} 个的填词块是路由误判，跳过）`);
    if (skipped.merge_owned) {
      console.log(`  跳过 ${skipped.merge_owned} 块听力/口语：这卷已跑过合流，这两科归合流所有。`);
      console.log("  重跑它们既查不到失败块（key 格式不同 → 会变成整科全量重跑、全额付费），");
      console.log("  也换不来题（正文来自商家逐字稿 + ASR 对齐，扣题原因全判在合流层）。");
      console.log("  要修回合流那一层：lc_gender_worksheet 标性别 / 补音频 / 人工切轮次，再重跑 merge_*_asr。");
    }
  }
  if (merge && !units.length) {
    console.log(`■ ${setname}：没有需要处理的块，产物未改动。`);
    return;
  }

  const byType = units.reduce((m, u) => { m[u.type] = (m[u.type] || 0) + 1; return m; }, {});
  console.log(`■ ${setname}\n待处理题块 ${units.length}，类型分布:`, byType);
  const answerCount = units.reduce((n, u) => n + u.answers.length, 0);
  console.log(`覆盖答案 ${answerCount} 条`);
  if (dry) {
    units.slice(0, 12).forEach((u) => console.log(`  ${u.section}/${u.type}  Q${u.start}-${u.end} of ${u.total}  答案 ${u.answers.length} 条`));
    return;
  }
  if (limit > 0) units = units.slice(0, limit);

  console.log(`\n第一轮 · ${MODEL} 转写（并发 ${CONCURRENCY}，只转写不解题）…`);
  const results = await runPool(units, processUnit, CONCURRENCY);
  abortIfSystemic();
  const pass1 = results.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  console.log("第一轮:", pass1);

  // 第二轮只针对第一轮失败的选择题块（CTW/零 token 路不参与——它们的失败不是切块问题）
  const todo = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (r.status === "flagged" || r.status === "error") && MCQ_TYPES.has(r.type));
  if (todo.length) {
    console.log(`\n第二轮 · 合并邻块重切 ${todo.length} 块…`);
    const fixes = await runPool(todo, ({ i }) => repairUnit(units, i), CONCURRENCY);
    abortIfSystemic();
    let healed = 0;
    fixes.forEach((fx, k) => {
      const { i } = todo[k];
      if (fx?.repaired) {
        results[i] = { ...results[i], status: "ok", problems: [], items: fx.items, repaired: true };
        healed += 1;
      } else if (fx) {
        results[i] = { ...results[i], problems: [...results[i].problems, ...(fx.problems || [])] };
      }
    });
    console.log(`第二轮救回 ${healed}/${todo.length} 块`);
  }

  const tally = results.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  console.log("\n最终:", tally);
  const flagged = results.filter((r) => r.status === "flagged" || r.status === "error");
  if (flagged.length) {
    console.log(`\n-- 需人工的 ${flagged.length} 块（前 12）--`);
    flagged.slice(0, 12).forEach((r) => console.log(`  ${r.section}/${r.type} ${r.key}: ${r.problems.slice(0, 2).join(" / ")}`));
  }
  if (merge) {
    const fresh = new Map(results.map((r) => [r.key, r]));
    // 真正采用了本次结果的块 —— 只有这些算 fresh。被「保住既有 ok」挡下的那些不能算，
    // 否则会把上一次合流过的听力记录回灌进合流快照，把幂等毁掉（见 structured_io 头注）。
    const appliedKeys = new Set();
    let replaced = 0, keptOk = 0, added = 0;
    const merged = existing.results.map((r) => {
      const n = fresh.get(r.key);
      if (!n) return r;
      fresh.delete(r.key);
      if (r.status === "ok" && n.status !== "ok") { keptOk += 1; return r; }
      replaced += 1;
      appliedKeys.add(n.key);
      return n;
    });
    for (const n of fresh.values()) { merged.push(n); added += 1; appliedKeys.add(n.key); }
    const { synced, mergeBases } = writeStructured(OUT_DIR, setname, { ...existing, results: merged },
      { freshKeys: appliedKeys });
    const baseNote = mergeBases.length
      ? `（已同步合流快照 ${mergeBases.map((b) => `${b.file}: 替换 ${b.replaced} 新增 ${b.added}`).join("；")}）`
      : "";
    console.log(`\n并回既有产物：替换 ${replaced} 块，新增 ${added} 块，保住既有 ok ${keptOk} 块`
      + `${synced ? "（已同步 rw 阅读基线）" : ""}\n产物 → ${outPath}${baseNote ? `\n${baseNote}` : ""}`);
    return;
  }

  // ── 防覆盖守卫 ──
  // 「跑完了」不等于「跑出东西了」。一次大面积调用失败的空跑，结构上和一次正常跑一模一样，
  // 直接 writeFileSync 就会把上一次花钱换来的产物冲掉（2026-09-05 就是这么丢了四套卷）。
  // 所以落盘前拿磁盘上的旧产物做一次对比，明显更差就拒写；确实要覆盖的加 --force。
  if (fs.existsSync(outPath)) {
    let old = null;
    try { old = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch { /* 坏 JSON 当没有 */ }
    const oldOk = Number(old?.tally?.ok || 0);
    const newOk = Number(tally.ok || 0);
    const newErr = Number(tally.error || 0);
    const refuse =
      (newOk === 0 && oldOk > 0)
        ? `本次 ok=0，而磁盘上已有产物 ok=${oldOk}`
        : (newErr > 0 && newOk < oldOk)
          ? `本次 ok=${newOk} 少于磁盘上的 ok=${oldOk}，且有 ${newErr} 块调用失败`
          : null;
    if (refuse && !force) {
      console.error(`\n[拒绝覆盖] ${refuse}。已保留原产物：${outPath}`);
      console.error(`  这多半是调用大面积失败（余额/鉴权/网络）导致的空跑。`);
      console.error(`  确认要用本次结果覆盖，重跑时加 --force。`);
      process.exit(EXIT_SYSTEMIC);
    }
    if (refuse) console.warn(`\n[--force] 无视守卫覆盖：${refuse}`);
    fs.copyFileSync(outPath, prevPath);   // 一代备份（只留一代，够回滚一次误跑）
    console.log(`已备份上一版 → ${prevPath}`);
  }
  fs.writeFileSync(outPath, JSON.stringify({ set: setname, model: MODEL, tally, results }, null, 2), "utf8");
  console.log(`\n产物 → ${outPath}`);
  // 全量重跑不动合流快照（那两份快照存的就是「解析器原始产物」，重跑等于换了一份新的原始产物，
  // 该由合流脚本自己重建，不该在这里替它决定）。但要说出来 —— 不然听力/口语看起来没变化。
  for (const snap of ["structured.fs_parsed", "structured.parsed"]) {
    if (!fs.existsSync(path.join(OUT_DIR, `${setname}.${snap}.json`))) continue;
    console.log(`[提醒] 这卷有合流快照 ${setname}.${snap}.json，听力/口语仍按旧快照重建。`);
    console.log("  要让本次结果生效，重跑对应的合流脚本（merge_first_source_asr.py / merge_vendor_asr.py）。");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
