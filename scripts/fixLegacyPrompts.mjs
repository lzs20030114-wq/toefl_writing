/**
 * One-time fix: reformat legacy multi-sentence prompts in questions.json and reserve_pool.json.
 * Identifies questions where ask/report/respond prompts have:
 *   - non-empty prompt_context (old two-part format), OR
 *   - prompt_task_text containing 2+ sentences (background embedded in task text)
 * Calls DeepSeek reformatter to merge them into a single question sentence.
 *
 * Usage: node scripts/fixLegacyPrompts.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp.js");

const QUESTIONS_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH   = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const BATCH_SIZE = 15;

function loadEnv() {
  for (const p of [resolve(__dirname, "..", ".env.local"), resolve(__dirname, "..", ".env")]) {
    try {
      readFileSync(p, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m || process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {}
  }
}

function hasLegacyPrompt(q) {
  const kind = (q.prompt_task_kind || "").toLowerCase();
  if (!["ask", "report", "respond"].includes(kind)) return false;
  if ((q.prompt_context || "").trim()) return true;
  const sentences = (q.prompt_task_text || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.length >= 2;
}

function buildReformatterPrompt(questions) {
  const items = questions.map(q => ({
    id: q.id,
    prompt_context: q.prompt_context || "",
    prompt_task_kind: q.prompt_task_kind || "",
    prompt_task_text: q.prompt_task_text || "",
  }));
  return `You are a TOEFL prompt style editor. Rewrite each "ask"/"report"/"respond" item so prompt_task_text is ONE self-contained question sentence.

CASE 1 — non-empty prompt_context: merge context + task into one question. Set prompt_context="".
  IN:  context="The yoga instructor is speaking with a student about the schedule."  task="What does she ask?"
  OUT: context=""  task="What did the yoga instructor ask the student about the schedule?"

CASE 2 — multi-sentence prompt_task_text: collapse into one question. Keep prompt_context="".
  IN:  context=""  task="The student was studying late. What did she want to know?"
  OUT: context=""  task="What did the student studying late want to know?"

CONSTRAINTS:
- Output task_text MUST be ONE sentence ending with ?.
- Do NOT invent new details or change the grammar point being tested.
- "tell" / "explain" items: return unchanged.
- Return ONLY a JSON array: [{id, prompt_context, prompt_task_text}]

ITEMS:
${JSON.stringify(items, null, 2)}

Return ONLY JSON array. No markdown.`.trim();
}

function parseJsonArray(text) {
  const s = body => { const a = body.indexOf("["); const b = body.lastIndexOf("]"); if (a<0||b<=a) throw new Error("no array"); return JSON.parse(body.slice(a,b+1)); };
  return s(String(text||""));
}

async function callDeepSeek(prompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: { model: "deepseek-chat", temperature: 0, max_tokens: 5000, messages: [{ role: "user", content: prompt }] },
  });
}

async function reformatAll(questions) {
  const toFix = questions.filter(hasLegacyPrompt);
  if (toFix.length === 0) return new Map();
  const allUpdates = new Map();
  for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
    const batch = toFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const total = Math.ceil(toFix.length / BATCH_SIZE);
    process.stdout.write(`    batch ${batchNum}/${total} (${batch.length} questions)... `);
    try {
      const raw = await callDeepSeek(buildReformatterPrompt(batch));
      const arr = parseJsonArray(raw);
      arr.forEach(u => allUpdates.set(String(u.id || ""), u));
      console.log("ok");
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    if (i + BATCH_SIZE < toFix.length) await new Promise(r => setTimeout(r, 2000));
  }
  return allUpdates;
}

function applyToQuestion(q, updates) {
  const u = updates.get(q.id);
  if (!u) return q;
  const newCtx  = String(u.prompt_context  ?? "").trim();
  const newTask = String(u.prompt_task_text ?? "").trim();
  if (!newTask) return q;
  const updated = { ...q, prompt_context: newCtx, prompt_task_text: newTask };
  updated.prompt = newCtx ? `${newCtx} ${newTask}` : newTask;
  return updated;
}

async function fixQuestionsJson() {
  if (!existsSync(QUESTIONS_PATH)) { console.log("  questions.json not found, skipping."); return; }
  const data = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
  const sets = data.question_sets || [];
  const allQ = sets.flatMap(s => s.questions || []);
  const legacy = allQ.filter(hasLegacyPrompt);
  console.log(`  ${legacy.length} / ${allQ.length} questions with legacy prompts`);
  if (legacy.length === 0) return;

  const updates = await reformatAll(allQ);
  let fixed = 0;
  const updatedSets = sets.map(s => ({
    ...s,
    questions: (s.questions || []).map(q => {
      const next = applyToQuestion(q, updates);
      if (next !== q) fixed++;
      return next;
    }),
  }));
  writeFileSync(QUESTIONS_PATH, `${JSON.stringify({ ...data, question_sets: updatedSets }, null, 2)}\n`, "utf8");
  console.log(`  fixed ${fixed} questions → saved.`);
}

async function fixReservePool() {
  if (!existsSync(RESERVE_PATH)) { console.log("  reserve_pool.json not found, skipping."); return; }
  const pool = JSON.parse(readFileSync(RESERVE_PATH, "utf8"));
  const questions = Array.isArray(pool) ? pool : [];
  const legacy = questions.filter(hasLegacyPrompt);
  console.log(`  ${legacy.length} / ${questions.length} questions with legacy prompts`);
  if (legacy.length === 0) return;

  const updates = await reformatAll(questions);
  let fixed = 0;
  const updatedPool = questions.map(q => {
    const next = applyToQuestion(q, updates);
    if (next !== q) fixed++;
    return next;
  });
  writeFileSync(RESERVE_PATH, `${JSON.stringify(updatedPool, null, 2)}\n`, "utf8");
  console.log(`  fixed ${fixed} questions → saved.`);
}

async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) { console.error("ERROR: DEEPSEEK_API_KEY missing"); process.exit(1); }
  console.log("Fix Legacy Prompts");
  console.log("==================");
  console.log("\nquestions.json:");
  await fixQuestionsJson();
  console.log("\nreserve_pool.json:");
  await fixReservePool();
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
