#!/usr/bin/env node
// Integrate the 20 official ETS Build-a-Sentence items (parsed from the 2026
// full-length practice tests) into the project:
//   1) append them to data/buildSentence/tpo_source.md in the markdown format
//      that scripts/ops/analyze-tpo-bs.mjs + the etsProfile derivation parse,
//      so the calibration statistics are computed over the larger set.
//   2) write data/buildSentence/tpo_official.json — a higher-fidelity record
//      that also keeps the verified ANSWER and the identified DISTRACTOR(s).
import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const official = JSON.parse(readFileSync(resolve(root, ".research/collected/bs_official.json"), "utf8"));

const norm = (w) => w.toLowerCase().replace(/[^a-z']/g, "");
function findDistractors(chunks, answer) {
  // a chunk is a distractor if its words are not all present (as a run) in the answer
  const ansWords = answer.split(/\s+/).map(norm).filter(Boolean);
  const used = [...ansWords];
  const distractors = [];
  for (const ch of chunks) {
    const cw = ch.split(/\s+/).map(norm).filter(Boolean);
    // greedily try to consume this chunk's words from `used`
    const idx = used.findIndex((_, i) => cw.every((w, k) => used[i + k] === w));
    if (idx >= 0) used.splice(idx, cw.length);
    else distractors.push(ch);
  }
  return distractors;
}

// ---- structured tpo_official.json ----
let serial = 0;
const structured = official.map((it) => {
  serial += 1;
  const distractors = it.answer ? findDistractors(it.chunks, it.answer) : [];
  return {
    id: `bs_official_${String(serial).padStart(2, "0")}`,
    tier: "official",
    source: it.source_url,
    source_label: it.source_test,
    prompt: it.prompt,
    blanks: it.blanks,
    chunks: it.chunks,
    answer: it.answer,
    distractors,
  };
});
writeFileSync(
  resolve(root, "data/buildSentence/tpo_official.json"),
  JSON.stringify(structured, null, 2),
);
console.log(`Wrote data/buildSentence/tpo_official.json (${structured.length} items)`);
const distHist = {};
for (const s of structured) distHist[s.distractors.length] = (distHist[s.distractors.length] || 0) + 1;
console.log("Distractor-count histogram:", distHist);

// ---- append to tpo_source.md ----
const mdPath = resolve(root, "data/buildSentence/tpo_source.md");
let md = readFileSync(mdPath, "utf8");
const MARKER = "Official ETS — TOEFL iBT 2026 Full-Length Practice Test";
if (md.includes(MARKER)) {
  console.log("tpo_source.md already contains official items — skipping append.");
} else {
  // group by source test
  const byTest = {};
  for (const it of official) (byTest[it.source_test] ||= []).push(it);
  let block = "\n";
  for (const [test, items] of Object.entries(byTest)) {
    block += `\n(Official ETS — ${test} — Build a Sentence, with answer key)\n\n`;
    items.forEach((it, i) => {
      // blanks line: convert "_____" to escaped form to match existing file style
      const blanksLine = it.blanks.replace(/_____/g, "\\_\\_\\_\\_\\_");
      block += `__${i + 1}.__ ${it.prompt}\n`;
      block += `${blanksLine}\n`;
      block += `${it.chunks.join(" / ")}\n\n`;
    });
  }
  appendFileSync(mdPath, block);
  console.log(`Appended ${official.length} official items to tpo_source.md`);
}
