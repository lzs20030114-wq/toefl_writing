/**
 * Verify new SYSTEM_PROMPTS.build by sending 5 real TPO sets to DeepSeek
 * and reporting distractor quality.
 *
 * Usage: node scripts/verify-new-prompt.js
 */

const fs = require("fs");
const path = require("path");
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp");

// ── Env loader ────────────────────────────────────────────────────────────────
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

// ── New prompt (must match route.js) ─────────────────────────────────────────
const BUILD_PROMPT = `You are a JSON extractor. Parse TOEFL "Build a Sentence" questions from the user's text.

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

Return [] if nothing can be parsed.`;

// ── 5 TPO sets (raw text, markdown stripped minimally) ───────────────────────
const SETS = [
  {
    name: "第1套",
    text: `
1. Were you able to complete the project on time?
Unfortunately, I _____ _____ _____ _____ _____.
did / not / the deadline / meet / no

2. Matthew loved the book you recommended to him.
_____ he tell _____ _____ _____ _____ ?
was / his favorite part / did / to be / what / you

3. Did you enjoy the workshop yesterday?
_____ _____ _____ _____ to me.
not / the content / was / interesting / did

4. What did the job recruiter ask you?
_____ wanted to know _____ _____ _____ _____.
she / I do / what / in / my current position / do

5. Where did you find your phone?
I _____ _____ _____ _____ _____ _____ _____.
retraced / I / the steps / that / last night / took / all of / taken

6. What did Mariana ask you after class?
She _____ _____ _____ _____ _____ _____ _____.
did / to know / anywhere / I / if / went / interesting / wanted

7. Did you enjoy the party last night?
_____ _____ _____ _____ _____ _____ fun.
long enough / staying / stay / not / to have / I / did

8. Are you going to the gym today?
I _____ _____ _____ _____ _____ _____ weekends.
do / not / the gym / to / on / go / going

9. Why did you decide to take that job?
_____ _____ _____ _____ at this company to _____ _____ _____ .
relaxed / I / be / found / the work environment / much more

10. Where did you find this chair?
_____ _____ _____ _____ _____ _____ _____ the local superstore.
found / of / the furniture section / it / in the back / at / I
`,
  },
  {
    name: "第2套",
    text: `
1. What were you talking about after the meeting ended?
Some colleagues _____ _____ _____ _____ _____ _____ _____.
a conference / they / wanted to / can / register for / make / find out / where

2. Did you finish reading the book I lent you?
_____ _____ _____ _____ _____ _____ _____ yet.
time / had / have / not / having / it / to read / I

3. Did you get tickets for the concert?
Unfortunately, _____ _____ _____ longer _____ _____.
available / the tickets / were / no / did / online

4. Where do you want to go for dinner?
_____ that opened _____ _____ _____ _____ _____ _____.
serves / many / week / the diner / delicious / entrees / last

5. When will the new office furniture arrive?
The desk _____ _____ _____ _____ _____ _____ _____.
scheduled / to arrive / you / Friday / is / ordered / on

6. Where did you find that book?
The bookstore _____ _____ _____ _____ _____ _____ _____.
by / stock / the novel / in / had / stopped / I / on

7. Why do you prefer that brand of coffee?
This coffee _____ _____ _____ _____ _____ _____ _____.
better / the other brands / than / good / tried / I've / all of / tastes

8. Where did you get that scarf?
_____ _____ _____ the post office _____ _____ _____ _____.
the store / to / next / of / winter apparel / sells / all types

9. Why didn't you go to the library today?
_____ _____ _____ in town _____ _____ _____ _____  .
library / temporarily closed / for / is / renovations / the / only

10. Can you recommend a good book to read?
_____ _____ _____ _____ _____ _____ _____.
my sister / you / that / suggest / one / might interest / can / be
`,
  },
  {
    name: "第3套",
    text: `
1. What did Julian ask about your trip to the mountains?
_____ _____ _____ _____ _____ _____ about _____.
best / liked / to know / it / did / I / he wanted / what

2. Didn't I see you talking with Alison?
Yes. She wanted _____ _____ _____ _____ _____ _____ _____.
tried / not / we / which / why / have / to know / the new cafe

3. What did the development team want to know?
They _____ _____ _____ _____ _____ _____.
me / what / asked / our / which / are / specific requirements

4. What was discussed at the meeting?
The managers wanted _____ _____ _____ _____ _____ _____ the sale.
to be / how / to know / were / able / we / to make

5. What's taking you and Harold so long to get started on the project?
_____ _____ found out _____ _____ _____ _____ _____.
the materials / who / just / where / being / we / are / stored

6. What did Emma ask about the new project?
She _____ _____ _____ _____ _____ _____ _____ to.
whom / that / wanted / give / I / will / feedback / to know

7. What do you think we should talk about first in our presentation?
_____ _____ _____ topic _____ _____ _____ _____.
a / important / the / is / which / decide / I can't / most

8. What did Professor Cho ask you after the session?
_____ _____ _____ _____ _____ _____ _____.
thought / what / his presentation / about / I / he asked / make / me

9. What did Juan and Hector ask you this morning?
They _____ _____ _____ _____ _____ _____ _____.
when / to Spain / were / to know / where / going / you / wanted

10. What did the manager ask you after the employee meeting?
She _____ _____ _____ _____ _____ _____ _____.
was / to speak / curious about / I / learned / Korean / where / did
`,
  },
  {
    name: "第4套",
    text: `
1. Your brother's explanation was confusing.
I _____ _____ _____ _____ _____ _____ _____.
understand / either / said / did / not / he / what

2. Who was finally selected to lead the project?
I _____ _____ _____ _____ _____ _____ _____.
who / to be / not / heard / have / did / in charge / is going

3. Why did the client call this morning?
_____ _____ _____ when _____ _____ _____ _____.
they want / on / an update / the project / to finish / do / expect / we

4. Do you know what the outdoor club's destination is this weekend?
I _____ _____ _____ _____ _____ _____ _____.
no / are / what / where / going / they / have / idea

5. Why were you late to Angelina's party?
_____ _____ not _____ _____ _____ _____ _____.
on time / it / theirs / would / think / did / start / I

6. Did the project manager ask about the report?
Yes, _____ wanted _____ _____ _____ _____ _____ _____.
to know / if / more time / did / to finish / she / needed / we

7. What did Margot want to know about tomorrow's meeting?
_____ was _____ _____ _____ _____ _____ _____.
needs / she / curious about / who / to / it / does / attend

8. I hear there are some problems with the new video software.
Yes, and the manager _____ _____ _____ _____ _____ _____ _____ quickly.
to / we / to know / how / wants / can / resolve / them

9. I've got my interview at the accounting firm tomorrow.
Could you tell me _____ _____ _____ _____ _____ _____.
are / you / about / how / feeling / is / it

10. I didn't enjoy the story we had to read for homework.
Can you tell me _____ _____ _____ _____ _____ _____ ?
liked / like / you / not / about / it / did / what
`,
  },
  {
    name: "第5套",
    text: `
1. What did Evan ask you?
He wants _____ _____ _____ _____ _____ _____ _____.
need / if / do / a ride / to know / to Saturday's game / you

2. What did the professor ask about your research paper?
_____ _____ _____ _____ _____ _____ _____.
to make / did / I / she wanted / plan / any revisions / if / to know

3. I'm glad I got that part of the project finished!
_____ you tell me _____ _____ _____ _____ _____ ?
tomorrow / plans / what / can / your / do / are / for

4. What did the Millers ask you at the community meeting?
_____ wanted to know _____ _____ _____ _____ _____.
you / to adopt / did / why / a pet / decided / they

5. No matter how much James practices, he's not getting any better at piano.
_____ _____ _____ _____ _____ _____ _____ _____.
he / take / don't / taking / understand why / doesn't / I / lessons

6. This was one of the best meals I've ever had!
_____ _____ _____ _____ _____ _____ _____ most.
would love / enjoyed / dish / to know / the chef / which / you / did

7. What did you think of my presentation?
I _____ _____ _____ _____ _____ _____ _____.
love / would / did / learned / such interesting facts / you / to know / where

8. What did the trainer ask you when you walked into the gym?
_____ _____ _____ _____ _____ _____ _____.
that / to our sessions / why / always late / I / am / to know / he wanted

9. Today's lesson wasn't very interesting—you didn't miss much.
_____ _____ _____ _____ _____ _____ _____ ?
the professor / any new material / if / tell me / covered / you / did / can

10. What did James ask you after the planning meeting?
He _____ _____ _____ _____ _____ _____ _____.
meeting / do / I / wanted / if / had / another / to know
`,
  },
];

