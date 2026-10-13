#!/usr/bin/env node
// 给真题阅读选择题离线标「答案依据句」：标准答案靠原文哪一句（或几句）读出来。
// 产物 data/realBank/reading/answer-evidence.json，答疑窗口与第一轮讲解把它作为
// 「答案依据句（离线标注，供参考）」放进证据包（lib/qa/questionQa 的 buildEvidence），
// 举一反三时以前做过的题也只带依据句、不带整篇原文。
//
// 每题独立调用两次 DeepSeek（两票），两票给出的句号有交集、且引文能在所标句子里一字不差找到才收；
// 对不上的记为 disputed，不进证据包。插入句题（答案是位置）和选句题（答案本身就是原文句子）不标。
//
// 用法：
//   node scripts/qa/annotate-answer-evidence.mjs                # 默认 dry-run：打印「将调用 N 次 / 预计 ¥X」
//   node scripts/qa/annotate-answer-evidence.mjs --run --yes    # 真跑（需要 .env.local 里的 DEEPSEEK_API_KEY）
// 选项：--limit N（只标前 N 道，试跑用）  --votes 2  --concurrency 4  --max-calls 200（超过要 --yes）
//       已标过的题（键 + 题干签名都对得上）自动跳过，可以中断后续跑；每 20 题落一次盘。
// 开头那条 MODULE_TYPELESS_PACKAGE_JSON 警告无害。调用走 lib/ai/deepseekHttp，自动记台账。
import { register, createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
register(pathToFileURL(join(__dirname, "_extless-loader.mjs")));
const require = createRequire(import.meta.url);

const { buildEvidence, plainText } = await import(pathToFileURL(join(ROOT, "lib", "qa", "questionQa.js")).href);
const { evidenceKey, verifyEvidence, ANSWER_EVIDENCE_VERSION } = await import(pathToFileURL(join(ROOT, "lib", "qa", "answerEvidence.js")).href);
const { DEFAULT_MODEL: MODEL } = await import(pathToFileURL(join(ROOT, "lib", "ai", "upstream.js")).href);

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const CNY_PER_MTOK = Number(process.env.DEEPSEEK_CNY_PER_MTOK) || 5.24;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const RUN = flag("run");
const YES = flag("yes");
const LIMIT = Number(opt("limit", 0));
const VOTES = Math.max(1, Number(opt("votes", 2)));
const MAX_CALLS = Number(opt("max-calls", 200));
const CONCURRENCY = Number(opt("concurrency", 4));
const OUT = join(ROOT, "data", "realBank", "reading", "answer-evidence.json");

/* ── 题目 ─────────────────────────────────────────────── */
const SKIP_TYPES = new Set(["insert_text", "sentence_selection"]);
const loadBank = (name) => JSON.parse(readFileSync(join(ROOT, "data", "realBank", "reading", name), "utf-8")).items;
const all = [
  ...loadBank("ap.json").map((it) => ({ it, passage: it.passage, paragraphs: it.paragraphs, subtype: "ap" })),
  ...loadBank("rdl.json").map((it) => ({ it, passage: it.text || it.passage, paragraphs: undefined, subtype: "rdl" })),
].flatMap(({ it, passage, paragraphs, subtype }) =>
  (it.questions || []).map((q, i) => ({
    key: evidenceKey(it.id, i),
    detail: { qid: `${it.id}-q${i}`, stem: q.stem, question: q, options: q.options, selected: null, correct: q.correct_answer, passage, paragraphs, subtype, isCorrect: true },
  }))
).filter((x) => x.detail.passage && x.detail.stem && x.detail.options && x.detail.correct && !SKIP_TYPES.has(x.detail.question.question_type));

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : { version: ANSWER_EVIDENCE_VERSION, items: {} };
const done = (x) => {
  const e = existing.items[x.key];
  return e && e.stem === String(x.detail.stem).slice(0, 80);
};
let todo = all.filter((x) => !done(x));
if (LIMIT) todo = todo.slice(0, LIMIT);

const SYSTEM =
  "你是 TOEFL 阅读题的标注员。下面是一道题的材料：原文已按句编号 [S1]、[S2]…，还有题目、选项和标准答案。" +
  "请找出原文里支撑标准答案的句子：读者要读哪一句（最多 3 句）才能得出这个答案。" +
  "词汇题选目标词所在的句子；主旨题选最能概括主旨的句子；否定题（NOT / EXCEPT）选能排除其余三个选项的句子。" +
  '只输出 JSON，例如 {"ids":["S7"],"quote":"原文里最关键的几个英文词，必须与该句一字不差"}，不要别的文字。';

const estTokens = (s) => {
  const cjk = (String(s).match(/[一-鿿]/g) || []).length;
  return Math.round(cjk * 0.7 + (String(s).length - cjk) / 4);
};
const calls = todo.length * VOTES;
const inTok = todo.reduce((n, x) => n + (estTokens(SYSTEM) + estTokens(buildEvidence(x.detail).text)) * VOTES, 0);
const outTok = calls * 800;
console.log(`可标 ${all.length} 道（跳过插入句、选句题），已标 ${all.length - all.filter((x) => !done(x)).length} 道，本次 ${todo.length} 道 × ${VOTES} 票`);
console.log(`将调用 ${calls} 次 / 预计输入 ~${inTok} tokens、输出 ~${outTok} tokens / 预计 ¥${(((inTok + outTok) / 1e6) * CNY_PER_MTOK).toFixed(2)}（¥${CNY_PER_MTOK}/M，${MODEL}）`);
if (!RUN) {
  console.log("这是 dry-run。确认后加 --run 真跑。");
  process.exit(0);
}
if (calls > MAX_CALLS && !YES) {
  console.error(`调用次数 ${calls} 超过 --max-calls ${MAX_CALLS}，加 --yes 才会跑。`);
  process.exit(1);
}
if (!YES) {
  console.error("真跑要花钱：确认后加 --yes。");
  process.exit(1);
}
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("缺 DEEPSEEK_API_KEY（.env.local 或环境变量）。");
  process.exit(1);
}
const { callDeepSeekViaCurl } = require(join(ROOT, "lib", "ai", "deepseekHttp.js"));

