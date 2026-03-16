/**
 * Test: AI bulk-import parsing across question types and input formats
 * Usage: node scripts/test-parse-questions.js
 */
const fs = require("fs");
const path = require("path");
const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp");

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const files = [".env.local", ".env"];
  for (const f of files) {
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

// ── DeepSeek call ─────────────────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty content");
  return content;
}

function extractJson(raw) {
  const s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : s;
}

// ── System prompts (must match route.js) ─────────────────────────────────────
const SYSTEM_PROMPTS = {
  academic: `You are a JSON extractor. Parse the user's text into TOEFL academic writing discussion questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "professor": { "name": "string", "text": "string" },
  "students": [
    { "name": "string", "text": "string" },
    { "name": "string", "text": "string" }
  ]
}
Rules:
- Extract every distinct question block you find.
- If a professor name is missing use "Professor".
- If student names are missing use "Student A" / "Student B".
- Return [] if nothing can be parsed.`,

  email: `You are a JSON extractor. Parse the user's text into TOEFL email writing questions.
Return ONLY a valid JSON array (no markdown, no explanation) where each element has this exact shape:
{
  "to": "string",
  "subject": "string",
  "scenario": "string",
  "direction": "string",
  "goals": ["string", "string"]
}
Rules:
- Extract every distinct email question block you find.
- "goals" must be a non-empty array of strings.
- Return [] if nothing can be parsed.`,

  build: `You are a JSON extractor. Parse TOEFL "Build a Sentence" questions from the user's text.

INPUT FORMAT (TPO style — each question has 3 parts):
  Part 1 – Person A's spoken question  →  becomes "prompt"
  Part 2 – Person B's incomplete response with _____ blanks  →  assemble into "answer"
  Part 3 – word/phrase tiles separated by " / "  →  one tile is the distractor, rest become "chunks"

Return ONLY a valid JSON array. Each element:
{
  "prompt": "Person A's spoken question",
  "answer": "Person B's complete, grammatically correct response",
  "chunks": ["tile1", "tile2", ...],
  "prefilled": ["tile"],
  "distractor": "single wrong tile or null",
  "grammar_points": ["tag"]
}

CHUNK RULES:
- Every word in "answer" must appear in either "chunks" or "prefilled".
- "prefilled" = tiles already placed in Person B's line (not scrambled). Must NOT appear in "chunks".
- Chunks are all lowercase except: I, I'm, I've, I'll, I'd.
- Multi-word phrases that belong together stay as one chunk (e.g. "to know", "had changed").

DISTRACTOR RULES — CRITICAL:
Pick the distractor that tests the SPECIFIC grammar weakness of that sentence.
Use this table:

  grammar_point contains "passive voice"
      → distractor: "gets", "have", "been", "will", or "does"
      → NEVER use "did" for passive voice sentences

  grammar_point contains "embedded question" (wanted/needed/asked + wh-word or if/whether)
      → "did" is the PRIMARY distractor (tests no-inversion rule); use it freely
      → if "did" already appears in ≥50% of the batch, alternate with "does", "do", "is", "are"

  grammar_point contains "past perfect" (had + past participle)
      → distractor: "was", "is", "have"

  grammar_point contains "negation" or "modal"
      → distractor: "can", "does", "did" (vary; avoid repeating)

  other / general
      → pick a plausible but grammatically wrong word specific to this sentence

DIVERSITY RULE: Across the entire batch, no single distractor word may appear more than 2 times.
Set distractor to null only if no plausible wrong tile exists.

Return [] if nothing can be parsed.`,
};

// ── Validators ────────────────────────────────────────────────────────────────
function validateAcademic(q) {
  if (!q.professor?.name || !q.professor?.text) return "missing professor.name or professor.text";
  if (!Array.isArray(q.students) || q.students.length < 2) return "students must have ≥2 entries";
  for (const s of q.students) {
    if (!s.name || !s.text) return "student missing name or text";
  }
  return null;
}
function validateEmail(q) {
  if (!q.to) return "missing to";
  if (!q.scenario) return "missing scenario";
  if (!q.direction) return "missing direction";
  if (!Array.isArray(q.goals) || q.goals.length === 0) return "goals must be non-empty array";
  return null;
}
function validateBuild(q) {
  if (!q.prompt) return "missing prompt";
  if (!q.answer) return "missing answer";
  if (!Array.isArray(q.chunks) || q.chunks.length === 0) return "chunks must be non-empty array";
  return null;
}

const VALIDATORS = { academic: validateAcademic, email: validateEmail, build: validateBuild };

