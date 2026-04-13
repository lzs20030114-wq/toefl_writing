#!/usr/bin/env node

/**
 * Deep flavor analysis for Read in Daily Life — updated with 52 samples.
 *
 * Usage: node scripts/analyze-rdl-flavor.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "data", "reading", "samples", "readInDailyLife");

function loadAll() {
  const items = [];
  for (const f of readdirSync(DIR).filter(f => f.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(DIR, f), "utf-8"));
    if (Array.isArray(d.items)) items.push(...d.items);
  }
  return items;
}

function wc(text) { return text.trim().split(/\s+/).filter(Boolean).length; }
function sents(text) { return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1); }

const items = loadAll();
const allQ = items.flatMap(i => i.questions || []);

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║     RDL Flavor Analysis (52 samples, 152 questions)     ║");
console.log("╚══════════════════════════════════════════════════════════╝\n");
console.log(`Total: ${items.length} passages, ${allQ.length} questions\n`);

// ── 1. GENRE × WORD COUNT ──
console.log("━━━ 1. Genre × Word Count ━━━\n");
const byGenre = {};
items.forEach(i => {
  const g = i.genre || "other";
  if (!byGenre[g]) byGenre[g] = [];
  byGenre[g].push(wc(i.text));
});
for (const [g, wcs] of Object.entries(byGenre).sort((a,b) => b[1].length - a[1].length)) {
  const avg = (wcs.reduce((s,v)=>s+v,0)/wcs.length).toFixed(0);
  console.log(`  ${g.padEnd(15)} n=${String(wcs.length).padEnd(3)} words: ${Math.min(...wcs)}-${Math.max(...wcs)} avg=${avg}`);
}

// ── 2. REGISTER MARKERS ──
console.log("\n━━━ 2. Register (Informal vs Formal) ━━━\n");
let contractions = 0, exclamations = 0, questions = 0, abbreviations = 0;
let bullets = 0, lineBreaks = 0;
let passives = 0, nominalizations = 0;
const PASSIVE_RE = /\b(?:is|are|was|were|been|being|be)\s+\w+(?:ed|en)\b/gi;
const NOMINAL_RE = /\b\w+(?:tion|ment|ness|ity|ance|ence)\b/gi;

items.forEach(i => {
  const t = i.text;
  contractions += (t.match(/\b\w+'(?:t|re|ve|ll|d|s|m)\b/gi) || []).length;
  exclamations += (t.match(/!/g) || []).length;
  questions += (t.match(/\?/g) || []).length;
  abbreviations += (t.match(/\b(?:[A-Z]\.){2,}|\b(?:AM|PM|RSVP|ID|Wi-Fi|QR|FAQ|CNC|DSLR|HIIT)\b/g) || []).length;
  bullets += (t.match(/[•\-\*]\s/g) || []).length;
  lineBreaks += (t.match(/\n/g) || []).length;
  passives += (t.match(PASSIVE_RE) || []).length;
  nominalizations += (t.match(NOMINAL_RE) || []).length;
});

const n = items.length;
console.log(`  Contractions:    ${contractions} total (${(contractions/n).toFixed(1)}/text)`);
console.log(`  Exclamations:    ${exclamations} total (${(exclamations/n).toFixed(1)}/text)`);
console.log(`  Questions:       ${questions} total (${(questions/n).toFixed(1)}/text)`);
console.log(`  Abbreviations:   ${abbreviations} total (${(abbreviations/n).toFixed(1)}/text)`);
console.log(`  Bullet points:   ${bullets} total (${(bullets/n).toFixed(1)}/text)`);
console.log(`  Line breaks:     ${lineBreaks} total (${(lineBreaks/n).toFixed(1)}/text)`);
console.log(`  Passive voice:   ${passives} total (${(passives/n).toFixed(1)}/text)`);
console.log(`  Nominalizations: ${nominalizations} total (${(nominalizations/n).toFixed(1)}/text)`);

// Formality by genre
console.log("\n  Formality by genre (contractions + exclamations = informal):");
for (const [g, _] of Object.entries(byGenre).sort((a,b) => b[1].length - a[1].length)) {
  const genreItems = items.filter(i => i.genre === g);
  let inf = 0, frm = 0;
  genreItems.forEach(i => {
    inf += (i.text.match(/\b\w+'(?:t|re|ve|ll|d|s|m)\b|!/gi) || []).length;
    frm += (i.text.match(PASSIVE_RE) || []).length + (i.text.match(NOMINAL_RE) || []).length;
  });
  console.log(`    ${g.padEnd(15)} informal=${(inf/genreItems.length).toFixed(1)}/text  formal=${(frm/genreItems.length).toFixed(1)}/text`);
}

// ── 3. TEXT STRUCTURE ──
console.log("\n━━━ 3. Text Structure Features ━━━\n");
let hasGreeting = 0, hasSignoff = 0, hasBulletList = 0, hasDate = 0, hasTimes = 0, hasMoney = 0;
items.forEach(i => {
  const t = i.text;
  if (t.match(/^(?:Dear |Hi |Hello |Hey )/m)) hasGreeting++;
  if (t.match(/Best regards|Sincerely|Thanks|Cheers|Best,/i)) hasSignoff++;
  if (t.match(/[•\-\*]\s/)) hasBulletList++;
  if (t.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i)) hasDate++;
  if (t.match(/\d{1,2}:\d{2}\s*(?:AM|PM|a\.m\.|p\.m\.)/i)) hasTimes++;
  if (t.match(/\$\d/)) hasMoney++;
});
console.log(`  Has greeting:     ${hasGreeting} (${(hasGreeting/n*100).toFixed(0)}%)`);
console.log(`  Has sign-off:     ${hasSignoff} (${(hasSignoff/n*100).toFixed(0)}%)`);
console.log(`  Has bullet list:  ${hasBulletList} (${(hasBulletList/n*100).toFixed(0)}%)`);
console.log(`  Has date/month:   ${hasDate} (${(hasDate/n*100).toFixed(0)}%)`);
console.log(`  Has specific time:${hasTimes} (${(hasTimes/n*100).toFixed(0)}%)`);
console.log(`  Has money ($):    ${hasMoney} (${(hasMoney/n*100).toFixed(0)}%)`);

// ── 4. SENTENCE ANALYSIS ──
console.log("\n━━━ 4. Sentence Analysis ━━━\n");
const allSentLens = [];
items.forEach(i => {
  sents(i.text).forEach(s => allSentLens.push(wc(s)));
});
allSentLens.sort((a,b) => a-b);
const avgSL = allSentLens.reduce((s,v)=>s+v,0)/allSentLens.length;
console.log(`  Total sentences:  ${allSentLens.length}`);
console.log(`  Avg sent length:  ${avgSL.toFixed(1)} words`);
console.log(`  Min: ${allSentLens[0]}  Max: ${allSentLens[allSentLens.length-1]}  Median: ${allSentLens[Math.floor(allSentLens.length/2)]}`);

// Sentence length distribution
const buckets = {short: 0, medium: 0, long: 0, vlong: 0};
allSentLens.forEach(l => {
  if (l <= 10) buckets.short++;
  else if (l <= 20) buckets.medium++;
  else if (l <= 30) buckets.long++;
  else buckets.vlong++;
});
console.log(`  ≤10 words: ${buckets.short} (${(buckets.short/allSentLens.length*100).toFixed(0)}%)`);
console.log(`  11-20:     ${buckets.medium} (${(buckets.medium/allSentLens.length*100).toFixed(0)}%)`);
console.log(`  21-30:     ${buckets.long} (${(buckets.long/allSentLens.length*100).toFixed(0)}%)`);
console.log(`  31+:       ${buckets.vlong} (${(buckets.vlong/allSentLens.length*100).toFixed(0)}%)`);

// ── 5. QUESTION STEM DEEP DIVE ──
console.log("\n━━━ 5. Question Stem Patterns ━━━\n");
const patterns = {};
allQ.forEach(q => {
  const s = q.stem.toLowerCase();
  // Extract the first meaningful pattern
  if (s.startsWith("according to")) patterns["According to the X, ..."] = (patterns["According to the X, ..."]||0) + 1;
  else if (s.match(/what is the main purpose/)) patterns["What is the main purpose"] = (patterns["What is the main purpose"]||0) + 1;
  else if (s.match(/what can be inferred/)) patterns["What can be inferred"] = (patterns["What can be inferred"]||0) + 1;
  else if (s.match(/what must|what should|what does .* ask|what are .* expected/)) patterns["What must/should X do"] = (patterns["What must/should X do"]||0) + 1;
  else if (s.match(/which .* not|is not mentioned/)) patterns["Which is NOT..."] = (patterns["Which is NOT..."]||0) + 1;
  else if (s.match(/why does/)) patterns["Why does X mention..."] = (patterns["Why does X mention..."]||0) + 1;
  else if (s.match(/closest in meaning|most nearly means/)) patterns["word closest in meaning"] = (patterns["word closest in meaning"]||0) + 1;
  else if (s.match(/what will happen|what happens/)) patterns["What will happen if..."] = (patterns["What will happen if..."]||0) + 1;
  else if (s.match(/what is one benefit|what is one advantage|what is one privilege/)) patterns["What is one benefit of..."] = (patterns["What is one benefit of..."]||0) + 1;
  else if (s.match(/how can|how must|how should/)) patterns["How can/should X..."] = (patterns["How can/should X..."]||0) + 1;
  else if (s.match(/what is (?:the )?primary/)) patterns["What is the primary..."] = (patterns["What is the primary..."]||0) + 1;
  else if (s.match(/what is provided|what are provided/)) patterns["What is provided..."] = (patterns["What is provided..."]||0) + 1;
  else if (s.match(/what is (?:likely|implied|suggested)/)) patterns["What is likely/implied..."] = (patterns["What is likely/implied..."]||0) + 1;
  else if (s.match(/what aspect|what component|what part/)) patterns["What aspect/part of..."] = (patterns["What aspect/part of..."]||0) + 1;
  else patterns["Other"] = (patterns["Other"]||0) + 1;
});
for (const [p, c] of Object.entries(patterns).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(35)} ${c} (${(c/allQ.length*100).toFixed(1)}%)`);
}

// Stem word count
const stemLens = allQ.map(q => wc(q.stem));
console.log(`\n  Avg stem length: ${(stemLens.reduce((s,v)=>s+v,0)/stemLens.length).toFixed(1)} words`);
console.log(`  Stem range: ${Math.min(...stemLens)}-${Math.max(...stemLens)} words`);

// ── 6. OPTION CONSTRUCTION ──
console.log("\n━━━ 6. Option Construction ━━━\n");
let correctLongest = 0, correctShortest = 0, balanced = 0;
const cLens = [], dLens = [];

allQ.forEach(q => {
  if (!q.options || !q.correct_answer) return;
  const lens = Object.entries(q.options).map(([k,v]) => ({key: k, len: wc(v)}));
  const cLen = lens.find(l => l.key === q.correct_answer)?.len || 0;
  const maxL = Math.max(...lens.map(l => l.len));
  const minL = Math.min(...lens.map(l => l.len));
  if (cLen === maxL && lens.filter(l => l.len === maxL).length === 1) correctLongest++;
  if (cLen === minL && lens.filter(l => l.len === minL).length === 1) correctShortest++;
  if (maxL - minL <= 3) balanced++;
  cLens.push(cLen);
  lens.filter(l => l.key !== q.correct_answer).forEach(l => dLens.push(l.len));
});

console.log(`  Correct is longest:  ${correctLongest} (${(correctLongest/allQ.length*100).toFixed(1)}%)`);
console.log(`  Correct is shortest: ${correctShortest} (${(correctShortest/allQ.length*100).toFixed(1)}%)`);
console.log(`  Well-balanced:       ${balanced} (${(balanced/allQ.length*100).toFixed(1)}%)`);
console.log(`  Avg correct option:  ${(cLens.reduce((s,v)=>s+v,0)/cLens.length).toFixed(1)} words`);
console.log(`  Avg distractor:      ${(dLens.reduce((s,v)=>s+v,0)/dLens.length).toFixed(1)} words`);

// ── 7. ANSWER POSITION ──
console.log("\n━━━ 7. Answer Position by Type ━━━\n");
const posByType = {};
allQ.forEach(q => {
  const t = q.question_type || "other";
  if (!posByType[t]) posByType[t] = {A:0,B:0,C:0,D:0,total:0};
  posByType[t][q.correct_answer]++;
  posByType[t].total++;
});
for (const [t, p] of Object.entries(posByType).sort((a,b) => b[1].total - a[1].total)) {
  console.log(`  ${t.padEnd(25)} A=${p.A}(${(p.A/p.total*100).toFixed(0)}%) B=${p.B}(${(p.B/p.total*100).toFixed(0)}%) C=${p.C}(${(p.C/p.total*100).toFixed(0)}%) D=${p.D}(${(p.D/p.total*100).toFixed(0)}%)`);
}

// ── 8. TOPIC/SETTING ANALYSIS ──
console.log("\n━━━ 8. Setting/Context Analysis ━━━\n");
let campus = 0, community = 0, workplace = 0, commercial = 0;
items.forEach(i => {
  const t = i.text.toLowerCase();
  if (t.match(/campus|university|student|dorm|semester|professor|course|library|bookstore|locker|semester/)) campus++;
  if (t.match(/community|neighborhood|volunteer|garden|charity|repair café|farmers market/)) community++;
  if (t.match(/company|office|colleague|supervisor|employee|workplace/)) workplace++;
  if (t.match(/cinema|café|restaurant|store|shop|membership|subscribe/)) commercial++;
});
console.log(`  Campus/University:  ${campus} (${(campus/n*100).toFixed(0)}%)`);
console.log(`  Community/Local:    ${community} (${(community/n*100).toFixed(0)}%)`);
console.log(`  Workplace:          ${workplace} (${(workplace/n*100).toFixed(0)}%)`);
console.log(`  Commercial:         ${commercial} (${(commercial/n*100).toFixed(0)}%)`);
