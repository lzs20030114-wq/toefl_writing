#!/usr/bin/env node
import { readFileSync } from "fs";

const raw = readFileSync("data/buildSentence/tpo_source.md", "utf8");
const text = raw.replace(/\\/g, "");

const questions = [];
const lines = text.split(/\r?\n/);

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^__(\d+)\.__ *(.*)/);
  if (!m) continue;

  let prompt = m[2].trim();
  if (!prompt || prompt.startsWith("_")) {
    for (let j = i + 1; j < i + 3 && j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith("_") && !l.includes(" / ") && l.length > 5) {
        prompt = l;
        break;
      }
    }
  }

  let chunks = "";
  for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
    if (lines[j].includes(" / ")) {
      chunks = lines[j].trim();
      break;
    }
  }

  let template = "";
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    if (lines[j].includes("_____")) {
      template = lines[j].trim();
      break;
    }
  }

  if (prompt && chunks) {
    questions.push({ prompt, template, chunks });
  }
}

console.log("Parsed", questions.length, "TPO questions");

const stopwords = new Set([
  "the","a","an","is","are","was","were","do","does","did","have","has","had",
  "i","you","she","he","it","we","they","my","your","her","his","that","this",
  "in","on","at","to","of","for","and","or","not","if","whether","be","been",
  "being","by","with","from","about","would","could","should","will","can","may",
  "what","how","where","when","why","who","whom","which","yes","no","some","just",
  "very","much","also","so","but","then","than","all","any","its"
]);

function contentWords(text) {
  return text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

// TPO overlap
const tpoRates = [];
for (const q of questions) {
  const pWords = contentWords(q.prompt);
  const answerText = (q.template || "").replace(/_+/g, " ") + " " + q.chunks;
  const aWords = contentWords(answerText);
  if (aWords.length === 0) continue;
  const overlap = aWords.filter(w => pWords.includes(w)).length;
  const rate = overlap / aWords.length;
  tpoRates.push({ rate, prompt: q.prompt, chunks: q.chunks });
}
tpoRates.sort((a, b) => b.rate - a.rate);

// Our bank overlap
const d = JSON.parse(readFileSync("data/buildSentence/questions.json", "utf8"));
const qs = d.question_sets.flatMap(s => s.questions);
const bankRates = [];
for (const q of qs) {
  const pWords = contentWords(q.prompt || "");
  const aWords = contentWords(q.answer);
  if (aWords.length === 0) continue;
  const overlap = aWords.filter(w => pWords.includes(w)).length;
  const rate = overlap / aWords.length;
  bankRates.push({ rate, id: q.id, kind: q.prompt_task_kind });
}
bankRates.sort((a, b) => b.rate - a.rate);

const avg = arr => arr.reduce((s, x) => s + x.rate, 0) / arr.length;
const median = arr => { const s = [...arr].sort((a,b) => a.rate - b.rate); return s[Math.floor(s.length/2)].rate; };
const countOver = (arr, t) => arr.filter(x => x.rate > t).length;

console.log("");
console.log("========== PROMPT-ANSWER OVERLAP COMPARISON ==========");
console.log("");
console.log(`                TPO (${tpoRates.length})         OUR BANK (${bankRates.length})`);
console.log(`Avg overlap:    ${(avg(tpoRates)*100).toFixed(1)}%            ${(avg(bankRates)*100).toFixed(1)}%`);
console.log(`Median:         ${(median(tpoRates)*100).toFixed(1)}%            ${(median(bankRates)*100).toFixed(1)}%`);
console.log(`>40% leak:      ${countOver(tpoRates,0.4)} (${(countOver(tpoRates,0.4)/tpoRates.length*100).toFixed(0)}%)            ${countOver(bankRates,0.4)} (${(countOver(bankRates,0.4)/bankRates.length*100).toFixed(0)}%)`);
console.log(`>30% leak:      ${countOver(tpoRates,0.3)} (${(countOver(tpoRates,0.3)/tpoRates.length*100).toFixed(0)}%)            ${countOver(bankRates,0.3)} (${(countOver(bankRates,0.3)/bankRates.length*100).toFixed(0)}%)`);
console.log(`>20% leak:      ${countOver(tpoRates,0.2)} (${(countOver(tpoRates,0.2)/tpoRates.length*100).toFixed(0)}%)            ${countOver(bankRates,0.2)} (${(countOver(bankRates,0.2)/bankRates.length*100).toFixed(0)}%)`);
console.log(`0% overlap:     ${countOver(tpoRates,-0.01)} ... ${tpoRates.filter(x=>x.rate===0).length} (${(tpoRates.filter(x=>x.rate===0).length/tpoRates.length*100).toFixed(0)}%)    ${bankRates.filter(x=>x.rate===0).length} (${(bankRates.filter(x=>x.rate===0).length/bankRates.length*100).toFixed(0)}%)`);

console.log("");
console.log("=== TPO: ALL overlap rates (descending) ===");
for (const t of tpoRates) {
  if (t.rate > 0) console.log(`  ${(t.rate*100).toFixed(0)}%  ${t.prompt.slice(0,65)}`);
}

console.log("");
console.log("=== OUR BANK: Top 25 overlap ===");
for (const b of bankRates.slice(0, 25)) {
  console.log(`  ${(b.rate*100).toFixed(0)}%  ${b.id} (${b.kind})`);
}
