#!/usr/bin/env node
// Extract the TEXT-source halves from the 52 answer keys (zero OCR):
//   - BS target sentences (~10/set)  -> writing/buildSentence-targets.json
//   - Speaking repeat sentences (~7/set) -> speaking/repeat.json
// The answer keys list objective answers as single words (reading cloze) or
// single letters (MC); BS + speaking answers are full SENTENCES. We extract the
// sentence-items only, grouped into blocks by numbering RESET (num <= prev),
// which works for both labeled (combined-set) and inline (split-set) formats.
// The full BS/repeat items are completed later by joining OCR'd prompts/settings.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = resolve(ROOT, ".codex-tmp/exam_txt");
mkdirSync(resolve(ROOT, "data/realExam2026/writing"), { recursive: true });
mkdirSync(resolve(ROOT, "data/realExam2026/speaking"), { recursive: true });

function setDate(setName) {
  const mm = String(setName).match(/(\d{1,2})\.(\d{1,2})/);
  return mm ? `2026-${mm[1].padStart(2, "0")}-${mm[2].padStart(2, "0")}` : "2026";
}
const wc = (s) => s.split(/\s+/).filter(Boolean).length;
function difficulty(s) { const n = wc(s); return n <= 7 ? "easy" : n <= 12 ? "medium" : "hard"; }

// Pull numbered items in document order; classify each as sentence vs token.
function numberedItems(text) {
  const items = [];
  // match "N. content" / "N) content" / "Ncontent" (inline), content up to next number-at-boundary
  const re = /(?:^|\s)(\d{1,2})[\.\)]?\s*([A-Za-z'"][^\n]*?)(?=(?:\s+\d{1,2}[\.\)]?\s)|\n|$)/g;
  let m;
  for (const line of text.split("\n")) {
    re.lastIndex = 0;
    let any = false;
    while ((m = re.exec(line)) !== null) {
      any = true;
      items.push({ num: parseInt(m[1], 10), text: m[2].trim() });
    }
    if (!any) {
      const s = line.match(/^\s*(\d{1,2})[\.\)]\s*(.+)$/);
      if (s) items.push({ num: parseInt(s[1], 10), text: s[2].trim() });
    }
  }
  return items;
}

// Group items into blocks by numbering reset; keep only SENTENCE blocks (>=3 words).
function sentenceBlocks(text) {
  const items = numberedItems(text);
  const blocks = [];
  let cur = [];
  let prev = 0;
  for (const it of items) {
    if (it.num <= prev && cur.length) { blocks.push(cur); cur = []; }
    cur.push(it); prev = it.num;
  }
  if (cur.length) blocks.push(cur);
  // a sentence block: majority of items have >=3 words
  return blocks
    .map((b) => b.filter((x) => wc(x.text) >= 3).map((x) => x.text.replace(/\s+/g, " ").trim()))
    .filter((b) => b.length >= 4);
}

const files = readdirSync(SRC).filter((f) => /答案|参考/.test(f) && f.endsWith(".txt"));
const bsItems = [], repeatSets = [];

for (const f of files) {
  const setName = f.split("__")[0];
  const date = setDate(setName);
  const raw = readFileSync(resolve(SRC, f), "utf8").replace(/\r/g, "");
  const blocks = sentenceBlocks(raw);
  if (!blocks.length) continue;
  // Heuristic: the BS block has ~10 items, the repeat block ~7. Among the
  // trailing sentence blocks, the larger (~10) = BS, the next (~7) = repeat.
  // Take the last two sentence blocks in order.
  const tail = blocks.slice(-2);
  let bsBlock = null, repeatBlock = null;
  if (tail.length === 2) { bsBlock = tail[0]; repeatBlock = tail[1]; }
  else if (tail.length === 1) { bsBlock = tail[0]; }

  if (bsBlock) {
    bsBlock.forEach((s, i) => bsItems.push({
      id: `${date}_bs${i + 1}`, source: setName, date, tier: "recalled",
      type: "buildSentence", target: s,
    }));
  }
  if (repeatBlock) {
    repeatSets.push({
      id: `${date}_repeat`, source: setName, date, tier: "recalled", type: "listenAndRepeat",
      sentence_count: repeatBlock.length,
      sentences: repeatBlock.map((s, i) => ({ n: i + 1, text: s, words: wc(s), difficulty: difficulty(s) })),
    });
  }
}

writeFileSync(resolve(ROOT, "data/realExam2026/writing/buildSentence-targets.json"),
  JSON.stringify({ title: "BS target sentences (recalled 2026; answer-key half — join with OCR'd prompt/chunks)", tier: "recalled", source: "2026改后机经 (闲鱼)", count: bsItems.length, items: bsItems }, null, 2));
writeFileSync(resolve(ROOT, "data/realExam2026/speaking/repeat.json"),
  JSON.stringify({ title: "Listen-and-repeat sentences (recalled 2026)", tier: "recalled", source: "2026改后机经 (闲鱼)", set_count: repeatSets.length, sentence_total: repeatSets.reduce((a, s) => a + s.sentences.length, 0), sets: repeatSets }, null, 2));

console.log(`answer keys: ${files.length}`);
console.log(`BS target sentences: ${bsItems.length}`);
console.log(`repeat sets: ${repeatSets.length} (${repeatSets.reduce((a, s) => a + s.sentences.length, 0)} sentences)`);
