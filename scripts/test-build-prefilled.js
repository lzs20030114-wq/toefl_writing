/**
 * Test: Build sentence prefilled position accuracy — full pipeline
 * AI output → server-side postProcessBuild → schema validation
 *
 * Usage: node scripts/test-build-prefilled.js
 */
const fs = require("fs");
const path = require("path");
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp");
const { validateQuestion } = require("../lib/questionBank/buildSentenceSchema");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(process.cwd(), f), "utf8")
        .split(/\r?\n/)
        .forEach((line) => {
          const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
          if (!m || process.env[m[1]]) return;
          process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
        });
    } catch {}
  }
}

function extractJson(raw) {
  const s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : s;
}

async function callDeepSeek(systemPrompt, userText) {
  const payload = {
    model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  };
  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    return callDeepSeekViaCurl({ apiKey: process.env.DEEPSEEK_API_KEY, proxyUrl, timeoutMs: 60000, payload });
  }
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const json = await res.json();
  const c = json?.choices?.[0]?.message?.content;
  if (!c) throw new Error("empty content");
  return c;
}

// ── System prompt (matches updated route.js) ──────────────────────────────────
const BUILD_PROMPT = `You are a JSON extractor. Parse the user's text into TOEFL build-sentence questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "prompt": "string",
  "answer": "string",
  "chunks": ["string"],
  "prefilled": ["string"],
  "distractor": "string or null",
  "grammar_points": ["string"]
}

CRITICAL RULES for chunks vs prefilled:
- "chunks" = word/phrase tiles the student must arrange (scrambled). All lowercase except pronouns (I, I'm, I've, I'll, I'd).
- "prefilled" = tiles already placed for the student in a fixed position. These are NOT scrambled and must NOT appear in "chunks".
- Every word in the answer must appear in either chunks or prefilled (excluding the distractor word).
- If the input does not mention any prefilled items, set prefilled to [].
- "distractor" is a single word that looks plausible but does NOT appear in the answer. Set to null if not present.
- Return [] if nothing can be parsed.`;

// ── Server-side post-processor (mirrors route.js exactly) ────────────────────
function postProcessBuild(q) {
  const answer = String(q.answer || "").trim();
  const prefilled = Array.isArray(q.prefilled) ? q.prefilled : [];

  const answerWords = answer
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

  const prefilled_positions = {};
  for (const pf of prefilled) {
    const pfWords = String(pf)
      .replace(/[.,!?;:]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase());
    if (pfWords.length === 0) continue;

    for (let i = 0; i <= answerWords.length - pfWords.length; i++) {
      if (pfWords.every((w, j) => w === answerWords[i + j])) {
        prefilled_positions[pf] = i;
        break;
      }
    }
  }

  return {
    ...q,
    prefilled,
    prefilled_positions,
    distractor: q.distractor || null,
    has_question_mark: answer.endsWith("?"),
    grammar_points: Array.isArray(q.grammar_points) ? q.grammar_points : [],
  };
}

