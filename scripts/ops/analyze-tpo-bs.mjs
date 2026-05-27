#!/usr/bin/env node
// Parse the real TPO Build a Sentence source markdown and classify each item
// by (sentence type, prompt opener). Classification works on the CHUNKS
// (the underlying words) because the answer line is blanks (___).

import { readFileSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const txt = readFileSync(resolve(repoRoot, "data/buildSentence/tpo_source.md"), "utf8");

const lines = txt.split(/\r?\n/);
const items = [];
let cur = null;

for (const raw of lines) {
  const line = raw.replace(/\\/g, "").trim();
  const m = line.match(/^_*(\d+)\._*\s+(.+)/);
  if (m) {
    if (cur && cur.prompt && cur.chunks) items.push(cur);
    cur = { prompt: m[2].replace(/_/g, "").trim(), answer: "", chunks: "" };
    continue;
  }
  if (!cur) continue;
  if (line.includes("__")) {
    cur.answer = (cur.answer + " " + line).trim();
    continue;
  }
  if (line.includes("/") && !cur.chunks && cur.answer) {
    cur.chunks = line;
  }
}
if (cur && cur.prompt && cur.chunks) items.push(cur);

function classifyOpener(p) {
  const s = p.toLowerCase().trim();
  if (/^what did/.test(s)) return "what did X";
  if (/^(did|do|does|are|was|were|is|have|has|can|could|will|would|should) (you|the|i|he|she|they|we|it|my|your)/.test(s)) return "yes-no Q";
  if (/^(where|why|when|how|who|which|what)/.test(s)) return "wh-Q";
  if (/^(tell|remember|let|show|please|ask)/.test(s)) return "imperative";
  if (/^i (noticed|heard|saw|wonder|see|hear)/.test(s)) return "I-statement";
  if (/^(do|don't|did)n'?t/.test(s)) return "neg-Q";
  if (/^[A-Z]/.test(p)) return "statement";
  return "other";
}

// Classify on chunks + answer template combined. The answer template line
// often contains pre-filled connectors (e.g. "___ wanted to know ___") that
// are the most reliable signal — chunks alone miss them because they're
// already in the template, not the unordered chunk list.
function classifySentenceType(chunks, answer) {
  const combined = (chunks + " " + answer).toLowerCase().replace(/_+/g, " ");
  const tokens = combined.split(/[\s\/]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const has = (w) => tokens.some((t) => t === w);
  const hasAny = (arr) => arr.some((w) => has(w));
  const hasSeq = (a, b) => tokens.includes(a) && tokens.includes(b);
  const fullText = " " + tokens.join(" ") + " ";
  // For phrase patterns we also need the original combined string with spaces
  const combinedText = " " + combined.replace(/\s+/g, " ") + " ";

  // INDIRECT-Q markers: cognitive verbs of inquiry + complementizer
  const cogVerbs = ["know", "knew", "ask", "asked", "wonder", "wondered", "curious", "wondering", "told", "find", "found", "figure", "figured", "needed"];
  const complementizers = ["whether", "if", "what", "where", "when", "why", "how", "who", "whom", "which"];
  const hasCogVerb = cogVerbs.some((w) => has(w));
  const hasComp = complementizers.some((w) => has(w));
  // Phrase patterns (need combined text, not tokens)
  const hasWantedToKnow = / wanted to know /.test(combinedText);
  const hasFoundOut = / found out /.test(combinedText) || / figured out /.test(combinedText);
  const hasToKnow = / to know /.test(combinedText) || / wanted to /.test(combinedText);
  const hasAskedIfWhat = / asked (if|whether|what|where|why|when|how) /.test(combinedText);
  const isIndirect = (hasCogVerb && hasComp) || hasWantedToKnow || hasFoundOut || hasAskedIfWhat || (hasToKnow && hasComp);

  // NEGATION markers
  const negMarkers = ["not", "no", "never", "nothing", "nobody", "no one"];
  const isNegation = negMarkers.some((w) => has(w)) || / no longer /.test(fullText) || / no idea /.test(fullText);

  // RELATIVE-clause markers: "that" + V-ed, or "which/who" pronouns
  const relMarkers = ["that", "which", "whom"];
  const hasRel = relMarkers.some((w) => has(w));
  // "that" alone is ambiguous (could be demonstrative); require a verb after suggestion
  const isRelative = hasRel && (has("took") || has("met") || has("recommended") || has("made") || has("wrote") || has("gave") || has("said") || has("told") || has("had") || has("written"));

  // COMPARATIVE
  const isComparative = / (more|less|better|worse|faster|slower) /.test(fullText) || / as .* as /.test(fullText) || / -er than /.test(fullText) || has("than");

  // PASSIVE markers
  const isPassive = (has("was") || has("were") || has("is") || has("are") || has("been")) && tokens.some((t) => /ed$/.test(t) && !["red", "fled", "fed", "led", "bed"].includes(t));

  // Prioritize: indirect-Q over others (it's the most structurally distinctive)
  if (isIndirect) return "indirect-Q";
  if (isRelative) return "relative-clause";
  if (isNegation) return "negation";
  if (isComparative) return "comparative";
  if (isPassive) return "passive";
  return "other";
}

const openerCounts = {};
const typeCounts = {};
const combinedCounts = {};
for (const it of items) {
  const o = classifyOpener(it.prompt);
  const t = classifySentenceType(it.chunks, it.answer);
  openerCounts[o] = (openerCounts[o] || 0) + 1;
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  const k = `${o} / ${t}`;
  combinedCounts[k] = (combinedCounts[k] || 0) + 1;
}

function pretty(counts, total) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k.padEnd(18)} ${String(v).padStart(3)}  (${((v / total) * 100).toFixed(0)}%)`)
    .join("\n");
}

console.log(`Total parsed: ${items.length} real TPO items\n`);
console.log("=== Prompt opener distribution ===");
console.log(pretty(openerCounts, items.length));
console.log();
console.log("=== Sentence type distribution (from chunks) ===");
console.log(pretty(typeCounts, items.length));
console.log();
console.log("=== Item-by-item classification (for spot check) ===");
items.forEach((it, i) => {
  const o = classifyOpener(it.prompt);
  const t = classifySentenceType(it.chunks, it.answer);
  console.log(`${(i + 1).toString().padStart(2)}. [${o.padEnd(11)}/${t.padEnd(15)}] ${it.prompt.slice(0, 55)}`);
  console.log(`     answer: ${it.answer.replace(/_+/g, "___").slice(0, 90)}`);
  console.log(`     chunks: ${it.chunks.slice(0, 90)}`);
});