// ── Test cases ────────────────────────────────────────────────────────────────
const TEST_CASES = [
  // ── ACADEMIC ──────────────────────────────────────────────────────────────
  {
    name: "Academic — structured label format",
    type: "academic",
    expectedCount: 2,
    text: `
Professor: Dr. Smith
Text: Universities should require students to study abroad for at least one semester. What do you think?

Student 1: Emma
Text: I strongly agree. Living in a foreign country teaches adaptability and cross-cultural communication skills that no classroom can replicate.

Student 2: James
Text: While beneficial, mandatory study abroad ignores financial barriers. Many students simply cannot afford to live overseas for months.

---

Professor: Dr. Lee
Text: Should companies be required to give employees four-day workweeks? Share your opinion.

Student 1: Mia
Text: Yes, shorter workweeks boost productivity and mental health. Studies from Iceland show output remains the same with fewer hours.

Student 2: Alex
Text: Not all industries can adapt. Manufacturing and healthcare require continuous coverage, making a blanket policy impractical.
`,
  },
  {
    name: "Academic — freeform paragraph format (no labels)",
    type: "academic",
    expectedCount: 1,
    text: `
Professor Johnson asked the class whether social media does more harm than good to teenagers.
Sarah argued that social media isolates teens by replacing real friendships with shallow online interactions, leading to anxiety.
Tom disagreed, saying platforms like Instagram help shy students find communities and express themselves creatively.
`,
  },
  {
    name: "Academic — numbered question format",
    type: "academic",
    expectedCount: 2,
    text: `
Question 1
Prof. Davis: Do you think AI will eliminate more jobs than it creates in the next decade?
Rachel: Absolutely. Automation is already replacing warehouse workers and call center employees with no sign of slowing down.
Kevin: History shows new technology creates new industries. AI will spawn roles we cannot yet imagine, just like the internet did.

Question 2
Prof. Wang: Is it ethical for governments to monitor citizens' online activity for security purposes?
Lily: Security must come first. Terrorists use encrypted chats; governments need access to prevent attacks.
Omar: Privacy is a fundamental right. Mass surveillance enables authoritarian control even in democracies.
`,
  },

  // ── EMAIL ─────────────────────────────────────────────────────────────────
  {
    name: "Email — clean labeled format",
    type: "email",
    expectedCount: 2,
    text: `
To: Academic Advisor
From: A student
Scenario: You received a failing grade on a midterm exam and want to discuss options for improving your final course grade.
Direction: Write an email to your academic advisor asking for a meeting and outlining two specific strategies you plan to use.
Goals:
1. Apologize and take responsibility for the poor performance
2. Propose a concrete study plan and ask for feedback

---

To: Campus Housing Office
From: A student
Scenario: Your dormitory heating has been broken for two weeks. You have contacted maintenance twice with no response.
Direction: Write a formal complaint email requesting urgent repair and describing the impact on your daily life.
Goals:
1. Describe the problem and timeline clearly
2. Request a specific deadline for the repair
3. Mention health and academic consequences
`,
  },
  {
    name: "Email — bullet goals, no separator",
    type: "email",
    expectedCount: 1,
    text: `
To: Professor Chen
From: International student

Scenario: You missed an important lab session due to a visa appointment that was rescheduled at the last minute.

Direction: Write an email to your professor explaining the situation and asking whether you can complete a make-up lab.

Writing goals:
• Briefly explain the reason for your absence
• Express apology and concern about your grade
• Ask about make-up options and offer available times
`,
  },
  {
    name: "Email — minimal/informal pasted format",
    type: "email",
    expectedCount: 1,
    text: `
Email question: write to the library director complaining that the quiet study room is always noisy.
FROM a student TO library director.
The student wants to: (1) describe specific disturbances, (2) suggest installing a noise monitoring system, (3) ask when improvements will happen.
`,
  },

  // ── BUILD ─────────────────────────────────────────────────────────────────
  {
    name: "Build — full structured format with all fields",
    type: "build",
    expectedCount: 2,
    text: `
Q1
Prompt: The researchers discovered a groundbreaking cure.
Answer: The researchers discovered a groundbreaking cure for the disease.
Chunks: The researchers, discovered, a groundbreaking, cure, for the disease
Prefilled: The researchers
Distractor: founded
Grammar points: past tense, article usage

Q2
Prompt: She has been studying abroad.
Answer: She has been studying abroad for three years.
Chunks: She, has been studying, abroad, for three years
Grammar points: present perfect continuous
`,
  },
  {
    name: "Build — simple one-per-line no labels",
    type: "build",
    expectedCount: 3,
    text: `
Rearrange the following words to form correct sentences:

1. Answer: "Despite the heavy rain, the match continued."
   Words: Despite / the heavy rain / the match / continued

2. Answer: "She had never visited a country where people spoke only French."
   Words: She / had never visited / a country / where people / spoke only French

3. Answer: "The committee is expected to announce its decision by Friday."
   Words: The committee / is expected / to announce / its decision / by Friday
`,
  },
  {
    name: "Build — Chinese label mixed format",
    type: "build",
    expectedCount: 2,
    text: `
题目1
提示语：The new policy will affect thousands of families.
正确答案：The new policy will significantly affect thousands of low-income families.
词块：The new policy / will / significantly / affect / thousands of / low-income families
干扰词：effected
语法点：adverb placement, adjective before noun

题目2
提示语：Students should take responsibility.
正确答案：Students should take full responsibility for their academic performance.
词块：Students / should take / full responsibility / for their / academic performance
`,
  },

  // ── New Build test cases ───────────────────────────────────────────────────
  {
    name: "Build — TPO dialogue blank format",
    type: "build",
    expectedCount: 3,
    text: `
Were you able to complete the project on time?
Unfortunately, I _____ _____ _____ _____ _____.
did / not / the deadline / meet / no

Did you enjoy the workshop yesterday?
_____ _____ _____ _____ to me.
not / the content / was / interesting / did

What did Mariana ask you after class?
She _____ _____ _____ _____ _____ _____ _____.
did / to know / anywhere / I / if / went / interesting / wanted
`,
  },
  {
    name: "Build — distractor diversity (passive + embedded mix)",
    type: "build",
    expectedCount: 4,
    // 2 passive voice + 2 embedded question — "did" should appear ≤ 2 times total,
    // and passive voice distractors must NOT be "did"
    batchValidate(questions) {
      const didCount = questions.filter((q) => q.distractor === "did").length;
      if (didCount >= 3) return `too many "did" distractors: ${didCount} (max 2)`;
      const passiveWithDid = questions.filter(
        (q) =>
          q.distractor === "did" &&
          Array.isArray(q.grammar_points) &&
          q.grammar_points.some((g) => g.toLowerCase().includes("passive"))
      );
      if (passiveWithDid.length > 0)
        return `passive voice question used "did" as distractor (forbidden)`;
      return null;
    },
    text: `
Was the document signed by the director?
The document _____ _____ _____ the director.
was / signed / by / did / gets

Has the package been delivered to the office?
The package _____ _____ _____ _____ the office.
has / been / delivered / to / did / does

She wanted to know where I had parked the car.
She wanted _____ _____ _____ _____ _____ _____ the car.
to know / where / I / had parked / did / does

He asked me if the conference had been rescheduled.
He asked me _____ _____ conference _____ _____ rescheduled.
if / the / had / been / did / whether
`,
  },
];