// ── Test cases ────────────────────────────────────────────────────────────────
const TEST_CASES = [
  {
    name: "Prefilled at START — explicit brackets",
    text: `
Prompt: Someone was waiting outside.
Answer: The professor was waiting outside the lecture hall.
Scrambled chunks: was, waiting, outside, the lecture hall
Pre-placed (prefilled): The professor
Distractor: waited
Grammar: past continuous, definite article
`,
    check: (q) => {
      if (!q.prefilled.some(p => p.toLowerCase().includes("professor"))) return "prefilled should contain 'the professor'";
      if (q.prefilled_positions[q.prefilled.find(p => p.toLowerCase().includes("professor"))] !== 0)
        return `prefilled_positions for 'the professor' should be 0`;
      return null;
    },
  },
  {
    name: "Prefilled in MIDDLE — 'desk you' at word 1",
    text: `
Prompt: The desk you ordered arrived.
Answer: The desk you ordered arrived this morning.
Scrambled chunks: the, ordered, arrived, this morning
Pre-placed tile: "desk you"
Distractor: that
Grammar: contact clause (omitted relative pronoun)
`,
    check: (q) => {
      const pf = q.prefilled.find(p => p.toLowerCase().includes("desk"));
      if (!pf) return "prefilled should contain 'desk you'";
      if (q.prefilled_positions[pf] !== 1) return `position should be 1, got ${q.prefilled_positions[pf]}`;
      return null;
    },
  },
  {
    name: "Prefilled at END — 'would be held' at word 7",
    text: `
Prompt: Where was the tutorial held?
Answer: She wanted to know where the tutorial would be held.
Scrambled chunks: she, wanted, to know, where the tutorial
Pre-filled at end: "would be held"
Grammar: embedded question (where-clause)
`,
    check: (q) => {
      const pf = q.prefilled.find(p => p.toLowerCase().includes("would"));
      if (!pf) return "prefilled should contain 'would be held'";
      if (q.prefilled_positions[pf] !== 7) return `position should be 7, got ${q.prefilled_positions[pf]}`;
      return null;
    },
  },
  {
    name: "TWO prefilled at different positions",
    text: `
Prompt: The study results were surprising.
Answer: The results of the study have been widely discussed.
Scrambled chunks: of the study, widely, discussed
Pre-filled slot A: "The results" (words 0-1)
Pre-filled slot B: "have been" (words 4-5)
Grammar: present perfect passive
`,
    check: (q) => {
      const pfR = q.prefilled.find(p => /results/i.test(p));
      const pfH = q.prefilled.find(p => /have been/i.test(p));
      if (!pfR) return "missing prefilled 'The results'";
      if (!pfH) return "missing prefilled 'have been'";
      if (q.prefilled_positions[pfR] !== 0) return `'The results' pos should be 0, got ${q.prefilled_positions[pfR]}`;
      if (q.prefilled_positions[pfH] !== 5) return `'have been' pos should be 5, got ${q.prefilled_positions[pfH]}`;
      return null;
    },
  },
  {
    name: "NO prefilled chunks",
    text: `
Prompt: The match went on.
Answer: Despite the heavy rain, the match continued without interruption.
Chunks: despite, the heavy rain, the match, continued, without interruption
No prefilled. No distractor.
Grammar: concessive clause, adverbial phrase
`,
    check: (q) => {
      if (q.prefilled.length !== 0) return `prefilled should be [], got [${q.prefilled}]`;
      if (Object.keys(q.prefilled_positions).length !== 0) return "prefilled_positions should be {}";
      return null;
    },
  },
  {
    name: "Answer ends with ? — has_question_mark=true",
    text: `
Prompt: Where can we check the results?
Answer: Could you tell me when the results will be posted?
Scrambled chunks: could, me, when, the results, will be posted
Pre-filled: "you tell" (position 1)
Distractor: do
Grammar: embedded question
`,
    check: (q) => {
      if (q.has_question_mark !== true) return `has_question_mark should be true, got ${q.has_question_mark}`;
      const pf = q.prefilled.find(p => /you tell/i.test(p));
      if (!pf) return "prefilled should contain 'you tell'";
      if (q.prefilled_positions[pf] !== 1) return `'you tell' pos should be 1, got ${q.prefilled_positions[pf]}`;
      return null;
    },
  },
  {
    name: "Answer ends without ? — has_question_mark=false",
    text: `
Prompt: Was the draft ready?
Answer: The draft was not ready before the deadline.
Chunks: the, not, ready, before, the deadline
Prefilled: "draft was" (position 1)
Grammar: negation, past tense
`,
    check: (q) => {
      if (q.has_question_mark !== false) return `has_question_mark should be false, got ${q.has_question_mark}`;
      const pf = q.prefilled.find(p => /draft was/i.test(p));
      if (!pf) return "prefilled should contain 'draft was'";
      if (q.prefilled_positions[pf] !== 1) return `'draft was' pos should be 1, got ${q.prefilled_positions[pf]}`;
      return null;
    },
  },
  {
    name: "Chinese label format — 预填词块",
    text: `
题目：
提示语：Who wanted to know where the tutorial was?
正确答案：She wanted to know where the tutorial would be held.
可拼词块：she, wanted, to know, where the tutorial
预填词块（固定位置）：would be held
语法点：embedded question, would-passive
`,
    check: (q) => {
      const pf = q.prefilled.find(p => /would/i.test(p));
      if (!pf) return "prefilled should contain 'would be held'";
      if (q.prefilled_positions[pf] !== 7) return `pos should be 7, got ${q.prefilled_positions[pf]}`;
      return null;
    },
  },
  {
    name: "Multi-word prefilled — chunks are ALL lowercase",
    text: `
Prompt: Did she ask about the course?
Answer: She asked me whether the course had already started.
Tiles to scramble: me, whether, had already, started
Pre-placed: "She asked" and "the course"
Grammar: reported speech (whether-clause)
`,
    check: (q) => {
      if (q.prefilled.length < 2) return `should have 2 prefilled items, got ${q.prefilled.length}`;
      // chunks should all be lowercase
      const badChunk = q.chunks.find(c => c !== c.toLowerCase() && !["I", "I'm", "I've", "I'll", "I'd"].includes(c));
      if (badChunk) return `chunk "${badChunk}" should be lowercase`;
      return null;
    },
  },
];

