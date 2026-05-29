#!/usr/bin/env node
// Falsification test for the "move-the-anchor" hypothesis.
//
// Hypothesis: real TPO answers frequently HAVE a person subject (he/she/I/
// they/name), but deliberately leave that person as a DRAGGABLE CHUNK and
// give a NON-subject word as prefilled. If true, our fix direction (move
// prefilled off the subject) is correct.
//
// Discriminating evidence:
//   - If TPO "answer has person" is HIGH (~65%) but "person is the given/
//     prefilled" is LOW (~35%) → hypothesis CONFIRMED (TPO hides the person
//     in chunks). Our fix is right.
//   - If TPO "answer has person" is itself ~35% → hypothesis WRONG. TPO just
//     writes fewer person-subject sentences; fix is about answer content.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8");
const lines = raw.split(/\r?\n/);

const items = [];
let cur = null;
for (const line of lines) {
  const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
  if (qm) {
    if (cur && cur.template) items.push(cur);
    cur = { num: cur ? cur.num + 1 : 1, prompt: qm[2], template: "", chunks: "" };
    continue;
  }
  if (!cur) continue;
  if (line.includes("\\_")) cur.template += (cur.template ? " " : "") + line.trim();
  else if (line.includes(" / ") && !line.startsWith("__")) cur.chunks = line.trim();
}
if (cur && cur.template) items.push(cur);

const PRONOUN = /^(i|he|she|they|we|i'm|i've|i'll|i'd)$/i;  // subject pronouns (exclude "you" — usually addressee not subject)
const COMMON_CAP = new Set(["unfortunately","yes","no","some","the","this","that","these","those","many","few","several","all","most","every","each","could","would","should","can","will","did","do","does","is","was","were","have","has","yet","fun","when","why","what","where","how","to","in","on","at"]);

function isPersonWord(w) {
  const c = w.replace(/[^A-Za-z']/g, "");
  if (!c) return false;
  if (PRONOUN.test(c)) return true;
  if (/^[A-Z][a-z]+$/.test(c) && !COMMON_CAP.has(c.toLowerCase())) return true; // proper name
  return false;
}

function getGivenSegments(template) {
  let t = template.replace(/\\_/g, "_").replace(/\\\./g, ".").replace(/\s+/g, " ").trim();
  t = t.replace(/__[^_]*__/g, " ").replace(/\s+/g, " ").trim();
  return t.split(/_{2,}/).map((p) => p.replace(/[.?!,;:]/g, "").trim()).filter(Boolean);
}

let answerHasPerson = 0;
let personInGiven = 0;
let personInChunksOnly = 0;
const detail = [];

for (const it of items) {
  const givenSegs = getGivenSegments(it.template);
  const givenWords = givenSegs.join(" ").split(/\s+/).filter(Boolean);
  const chunkWords = it.chunks.split(" / ").join(" ").split(/\s+/).filter(Boolean);

  const personInGivenWords = givenWords.some(isPersonWord);
  const personInChunkWords = chunkWords.some(isPersonWord);
  const hasPerson = personInGivenWords || personInChunkWords;

  if (hasPerson) {
    answerHasPerson++;
    if (personInGivenWords) personInGiven++;
    else personInChunksOnly++;
  }
  detail.push({
    prompt: it.prompt.slice(0, 40),
    given: givenSegs.join(" + ").slice(0, 40),
    hasPerson,
    where: personInGivenWords ? "GIVEN" : personInChunkWords ? "chunk" : "none",
  });
}

const N = items.length;
console.log("=== Anchor hypothesis falsification test (60 TPO items) ===\n");
console.log(`TPO answers that HAVE a person subject (anywhere):  ${answerHasPerson}/${N} = ${Math.round(answerHasPerson / N * 100)}%`);
console.log(`  ...of those, person is the GIVEN/prefilled:        ${personInGiven}/${answerHasPerson} = ${Math.round(personInGiven / answerHasPerson * 100)}%`);
console.log(`  ...of those, person is hidden in DRAGGABLE chunks:  ${personInChunksOnly}/${answerHasPerson} = ${Math.round(personInChunksOnly / answerHasPerson * 100)}%`);
console.log("");
console.log(`Person-as-prefilled across ALL items:                ${personInGiven}/${N} = ${Math.round(personInGiven / N * 100)}%`);
console.log("");
console.log("VERDICT:");
const answerPersonPct = answerHasPerson / N;
const givenPersonPct = personInGiven / N;
if (answerPersonPct >= 0.55 && givenPersonPct <= 0.45) {
  console.log("  ✅ HYPOTHESIS CONFIRMED: TPO answers are person-heavy (" + Math.round(answerPersonPct*100) + "%)");
  console.log("     but TPO gives the person as prefilled only " + Math.round(givenPersonPct*100) + "% of the time.");
  console.log("     => TPO deliberately hides the person subject in draggable chunks.");
  console.log("     => Our fix direction (move prefilled OFF the subject) is CORRECT.");
} else if (answerPersonPct < 0.45) {
  console.log("  ❌ HYPOTHESIS WRONG: TPO answers themselves are only " + Math.round(answerPersonPct*100) + "% person-subject.");
  console.log("     => The fix is about ANSWER CONTENT / prompt mix, not anchor placement.");
} else {
  console.log("  ⚠️ INCONCLUSIVE: answer-person " + Math.round(answerPersonPct*100) + "%, given-person " + Math.round(givenPersonPct*100) + "%");
}

console.log("\n=== Detail (first 30) ===");
detail.slice(0, 30).forEach((d, i) => {
  console.log(`  ${String(i + 1).padStart(2)} [${d.where.padEnd(5)}] given="${d.given}"  prompt="${d.prompt}"`);
});