// ── Run ───────────────────────────────────────────────────────────────────────
async function runTest(tc, apiKey) {
  const systemPrompt = SYSTEM_PROMPTS[tc.type];
  const validate = VALIDATORS[tc.type];

  let rawContent;
  try {
    rawContent = await callDeepSeek(systemPrompt, tc.text);
  } catch (e) {
    return { pass: false, reason: `DeepSeek call failed: ${e.message}` };
  }

  let questions;
  try {
    questions = JSON.parse(extractJson(rawContent));
    if (!Array.isArray(questions)) throw new Error("not an array");
  } catch {
    return { pass: false, reason: `JSON parse failed. Raw: ${rawContent.slice(0, 200)}` };
  }

  if (questions.length === 0) {
    return { pass: false, reason: "returned empty array []" };
  }

  // Validate each parsed question
  for (let i = 0; i < questions.length; i++) {
    const err = validate(questions[i]);
    if (err) return { pass: false, reason: `question[${i}] invalid: ${err}` };
  }

  // Optional batch-level validation (e.g. distractor diversity)
  if (typeof tc.batchValidate === "function") {
    const batchErr = tc.batchValidate(questions);
    if (batchErr) return { pass: false, reason: `batch check failed: ${batchErr}` };
  }

  const countNote = questions.length === tc.expectedCount
    ? `${questions.length} questions ✓`
    : `${questions.length} questions (expected ${tc.expectedCount})`;

  return { pass: true, count: questions.length, countNote };
}

async function main() {
  loadEnv();

  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key || key === "your_key_here") {
    console.error("FAIL: DEEPSEEK_API_KEY missing or placeholder");
    process.exit(1);
  }

  const proxy = resolveProxyUrl();
  console.log(`\nDeepSeek parse-questions test`);
  console.log(`proxy: ${proxy || "(direct)"}`);
  console.log(`cases: ${TEST_CASES.length}\n`);
  console.log("─".repeat(70));

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`[${tc.type.toUpperCase().padEnd(8)}] ${tc.name.padEnd(52)} `);
    const result = await runTest(tc, key);
    if (result.pass) {
      passed++;
      console.log(`PASS  ${result.countNote}`);
    } else {
      failed++;
      console.log(`FAIL  ${result.reason}`);
    }
  }

  console.log("─".repeat(70));
  console.log(`\nResult: ${passed} passed, ${failed} failed / ${TEST_CASES.length} total`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
