#!/usr/bin/env node
/**
 * Review "same words, different order" wrong answers using DeepSeek AI.
 * For each unique wrong answer that uses the exact same words as the correct answer
 * (just reordered), ask AI whether the user's sentence is grammatically correct
 * and semantically equivalent.
 *
 * Usage:
 *   node scripts/review-alternate-orders.js              # review & output recommendations
 *   node scripts/review-alternate-orders.js --apply      # also write to questions.json
 */

const fs = require("fs");
const { resolve } = require("path");
const { createClient } = require("@supabase/supabase-js");
const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp");
const { renderResponseSentence } = require("../lib/questionBank/renderResponseSentence");

// ── Load env ──
const envText = fs.readFileSync(resolve(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const apiKey = process.env.DEEPSEEK_API_KEY;
const apply = process.argv.includes("--apply");

// ── Load question bank ──
const BANK_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const bankData = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
const qById = new Map();
const qByAnswer = new Map();
for (const set of bankData.question_sets || []) {
  for (const q of set.questions || []) {
    qById.set(q.id, q);
    qByAnswer.set((q.answer || "").trim().toLowerCase(), q);
  }
}

function normalize(s) {
  return s.replace(/[?.!,]/g, "").trim().toLowerCase().split(/\s+/).sort().join(" ");
}

// ── Step 1: Collect candidate wrong answers ──
async function collectCandidates() {
  const { data: bsRows } = await supabase
    .from("sessions").select("id,user_code,details")
    .eq("type", "bs").order("date", { ascending: false }).limit(5000);

  const { data: mockRows } = await supabase
    .from("sessions").select("id,user_code,details,score")
    .eq("type", "mock").order("date", { ascending: false }).limit(2000);

  // Collect unique (questionId, userAnswer) pairs that are same-words-different-order
  const seen = new Map(); // key: qId + "|" + userAnswer.lower → { q, userAnswer, count }

  function processDetail(d) {
    if (!d || d.isCorrect) return;
    const ua = (d.userAnswer || "").trim();
    const ca = (d.correctAnswer || "").trim();
    if (!ua || ua === "(no answer)") return;
    if (normalize(ca) !== normalize(ua)) return; // different words → truly wrong

    const q = qByAnswer.get(ca.toLowerCase());
    if (!q) return;

    // Skip if already accepted by existing acceptedAnswerOrders
    const existing = q.acceptedAnswerOrders || [];
    for (const order of existing) {
      const { userSentenceFull } = renderResponseSentence(q, order);
      if (userSentenceFull && userSentenceFull.trim().toLowerCase() === ua.toLowerCase()) return;
    }

    const key = q.id + "|" + ua.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { q, userAnswer: ua, count: 0 });
    }
    seen.get(key).count++;
  }

  for (const row of bsRows || []) {
    for (const d of (row.details || [])) processDetail(d);
  }
  for (const row of mockRows || []) {
    const tasks = Array.isArray(row?.score?.tasks) ? row.score.tasks
      : Array.isArray(row?.details?.tasks) ? row.details.tasks : [];
    for (const t of tasks) {
      if (String(t?.taskId || "") !== "build-sentence") continue;
      for (const d of (t?.meta?.details || [])) processDetail(d);
    }
  }

  return [...seen.values()].sort((a, b) => b.count - a.count);
}