async function vote(material) {
  const raw = await callDeepSeekViaCurl({
    apiKey,
    payload: { model: MODEL, max_tokens: 2000, temperature: 0.3, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: material }] },
    timeoutMs: 120000,
    meta: { script: "qa/annotate-answer-evidence", label: "vote" },
  });
  const m = plainText(raw).match(/\{[\s\S]*\}/);
  try {
    const v = m ? JSON.parse(m[0]) : null;
    return v && Array.isArray(v.ids) ? { ids: v.ids.map(String), quote: String(v.quote || "") } : null;
  } catch {
    return null;
  }
}

let n = 0;
let kept = 0;
let disputed = 0;
const save = () => writeFileSync(OUT, JSON.stringify({ ...existing, version: ANSWER_EVIDENCE_VERSION, model: MODEL, votes: VOTES, updatedAt: new Date().toISOString() }, null, 1));
async function one(x) {
  const ev = buildEvidence(x.detail);
  const votes = [];
  for (let k = 0; k < VOTES; k++) {
    try {
      votes.push(await vote(ev.text));
    } catch (e) {
      votes.push(null);
    }
  }
  const res = verifyEvidence(votes, ev.sentences);
  existing.items[x.key] = { stem: String(x.detail.stem).slice(0, 80), ...res };
  if (res.status === "ok") kept++;
  else disputed++;
  n++;
  if (n % 20 === 0) save();
  process.stdout.write(`[${n}/${todo.length}] ${x.key} ${res.status}${res.status === "ok" ? ` ${res.ids.join(",")}` : ` (${res.reason})`}\n`);
}

let next = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (next < todo.length) await one(todo[next++]);
}));
save();
const total = Object.values(existing.items);
console.log(`\n本次 ${n} 道：收 ${kept}，两票不一致或引文核不上 ${disputed}。`);
console.log(`文件里共 ${total.length} 道，ok ${total.filter((e) => e.status === "ok").length}。写到 ${OUT.replace(/\\/g, "/")}`);
