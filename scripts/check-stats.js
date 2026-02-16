const data = require("../data/buildSentence/questions.json");

const TPO_TARGETS = {
  statements: "92% (9-10/10)",
  distractors: "88% (7-9/10)",
  embedded: "63% (5-8/10)",
  negation: "20% (2-4/10)",
  difficulty: "1/7/2",
};

console.log("=== TPO Alignment Report ===");
console.log("TPO targets:", JSON.stringify(TPO_TARGETS, null, 2));
console.log("");

let allStats = { stmt: 0, dist: 0, swDist: 0, emb: 0, neg: 0, contact: 0, total: 0, singleW: 0, multiW: 0, words: 0, chunks: 0, pf: 0 };

data.question_sets.forEach((s) => {
  const qs = s.questions;
  const stmt = qs.filter((q) => q.has_question_mark === false).length;
  const dist = qs.filter((q) => q.distractor).length;
  const swDist = qs.filter((q) => q.distractor && !q.distractor.includes(" ")).length;
  const emb = qs.filter((q) => q.grammar_points.some((g) => /embedded|indirect/i.test(g))).length;
  const neg = qs.filter((q) => q.grammar_points.some((g) => /negation/i.test(g))).length;
  const contact = qs.filter((q) => q.grammar_points.some((g) => /contact/i.test(g))).length;
  const pf = qs.filter((q) => q.prefilled.length > 0).length;

  let singleW = 0, multiW = 0, totalWords = 0, totalChunks = 0;
  qs.forEach((q) => {
    const eff = q.chunks.filter((c) => c !== q.distractor);
    totalChunks += eff.length;
    totalWords += q.answer.replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean).length;
    eff.forEach((c) => { c.includes(" ") ? multiW++ : singleW++; });
  });

  console.log(`Set ${s.set_id}: stmt=${stmt}/10 dist=${dist}(allSingleWord=${swDist === dist}) emb=${emb} neg=${neg} contact=${contact} avgChk=${(totalChunks / 10).toFixed(1)} avgWrd=${(totalWords / 10).toFixed(1)} singleWordChunk=${Math.round((singleW / (singleW + multiW)) * 100)}% prefilled=${pf}`);

  allStats.stmt += stmt; allStats.dist += dist; allStats.swDist += swDist;
  allStats.emb += emb; allStats.neg += neg; allStats.contact += contact;
  allStats.total += qs.length; allStats.singleW += singleW; allStats.multiW += multiW;
  allStats.words += totalWords; allStats.chunks += totalChunks; allStats.pf += pf;
});

const n = allStats.total;
console.log("");
console.log("=== Aggregate ===");
console.log(`Statements: ${Math.round((allStats.stmt / n) * 100)}% (target 92%)`);
console.log(`Distractors: ${Math.round((allStats.dist / n) * 100)}% (target 88%)`);
console.log(`All single-word distractors: ${allStats.swDist === allStats.dist ? "YES" : "NO"}`);
console.log(`Embedded questions: ${Math.round((allStats.emb / n) * 100)}% (target 63%)`);
console.log(`Negation: ${Math.round((allStats.neg / n) * 100)}% (target 20%)`);
console.log(`Contact clauses: ${allStats.contact}/${n}`);
console.log(`Avg effective chunks: ${(allStats.chunks / n).toFixed(1)} (target mode=7, range 4-8)`);
console.log(`Avg answer words: ${(allStats.words / n).toFixed(1)} (target 9-13)`);
console.log(`Single-word chunk ratio: ${Math.round((allStats.singleW / (allStats.singleW + allStats.multiW)) * 100)}% (TPO ~77%)`);
console.log(`Prefilled items: ${Math.round((allStats.pf / n) * 100)}% (target 60%)`);

// Distractor word frequency
const distWords = {};
data.question_sets.forEach((s) => {
  s.questions.forEach((q) => {
    if (q.distractor) {
      const d = q.distractor.toLowerCase();
      distWords[d] = (distWords[d] || 0) + 1;
    }
  });
});
console.log("");
console.log("=== Distractor distribution ===");
Object.entries(distWords).sort((a, b) => b[1] - a[1]).forEach(([w, c]) => {
  console.log(`  ${w}: ${c} (${Math.round((c / allStats.dist) * 100)}%)`);
});
