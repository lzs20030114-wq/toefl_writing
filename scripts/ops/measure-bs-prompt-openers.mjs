#!/usr/bin/env node
// Measure BS prompt-opener (题面问法) distribution on real TPO vs our batches.
// Two metrics:
//   1. opener TYPE distribution (what-did-X-ask / wh-Q / yes-no / statement)
//   2. structural monotony: share of prompts that begin with the SAME 3-word
//      template (e.g. "what did <name>") — catches "all prompts sound identical"

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const { classifyBSOpener } = await import(pathToFileURL(resolve(ROOT, "lib/quality/scoreBatch.mjs")).href);

function template3(prompt) {
  // first 3 tokens, lowercased, names normalized to <name>
  const toks = String(prompt || "").trim().toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const NAMES = new Set(["olivia","harold","mariana","hector","margot","emma","julian","matthew","alison","juan","angelina","naomi","diane","tomas","priya","adrian","lila","sophia","conrad","aaliya","tessa","karim","sienna","freya","esme","vivian","cho","professor","yasmin","damian","camille","felix","tobias"]);
  return toks.slice(0, 3).map((t) => NAMES.has(t) ? "<name>" : t).join(" ");
}

function measure(prompts, label) {
  const types = {};
  const tmpls = {};
  for (const p of prompts) {
    const t = classifyBSOpener(p);
    types[t] = (types[t] || 0) + 1;
    const tm = template3(p);
    tmpls[tm] = (tmpls[tm] || 0) + 1;
  }
  const N = prompts.length;
  const topTmpl = Object.entries(tmpls).sort((a, b) => b[1] - a[1])[0];
  return {
    label, N, types,
    distinctTemplates: Object.keys(tmpls).length,
    topTemplate: topTmpl ? `${topTmpl[0]} (${topTmpl[1]}/${N})` : "—",
    topTemplateFrac: topTmpl ? topTmpl[1] / N : 0,
    whatDidAskFrac: (types["what-did-X-ask"] || 0) / N,
  };
}

// ── TPO prompts ────────────────────────────────────────────────────────
const raw = readFileSync(resolve(ROOT, "data/buildSentence/tpo_source.md"), "utf8").split(/\r?\n/);
const tpoPrompts = [];
for (const line of raw) {
  const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
  if (qm && qm[2].trim()) tpoPrompts.push(qm[2].trim());
}

// ── our prompts ──────────────────────────────────────────────────────────
function loadStaging(session) {
  try { return JSON.parse(readFileSync(resolve(ROOT, `data/buildSentence/staging/${session}.json`), "utf8")).items.map((q) => q.prompt); }
  catch { return []; }
}

const sessions = process.argv.slice(2);
const sets = [measure(tpoPrompts, `TPO`)];
if (sessions.length) {
  for (const s of sessions) sets.push(measure(loadStaging(s), s.slice(-13)));
} else {
  const files = readdirSync(resolve(ROOT, "data/buildSentence/staging")).filter((f) => /^routine-\d.*\.json$/.test(f) && !f.includes("r2")).sort().reverse().slice(0, 3);
  for (const f of files) sets.push(measure(loadStaging(f.replace(".json", "")), f.replace(".json", "").slice(-13)));
}

const ALL_TYPES = ["what-did-X-ask", "wh-Q", "yes-no", "statement", "other-Q"];
console.log("BS prompt-opener (题面问法) distribution — TPO vs our batches\n");
console.log("opener type".padEnd(18) + sets.map((s) => s.label.padStart(14)).join(""));
console.log("-".repeat(18 + 14 * sets.length));
for (const ty of ALL_TYPES) {
  console.log(ty.padEnd(18) + sets.map((s) => {
    const n = s.types[ty] || 0;
    return `${n} (${Math.round(n / s.N * 100)}%)`.padStart(14);
  }).join(""));
}
console.log("");
console.log("distinct 3-word tmpl".padEnd(18) + sets.map((s) => `${s.distinctTemplates}/${s.N}`.padStart(14)).join(""));
console.log("top template share".padEnd(18) + sets.map((s) => `${Math.round(s.topTemplateFrac * 100)}%`.padStart(14)).join(""));
console.log("'what did X' share".padEnd(18) + sets.map((s) => `${Math.round(s.whatDidAskFrac * 100)}%`.padStart(14)).join(""));
console.log("");
sets.forEach((s) => console.log(`${s.label}: top template = ${s.topTemplate}`));