// ── Step 2: Batch AI review ──
async function reviewBatch(candidates) {
  // Group by question to send fewer API calls
  const byQuestion = new Map();
  for (const c of candidates) {
    const qId = c.q.id;
    if (!byQuestion.has(qId)) byQuestion.set(qId, { q: c.q, answers: [] });
    byQuestion.get(qId).answers.push(c.userAnswer);
  }

  const results = []; // { qId, userAnswer, valid, reason }

  let i = 0;
  const total = byQuestion.size;
  for (const [qId, entry] of byQuestion) {
    i++;
    const q = entry.q;
    const correctSentence = renderResponseSentence(q).correctSentenceFull;

    const prompt = `You are a TOEFL grammar expert. For each numbered alternative sentence below, determine if it is:
1. Grammatically correct standard English (not informal/spoken)
2. Has the same meaning as the correct sentence

Context/prompt: "${q.prompt}"
Correct sentence: "${correctSentence}"

Alternative sentences:
${entry.answers.map((a, idx) => `${idx + 1}. "${a}"`).join("\n")}

For EACH alternative, respond with exactly one line in this format:
<number>|<VALID or INVALID>|<brief reason>

Rules:
- Embedded questions must use statement word order (e.g. "where I can find" NOT "where can I find")
- Relative clauses must attach to the correct noun
- Adverb/prepositional phrase position changes are acceptable IF the meaning is preserved
- Be strict: if the sentence sounds unnatural or changes emphasis significantly, mark INVALID`;

    try {
      const response = await callDeepSeekViaCurl({
        apiKey,
        payload: {
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 500,
        },
        timeoutMs: 30000,
      });

      // Parse response
      for (const line of response.split("\n")) {
        const m = line.match(/^(\d+)\s*\|\s*(VALID|INVALID)\s*\|\s*(.+)/i);
        if (!m) continue;
        const idx = parseInt(m[1]) - 1;
        if (idx >= 0 && idx < entry.answers.length) {
          results.push({
            qId,
            userAnswer: entry.answers[idx],
            valid: m[2].toUpperCase() === "VALID",
            reason: m[3].trim(),
          });
        }
      }
      console.log(`  [${i}/${total}] ${qId}: ${entry.answers.length} answers reviewed`);
    } catch (e) {
      console.error(`  [${i}/${total}] ${qId}: ERROR - ${e.message}`);
    }

    // Rate limit: small delay between calls
    if (i < total) await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

// ── Step 3: Generate acceptedAnswerOrders for valid alternates ──
function generateOrders(results) {
  const validByQ = new Map();
  for (const r of results) {
    if (!r.valid) continue;
    if (!validByQ.has(r.qId)) validByQ.set(r.qId, []);
    validByQ.get(r.qId).push(r);
  }

  const updates = []; // { qId, newOrders: [[...chunks]], newReasons: [...] }

  for (const [qId, valids] of validByQ) {
    const q = qById.get(qId);
    if (!q) continue;

    const existingOrders = q.acceptedAnswerOrders || [];
    const existingReasons = q.acceptedReasons || [];
    const newOrders = [...existingOrders];
    const newReasons = [...existingReasons];

    for (const v of valids) {
      // We need to figure out what chunk order produces this user answer.
      // Try all permutations... but that's expensive. Instead, reverse-engineer:
      // The user answer is a reordering of chunks. We need to find which order of
      // q.chunks produces v.userAnswer via renderResponseSentence.
      //
      // Brute force for small chunk arrays (6-8 chunks is manageable with smart search)
      const targetLower = v.userAnswer.trim().toLowerCase();
      const chunks = q.chunks || [];

      // Try: for each possible ordering, check if renderResponseSentence matches
      // But full permutation is too expensive. Instead, use a greedy approach:
      // parse the user answer into words, then match chunks to positions.
      const found = findChunkOrder(q, targetLower);
      if (found) {
        // Check not already in existing orders
        const orderStr = JSON.stringify(found);
        const isDup = newOrders.some(o => JSON.stringify(o) === orderStr);
        if (!isDup) {
          newOrders.push(found);
          newReasons.push(v.reason);
        }
      } else {
        console.log(`  WARNING: Could not reverse-engineer chunk order for ${qId}: "${v.userAnswer}"`);
      }
    }

    if (newOrders.length > existingOrders.length) {
      updates.push({ qId, newOrders, newReasons });
    }
  }

  return updates;
}

function findChunkOrder(q, targetSentenceLower) {
  const chunks = q.chunks || [];
  // Filter out distractor chunks by trying permutations without them
  // The number of slots = answer word count - prefilled word count
  // We need to pick (chunks.length - distractors) chunks and order them

  // Simple approach: try all permutations up to 8 chunks
  if (chunks.length > 9) return null; // too many

  const indices = chunks.map((_, i) => i);

  // Generate permutations of size (chunks.length - 1) and (chunks.length)
  // since there may be 0 or 1 distractor
  for (let skip = -1; skip < chunks.length; skip++) {
    const selected = skip === -1 ? indices : indices.filter(i => i !== skip);
    const perms = permutations(selected);
    for (const perm of perms) {
      const order = perm.map(i => chunks[i]);
      const { userSentenceFull } = renderResponseSentence(q, order);
      if (userSentenceFull && userSentenceFull.trim().toLowerCase() === targetSentenceLower) {
        return order;
      }
    }
  }
  return null;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  // For arrays > 7, use iterative approach with early termination
  if (arr.length > 7) return []; // too expensive
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

// ── Main ──
async function main() {
  console.log("Step 1: Collecting candidate wrong answers...\n");
  const candidates = await collectCandidates();
  console.log(`Found ${candidates.length} unique (question, userAnswer) pairs to review.\n`);

  if (candidates.length === 0) {
    console.log("Nothing to review.");
    return;
  }

  console.log("Step 2: AI review...\n");
  const results = await reviewBatch(candidates);

  const valid = results.filter(r => r.valid);
  const invalid = results.filter(r => !r.valid);
  console.log(`\nAI verdict: ${valid.length} VALID, ${invalid.length} INVALID\n`);

  if (valid.length > 0) {
    console.log("=== VALID alternates ===");
    for (const v of valid) {
      const q = qById.get(v.qId);
      console.log(`  ${v.qId}: "${v.userAnswer}"`);
      console.log(`    correct: "${q?.answer}"`);
      console.log(`    reason: ${v.reason}`);
    }
  }

  if (valid.length === 0) {
    console.log("No valid alternates found. All wrong answers are genuinely incorrect.");
    return;
  }

  console.log("\nStep 3: Generating acceptedAnswerOrders...\n");
  const updates = generateOrders(results);
  console.log(`Updates to apply: ${updates.length} questions\n`);

  for (const u of updates) {
    const q = qById.get(u.qId);
    console.log(`  ${u.qId}: +${u.newOrders.length - (q.acceptedAnswerOrders || []).length} new orders`);
    for (let i = (q.acceptedAnswerOrders || []).length; i < u.newOrders.length; i++) {
      console.log(`    order: ${JSON.stringify(u.newOrders[i])}`);
      console.log(`    reason: ${u.newReasons[i]}`);
    }
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to write changes to questions.json.");
    return;
  }

  // Apply to bank
  for (const u of updates) {
    const q = qById.get(u.qId);
    q.acceptedAnswerOrders = u.newOrders;
    q.acceptedReasons = u.newReasons;
  }

  fs.writeFileSync(BANK_PATH, JSON.stringify(bankData, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${updates.length} question updates to questions.json.`);
  console.log("Run scripts/fix-session-scores.mjs --apply to update historical session scores.");
}

main().catch(e => { console.error(e); process.exit(1); });
