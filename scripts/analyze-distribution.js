/**
 * Compare answer-pattern distribution: generated bank vs TPO source.
 * Run: node scripts/analyze-distribution.js
 */
const fs = require("fs");
const path = require("path");

// ---------- Generated bank ----------
const data = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../data/buildSentence/questions.json"), "utf8")
);
const all = data.question_sets.flatMap((s) => s.questions);

function genCategory(answer) {
  const a = answer.toLowerCase();
  // Third-person reporting: X wanted/asked/wondered/needed/curious + wh/if
  if (/\b(wanted to know|asked me|asked him|asked her|asked us|was curious|were curious|needed to know|was wondering|were wondering|wants to know|needs to know)\b/.test(a))
    return "3rd-person reporting (X wanted to know…)";
  // 1st-person embedded: I have no idea / I don't understand / I found out
  if (/\b(have no idea|had no idea|don't understand|didn't understand|found out|would love to know)\b/.test(a))
    return "1st-person embedded (I have no idea / found out…)";
  // Interrogative frame: Can/Could you tell me
  if (/^(can you tell me|could you tell me)/i.test(a))
    return "interrogative frame (Can you tell me…)";
  // Pure negation
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|has not|hasn't|am not|are not)\b/.test(a))
    return "negation (I did not / have not…)";
  // Relative/contact clause: "The X I/you/he…" or "X that…"
  if (/\bthe \w+.* (i |you |he |she |we |they )|\bthat (i |you |he |she |we |they )/i.test(a))
    return "relative/contact clause (the X I…)";
  return "direct statement";
}

const genCounts = {};
all.forEach((q) => {
  const cat = genCategory(q.answer);
  genCounts[cat] = (genCounts[cat] || 0) + 1;
});

const total = all.length;
console.log(`\n=== Generated Bank (${total} questions) ===`);
Object.entries(genCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => {
    const pct = Math.round((v / total) * 100);
    console.log(`  ${String(v).padStart(3)}  ${String(pct).padStart(3)}%   ${k}`);
  });

// ---------- TPO source (manual ground truth from tpo_source.md, 60 questions) ----------
// Reconstructed answer patterns from the 6 sets in tpo_source.md
const tpoPatterns = [
  // Set 1
  "negation",               // Unfortunately I did not meet the deadline
  "interrogative frame",    // Did he tell you what his favorite part was?
  "negation",               // The content was not interesting to me
  "3rd-person reporting",   // She wanted to know what I do in my current position
  "relative/contact clause",// I retraced all the steps that I took last night
  "3rd-person reporting",   // She wanted to know if I went anywhere interesting
  "negation",               // I did not stay long enough to have fun
  "negation",               // I do not go to the gym on weekends
  "direct statement",       // I found the work environment at this company to be much more relaxed
  "direct statement",       // I found it in the back of the furniture section

  // Set 2
  "3rd-person reporting",   // Some colleagues wanted to find out where they could register
  "negation",               // I had not had time to read it yet
  "negation",               // Unfortunately the tickets were no longer available
  "relative/contact clause",// The diner that opened last week serves many delicious entrees
  "relative/contact clause",// The desk you ordered is scheduled to arrive on Friday
  "relative/contact clause",// The bookstore I stopped by had the novel in stock
  "relative/contact clause",// This coffee tastes better than all the other brands I've tried
  "direct statement",       // The store next to the post office sells all types of winter apparel
  "direct statement",       // The library is only temporarily closed for renovations
  "direct statement",       // I can suggest one that my sister might be interested in

  // Set 3
  "3rd-person reporting",   // He wanted to know what I liked best about it
  "3rd-person reporting",   // Yes, she wanted to know why we have not tried the new cafe
  "3rd-person reporting",   // They asked me what our specific requirements are
  "3rd-person reporting",   // The managers wanted to know how we were able to make the sale
  "1st-person embedded",    // We just found out where the materials are being stored
  "3rd-person reporting",   // She wanted to know whom I will give feedback to
  "direct statement",       // I can't decide which is the most important topic
  "3rd-person reporting",   // He asked me what I thought about his presentation
  "3rd-person reporting",   // They wanted to know when you were going to Spain
  "3rd-person reporting",   // She was curious about where I learned to speak Korean

  // Set 4
  "1st-person embedded",    // I did not understand what he said (negation + embedded)
  "1st-person embedded",    // I have not heard who is going to be in charge
  "3rd-person reporting",   // They want to know when we expect the project to finish
  "1st-person embedded",    // I have no idea where they are going
  "negation",               // I did not think it would start on time
  "3rd-person reporting",   // Yes, she wanted to know if we needed more time to finish
  "3rd-person reporting",   // She was curious about who needs to attend it
  "3rd-person reporting",   // The manager wants to know how we can resolve them quickly
  "interrogative frame",    // Could you tell me how you are feeling about it
  "interrogative frame",    // Can you tell me what you did not like about it?

  // Set 5
  "3rd-person reporting",   // He wants to know if you need a ride to Saturday's game
  "3rd-person reporting",   // She wanted to know if I plan to make any revisions
  "interrogative frame",    // Can you tell me what your plans are for tomorrow?
  "3rd-person reporting",   // They wanted to know why you decided to adopt a pet
  "1st-person embedded",    // I don't understand why he doesn't take lessons
  "1st-person embedded",    // I would love to know which dish you enjoyed most
  "1st-person embedded",    // I would love to know where you learned such interesting facts
  "3rd-person reporting",   // He wanted to know why I am always late to our sessions
  "interrogative frame",    // Can you tell me if the professor covered any new material?
  "3rd-person reporting",   // He wanted to know if I had another meeting

  // Set 6
  "negation",               // I have not gotten tickets for the event yet
  "negation",               // I could not make it due to a prior engagement
  "3rd-person reporting",   // He needed to know why I requested to work remotely
  "negation",               // I am not able to attend due to a prior commitment
  "negation",               // I am not accustomed to spicy food like that
  "3rd-person reporting",   // She was wondering if I found the exhibit inspiring
  "3rd-person reporting",   // She wanted to know where it was held
  "3rd-person reporting",   // He wanted to know where all the accountants had gone
  "interrogative frame",    // Did he ask you why you chose this particular career?
  "3rd-person reporting",   // He wants to know what our biggest concerns are
];

const tpoCounts = {};
tpoPatterns.forEach((p) => { tpoCounts[p] = (tpoCounts[p] || 0) + 1; });

const tpoTotal = tpoPatterns.length;
console.log(`\n=== TPO Source (${tpoTotal} questions, 6 sets) ===`);
Object.entries(tpoCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => {
    const pct = Math.round((v / tpoTotal) * 100);
    console.log(`  ${String(v).padStart(3)}  ${String(pct).padStart(3)}%   ${k}`);
  });

// ---------- Gap analysis ----------
console.log("\n=== Gap (Generated - TPO) ===");
const allKeys = new Set([...Object.keys(genCounts), ...Object.keys(tpoCounts)]);
allKeys.forEach((k) => {
  const g = Math.round(((genCounts[k] || 0) / total) * 100);
  const t = Math.round(((tpoCounts[k] || 0) / tpoTotal) * 100);
  const diff = g - t;
  const flag = Math.abs(diff) >= 10 ? " ⚠" : "";
  console.log(`  ${k}`);
  console.log(`    Generated: ${g}%   TPO: ${t}%   Gap: ${diff > 0 ? "+" : ""}${diff}%${flag}`);
});
