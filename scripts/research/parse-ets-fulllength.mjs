#!/usr/bin/env node
// Parse Build-a-Sentence items from the official ETS full-length practice-test
// txt dumps (.research/raw/ets-full-N.txt). These are Tier-1 official questions:
// each item has a prompt, a blank pattern, a scrambled chunk pool (incl.
// distractors), and a verified answer from the test's Answer Key.
//
// Output: .research/collected/bs_official.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const root = resolve(import.meta.dirname, "..", "..");
const sources = [
  { file: ".research/raw/ets-full-length-1.txt", test: "iBT 2026 Full-Length Practice Test 1" },
  { file: ".research/raw/ets-full-2.txt", test: "iBT 2026 Full-Length Practice Test 2" },
];
const SRC_URL = {
  "iBT 2026 Full-Length Practice Test 1": "https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-1.pdf",
  "iBT 2026 Full-Length Practice Test 2": "https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-2.pdf",
};

function parseBS(text) {
  const lines = text.split(/\r?\n/);
  // Find the "Build a Sentence" section start and the "Write an Email" end.
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && /^\s*Build a Sentence\s*$/.test(lines[i]) && /Move the words/.test(lines[i + 1] || "")) start = i;
    if (start !== -1 && /^\s*Write an Email\s*$/.test(lines[i])) { end = i; break; }
  }
  const seg = lines.slice(start, end);

  // Items look like:
  //  N. <prompt>
  //     <blanks line> (contains _____ , may contain inline given words)
  //     <chunks line> (a / b / c ...)
  const items = [];
  for (let i = 0; i < seg.length; i++) {
    const m = seg[i].match(/^\s*(\d{1,2})\.\s+(.*\S)\s*$/);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const prompt = m[2].trim();
    // gather subsequent non-empty lines until we have a blanks line and a chunks line
    let blanks = null, chunks = null;
    for (let j = i + 1; j < seg.length && j < i + 6; j++) {
      const ln = seg[j].trim();
      if (!ln) continue;
      if (blanks === null && ln.includes("_____")) { blanks = ln; continue; }
      if (blanks !== null && ln.includes("/")) { chunks = ln; break; }
      // chunk lines sometimes appear even if blanks had inline words; handle "/" first
      if (blanks !== null && chunks === null && ln.includes("/")) { chunks = ln; break; }
    }
    if (blanks && chunks) {
      const chunkArr = chunks.split("/").map((c) => c.trim()).filter(Boolean);
      items.push({ num, prompt, blanks: blanks.replace(/\s+/g, " ").trim(), chunks: chunkArr });
    }
  }

  // Answer key: lines after the WRITING "Answer Key" up to "Speaking Section".
  // NOTE: in the ETS PDF table, the number column and answer column can be
  // misaligned by one row (Test 1: Q1's answer is on an orphan line and the
  // printed numbers are shifted down by one). So we do NOT trust the printed
  // numbers — we collect answer sentences in document order and map them
  // positionally to items 1..N (answers always appear in question order),
  // then sanity-check each against the item's chunk pool.
  const akLines = [];
  let inAK = false;
  for (let i = 0; i < lines.length; i++) {
    if (/Writing Section/.test(lines[i]) && /Answer Key/.test(lines[i + 1] || "")) inAK = true;
    if (inAK && /Speaking Section/.test(lines[i])) break;
    if (inAK) akLines.push(lines[i]);
  }
  const isHeaderOrNoise = (s) =>
    !s ||
    // line composed only of table-header words (Question / Number / Answer)
    /^(question|number|answer)(\s+(question|number|answer))*$/i.test(s) ||
    /^(writing section|answer key)$/i.test(s) ||
    /TOEFL iBT.* Practice Test/i.test(s) ||
    /^\d{1,2}$/.test(s); // a bare number (e.g. the trailing "10")
  const answerSentences = [];
  for (const raw of akLines) {
    // strip a leading or trailing standalone number column, keep the sentence
    let s = raw.replace(/\s{2,}/g, " ").trim();
    s = s.replace(/^\d{1,2}\s+/, "").replace(/\s+\d{1,2}$/, "").trim();
    if (isHeaderOrNoise(s)) continue;
    if (/[A-Za-z]/.test(s) && s.length >= 6) answerSentences.push(s);
  }

  const norm = (w) => w.toLowerCase().replace(/[^a-z']/g, "");
  return items.map((it, idx) => {
    const answer = answerSentences[idx] || null;
    // coverage check: answer tokens should be drawn from chunk tokens + the
    // inline "given" words shown in the blanks line (words that aren't _____).
    let coverageOk = null;
    if (answer) {
      const given = it.blanks
        .split(/\s+/)
        .filter((w) => w && !w.includes("_____"))
        .map(norm)
        .filter(Boolean);
      const pool = new Map();
      for (const c of [...it.chunks.flatMap((x) => x.split(/\s+/)), ...given]) {
        const n = norm(c);
        if (n) pool.set(n, (pool.get(n) || 0) + 1);
      }
      const ansTokens = answer.split(/\s+/).map(norm).filter(Boolean);
      const leftover = [];
      for (const t of ansTokens) {
        if (pool.get(t) > 0) pool.set(t, pool.get(t) - 1);
        else leftover.push(t);
      }
      coverageOk = leftover.length === 0;
      if (!coverageOk) it._leftover = leftover;
    }
    return { ...it, answer, coverageOk };
  });
}

const collected = [];
for (const { file, test } of sources) {
  const p = resolve(root, file);
  if (!existsSync(p)) { console.error("MISSING", file); continue; }
  const text = readFileSync(p, "utf8");
  const items = parseBS(text);
  console.log(`\n${test}: ${items.length} BS items`);
  for (const it of items) {
    console.log(`  ${String(it.num).padStart(2)}. prompt="${it.prompt}"`);
    console.log(`      blanks: ${it.blanks}`);
    console.log(`      chunks: [${it.chunks.join(" | ")}]`);
    console.log(`      answer: ${it.answer || "(MISSING)"}  [coverage:${it.coverageOk}${it._leftover ? " leftover=" + it._leftover.join(",") : ""}]`);
    collected.push({
      source_test: test,
      source_url: SRC_URL[test],
      tier: "official",
      prompt: it.prompt,
      blanks: it.blanks,
      chunks: it.chunks,
      answer: it.answer,
      coverageOk: it.coverageOk,
    });
  }
}

const outDir = resolve(root, ".research/collected");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "bs_official.json");
writeFileSync(outPath, JSON.stringify(collected, null, 2));
console.log(`\nWrote ${collected.length} official BS items -> ${outPath}`);
const missing = collected.filter((c) => !c.answer).length;
console.log(`Items missing answer: ${missing}`);