// ── Run ───────────────────────────────────────────────────────────────────────
async function runTest(tc) {
  let rawContent;
  try {
    rawContent = await callDeepSeek(BUILD_PROMPT, tc.text);
  } catch (e) {
    return { pass: false, reason: `API error: ${e.message}` };
  }

  let questions;
  try {
    questions = JSON.parse(extractJson(rawContent));
    if (!Array.isArray(questions) || questions.length === 0) throw new Error("empty");
  } catch {
    return { pass: false, reason: `JSON parse failed: ${rawContent.slice(0, 100)}` };
  }

  // Apply server-side post-processing (mirrors route.js)
  const q = postProcessBuild(questions[0]);

  // Schema validation (skip set-level rules, just validate the question)
  const { fatal, format } = validateQuestion({ ...q, id: "test_q" });
  // Filter out the chunk count constraint since test inputs are intentionally minimal
  const schemaIssues = [...fatal, ...format.filter(e => !e.includes("effective chunks count"))];

  // Custom check for this test case
  const customIssue = tc.check(q);

  const allIssues = [...schemaIssues, ...(customIssue ? [customIssue] : [])];

  if (allIssues.length > 0) {
    return { pass: false, reason: allIssues.join(" | "), q };
  }
  return { pass: true, q };
}

async function main() {
  loadEnv();
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key || key === "your_key_here") {
    console.error("FAIL: DEEPSEEK_API_KEY missing"); process.exit(1);
  }

  console.log(`\nBuild sentence — prefilled position accuracy (full pipeline)`);
  console.log(`Model: deepseek-chat  |  proxy: ${resolveProxyUrl() || "(direct)"}`);
  console.log(`Strategy: AI identifies prefilled values, server computes positions\n`);

  const sep = "─".repeat(80);
  console.log(sep);

  let passed = 0;
  for (const tc of TEST_CASES) {
    process.stdout.write(`${tc.name.padEnd(58)} `);
    const result = await runTest(tc);
    if (result.pass) {
      passed++;
      const pos = result.q.prefilled_positions;
      const posStr = Object.keys(pos).length
        ? "pos=" + Object.entries(pos).map(([k, v]) => `"${k}"→${v}`).join(", ")
        : "no prefilled";
      console.log(`PASS  [${posStr}]`);
    } else {
      console.log(`FAIL  ${result.reason}`);
    }
  }

  console.log(sep);
  console.log(`\nResult: ${passed}/${TEST_CASES.length} passed`);
  if (passed < TEST_CASES.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