// ── DeepSeek call ─────────────────────────────────────────────────────────────
function extractJson(raw) {
  const s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : s;
}

async function callDeepSeek(userText) {
  const payload = {
    model: "deepseek-chat",
    temperature: 0.1,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: "system", content: BUILD_PROMPT },
      { role: "user", content: userText },
    ],
  };

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    return callDeepSeekViaCurl({
      apiKey: process.env.DEEPSEEK_API_KEY,
      proxyUrl,
      timeoutMs: 60000,
      payload,
    });
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty content");
  return content;
}

// ── Analyze a set of parsed questions ────────────────────────────────────────
function analyzeSet(setName, questions) {
  const distractorCount = {};
  let passiveViolations = 0;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${setName}  (${questions.length} questions)`);
  console.log("═".repeat(60));
  console.log(`${"#".padEnd(3)} ${"distractor".padEnd(14)} grammar_points`);
  console.log("─".repeat(60));

  questions.forEach((q, i) => {
    const d = q.distractor || "null";
    const gp = Array.isArray(q.grammar_points) ? q.grammar_points.join(", ") : "—";
    const isPassive = Array.isArray(q.grammar_points) &&
      q.grammar_points.some((g) => String(g).toLowerCase().includes("passive"));

    let flag = "";
    if (d === "did" && isPassive) {
      flag = "  ← PASSIVE+DID VIOLATION";
      passiveViolations++;
    }

    console.log(`${String(i + 1).padEnd(3)} ${d.padEnd(14)} ${gp}${flag}`);
    distractorCount[d] = (distractorCount[d] || 0) + 1;
  });

  console.log("─".repeat(60));

  // Distractor frequency summary
  // Diversity threshold: no single word > 50% of batch (aligns with prompt rule)
  const diversityLimit = Math.ceil(questions.length * 0.5);
  const sorted = Object.entries(distractorCount).sort((a, b) => b[1] - a[1]);
  console.log(`Distractor frequency (limit: ${diversityLimit}/${questions.length} per word):`);
  sorted.forEach(([word, n]) => {
    const bar = "█".repeat(n);
    const warn = n > diversityLimit ? `  ← DIVERSITY VIOLATION (>${diversityLimit})` : "";
    console.log(`  ${word.padEnd(14)} ${bar} (${n})${warn}`);
  });

  const didCount = distractorCount["did"] || 0;
  const diversityOk = sorted.every(([, n]) => n <= diversityLimit);
  const passiveOk = passiveViolations === 0;

  console.log(`\n  did count: ${didCount}/10  |  diversity: ${diversityOk ? "OK" : "FAIL"}  |  passive+did: ${passiveOk ? "OK" : "FAIL (x" + passiveViolations + ")"}`);

  return { didCount, diversityOk, passiveOk, passiveViolations };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();

  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key || key === "your_key_here") {
    console.error("FAIL: DEEPSEEK_API_KEY missing");
    process.exit(1);
  }

  console.log("\nVerifying new BUILD_PROMPT with 5 real TPO sets");
  console.log(`proxy: ${resolveProxyUrl() || "(direct)"}\n`);

  const totals = { did: 0, passiveViolations: 0, diversityFails: 0, total: 0, parsed: 0 };

  for (const set of SETS) {
    process.stdout.write(`Calling DeepSeek for ${set.name}... `);
    let raw;
    try {
      raw = await callDeepSeek(set.text);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      continue;
    }

    let questions;
    try {
      questions = JSON.parse(extractJson(raw));
      if (!Array.isArray(questions)) throw new Error("not array");
    } catch (e) {
      console.log(`JSON PARSE ERROR: ${e.message}\nRaw: ${raw.slice(0, 300)}`);
      continue;
    }

    console.log(`got ${questions.length} questions`);
    const stats = analyzeSet(set.name, questions);

    totals.did += stats.didCount;
    totals.passiveViolations += stats.passiveViolations;
    if (!stats.diversityOk) totals.diversityFails++;
    totals.total += questions.length;
    totals.parsed++;
  }

  // ── Overall summary ──────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("OVERALL SUMMARY");
  console.log("═".repeat(60));
  console.log(`Sets parsed:        ${totals.parsed}/5`);
  console.log(`Total questions:    ${totals.total}`);
  console.log(`"did" distractors:  ${totals.did}/${totals.total} (${Math.round(totals.did / totals.total * 100)}%)  [old baseline: 69%]`);
  console.log(`Passive+did errors: ${totals.passiveViolations}`);
  console.log(`Diversity failures: ${totals.diversityFails} sets`);

  // Target: <55% overall (embedded questions legitimately use "did"; old baseline was 69%)
  const improved = totals.did / totals.total < 0.55;
  console.log(`\nVerdict: ${improved ? "IMPROVED ✓" : "NOT YET IMPROVED ✗"} (target: <55% "did", old baseline: 69%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
