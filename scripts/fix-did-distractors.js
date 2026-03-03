/**
 * One-time script: fix distractor="did" in data/buildSentence/questions.json
 *
 * Strategy:
 *   - passive voice questions  → replace directly with "gets" (no AI needed)
 *   - all other "did" questions → ask DeepSeek for a better distractor
 *
 * Usage: node scripts/fix-did-distractors.js
 * Creates a backup at questions.json.bak before writing.
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

// ── DeepSeek call ─────────────────────────────────────────────────────────────
async function callDeepSeek(prompt) {
  const payload = {
    model: "deepseek-chat",
    temperature: 0.2,
    max_tokens: 16,
    stream: false,
    messages: [{ role: "user", content: prompt }],
  };

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) {
    return callDeepSeekViaCurl({
      apiKey: process.env.DEEPSEEK_API_KEY,
      proxyUrl,
      timeoutMs: 30000,
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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return content.trim().toLowerCase().split(/\s+/)[0]; // keep only the first word
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();

  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key || key === "your_key_here") {
    console.error("FAIL: DEEPSEEK_API_KEY missing or placeholder");
    process.exit(1);
  }

  const dataPath = path.join(process.cwd(), "data", "buildSentence", "questions.json");
  const bakPath = dataPath + ".bak";

  const raw = fs.readFileSync(dataPath, "utf8");
  const data = JSON.parse(raw);

  // Collect all questions across all sets
  const allQuestions = [];
  for (const set of data.question_sets || []) {
    for (const q of set.questions || []) {
      allQuestions.push(q);
    }
  }

  const didQuestions = allQuestions.filter((q) => q.distractor === "did");
  console.log(`\nTotal questions: ${allQuestions.length}`);
  console.log(`distractor="did" count: ${didQuestions.length}\n`);

  if (didQuestions.length === 0) {
    console.log("Nothing to fix.");
    return;
  }

  // Backup original
  fs.writeFileSync(bakPath, raw, "utf8");
  console.log(`Backup written to ${path.basename(bakPath)}\n`);

  let ruleFixed = 0;
  let aiFixed = 0;
  let aiSkipped = 0;

  for (const q of didQuestions) {
    const grammarPoints = Array.isArray(q.grammar_points) ? q.grammar_points : [];
    const isPassive = grammarPoints.some((g) =>
      String(g).toLowerCase().includes("passive")
    );

    if (isPassive) {
      // Rule-based: passive voice → "gets"
      q.distractor = "gets";
      ruleFixed++;
      console.log(`[RULE] ${q.id}: passive voice → "gets"`);
    } else {
      // AI-based: ask DeepSeek for a better word
      const prompt =
        `Answer: "${q.answer}"\n` +
        `Grammar points: ${grammarPoints.join(", ") || "general"}\n` +
        `Current distractor: "did" (wrong for this sentence).\n` +
        `Give ONE single word that is a plausible but grammatically wrong distractor ` +
        `testing the grammar of this sentence. Reply with just the word, nothing else.`;

      try {
        const word = await callDeepSeek(prompt);
        // Sanity check: must be a single word, not already in the answer
        const answerLower = q.answer.toLowerCase();
        if (word && /^[a-z']+$/.test(word) && !answerLower.includes(` ${word} `) && word !== "did") {
          console.log(`[AI]   ${q.id}: "${q.distractor}" → "${word}"`);
          q.distractor = word;
          aiFixed++;
        } else {
          console.log(`[SKIP] ${q.id}: AI returned "${word}" (unusable), keeping "did"`);
          aiSkipped++;
        }
      } catch (e) {
        console.error(`[ERR]  ${q.id}: ${e.message}`);
        aiSkipped++;
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Write updated file
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 4), "utf8");

  // Count remaining "did" distractors
  const remaining = allQuestions.filter((q) => q.distractor === "did").length;

  console.log("\n─".repeat(50));
  console.log(`Rule-fixed (passive): ${ruleFixed}`);
  console.log(`AI-fixed:             ${aiFixed}`);
  console.log(`Skipped/errors:       ${aiSkipped}`);
  console.log(`\ndistractor="did" remaining: ${remaining}`);
  console.log(`questions.json updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
