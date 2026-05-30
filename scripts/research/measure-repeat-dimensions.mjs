import fs from "node:fs";

const REAL = JSON.parse(fs.readFileSync("data/realExam2026/speaking/repeat.json", "utf8"));
const AUDIO = JSON.parse(fs.readFileSync("data/realExam2026/speaking/repeat-from-audio.json", "utf8"));
const GEN = JSON.parse(fs.readFileSync("data/speaking/bank/repeat.json", "utf8"));

const wc = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
const stripPunct = (t) => String(t).trim().replace(/[.,;:?!"]+$/g, "");

// Normalize: real uses {sentences:[{text}]}, gen uses {sentences:[{sentence}]}
function realSentences(set) { return (set.sentences || []).map(s => s.text); }
function genSentences(set) { return (set.sentences || []).map(s => s.sentence); }

function flat(sets, getter) {
  const out = [];
  for (const set of sets) for (const t of getter(set)) out.push(t);
  return out;
}

const realAll = flat(REAL.sets, realSentences);
const genAll = flat(GEN.items, genSentences);
// audio = "clean" transcript versions (complete sentences, no truncation)
const audioAll = flat(AUDIO.items, s => s.sentences);

function pct(n, d) { return d ? (100 * n / d).toFixed(1) + "%" : "n/a"; }
function mean(a) { return a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "n/a"; }
function median(a) { if (!a.length) return "n/a"; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function dist(a) { const d = {}; for (const x of a) d[x] = (d[x] || 0) + 1; return d; }

console.log("=".repeat(70));
console.log("REAL BANK:", REAL.sets.length, "sets,", realAll.length, "sentences");
console.log("GEN BANK :", GEN.items.length, "sets,", genAll.length, "sentences");
console.log("AUDIO(clean):", AUDIO.items.length, "sets,", audioAll.length, "sentences");
console.log("=".repeat(70));

// ── D1: sentences per set ──
console.log("\n### D1 sentences-per-set");
console.log("REAL:", dist(REAL.sets.map(s => (s.sentences || []).length)));
console.log("GEN :", dist(GEN.items.map(s => (s.sentences || []).length)));

// ── D2: word count per difficulty (real bank, using its labels) ──
console.log("\n### D2 word-count by difficulty (REAL, self-labeled)");
for (const diff of ["easy", "medium", "hard"]) {
  const ws = [];
  for (const set of REAL.sets) for (const s of (set.sentences || [])) if (s.difficulty === diff) ws.push(s.words ?? wc(s.text));
  console.log(`  ${diff.padEnd(6)} n=${String(ws.length).padEnd(4)} min=${Math.min(...ws)} max=${Math.max(...ws)} mean=${mean(ws)} median=${median(ws)}`);
}
console.log("### D2 word-count by difficulty (GEN)");
for (const diff of ["easy", "medium", "hard"]) {
  const ws = [];
  for (const set of GEN.items) for (const s of (set.sentences || [])) if (s.difficulty === diff) ws.push(wc(s.sentence));
  console.log(`  ${diff.padEnd(6)} n=${String(ws.length).padEnd(4)} min=${Math.min(...ws)} max=${Math.max(...ws)} mean=${mean(ws)} median=${median(ws)}`);
}

// ── D2b: overall sentence length (all sentences, real vs gen vs audio) ──
console.log("\n### D2b overall sentence length (words)");
const rw = realAll.map(wc), gw = genAll.map(wc), aw = audioAll.map(wc);
console.log(`  REAL  min=${Math.min(...rw)} max=${Math.max(...rw)} mean=${mean(rw)} median=${median(rw)}`);
console.log(`  AUDIO min=${Math.min(...aw)} max=${Math.max(...aw)} mean=${mean(aw)} median=${median(aw)}`);
console.log(`  GEN   min=${Math.min(...gw)} max=${Math.max(...gw)} mean=${mean(gw)} median=${median(gw)}`);

// ── D3: difficulty distribution per 7-sentence set ──
console.log("\n### D3 difficulty mix (sets w/ 7 sentences)");
function mix(sets, getDiff) {
  let perfect = 0, total = 0;
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const set of sets) {
    const ds = (set.sentences || []).map(getDiff);
    if (ds.length !== 7) continue;
    total++;
    const e = ds.filter(d => d === "easy").length, m = ds.filter(d => d === "medium").length, h = ds.filter(d => d === "hard").length;
    counts.easy += e; counts.medium += m; counts.hard += h;
    if (e === 2 && m === 3 && h === 2) perfect++;
  }
  return { perfect, total, counts };
}
const rmix = mix(REAL.sets, s => s.difficulty);
const gmix = mix(GEN.items, s => s.difficulty);
console.log(`  REAL 7-sets: ${rmix.total}, exact 2/3/2 = ${rmix.perfect} (${pct(rmix.perfect, rmix.total)}), tier counts:`, rmix.counts);
console.log(`  GEN  7-sets: ${gmix.total}, exact 2/3/2 = ${gmix.perfect} (${pct(gmix.perfect, gmix.total)}), tier counts:`, gmix.counts);

// ── D4: monotonic length progression (does length rise S1->S7?) ──
console.log("\n### D4 length progression (S1<=...<=S7 monotonic non-decreasing?)");
function progression(sets, getter) {
  let mono = 0, total = 0, lastBiggest = 0;
  for (const set of sets) {
    const ws = getter(set).map(wc);
    if (ws.length < 6) continue;
    total++;
    let ok = true;
    for (let i = 1; i < ws.length; i++) if (ws[i] < ws[i - 1]) { ok = false; break; }
    if (ok) mono++;
    // is last sentence the (tied-)longest?
    if (ws[ws.length - 1] >= Math.max(...ws)) lastBiggest++;
  }
  return { mono, total, lastBiggest };
}
const rp = progression(REAL.sets, realSentences);
const gp = progression(GEN.items, genSentences);
console.log(`  REAL strictly-non-decreasing: ${rp.mono}/${rp.total} (${pct(rp.mono, rp.total)}); last=longest: ${rp.lastBiggest}/${rp.total} (${pct(rp.lastBiggest, rp.total)})`);
console.log(`  GEN  strictly-non-decreasing: ${gp.mono}/${gp.total} (${pct(gp.mono, gp.total)}); last=longest: ${gp.lastBiggest}/${gp.total} (${pct(gp.lastBiggest, gp.total)})`);

// ── D5: opener "Welcome to..." S1 ──
console.log("\n### D5 S1 opener type");
function s1Openers(sets, getter) {
  const welcome = [], imperativeVerb = [], declarative = [], youCan = [];
  for (const set of sets) {
    const s = getter(set)[0]; if (!s) continue;
    const low = s.toLowerCase().trim();
    if (/^welcome\b/.test(low) || /^let'?s\b/.test(low)) welcome.push(s);
    else if (/^you can\b/.test(low)) youCan.push(s);
    else if (/^(please |first,?|next,?|begin |start |use |check |enter |browse |select |add |log |make |suggest )/i.test(low) || /^[a-z]+ (the|your|a|an|this|with|by)\b/i.test(low)) imperativeVerb.push(s);
    else declarative.push(s);
  }
  return { welcome, imperativeVerb, youCan, declarative };
}
const rs1 = s1Openers(REAL.sets, realSentences);
console.log(`  REAL S1: Welcome/Let's=${rs1.welcome.length}, imperative=${rs1.imperativeVerb.length}, You-can=${rs1.youCan.length}, other-declarative=${rs1.declarative.length}`);
console.log("    Welcome ex:", rs1.welcome.slice(0, 3));
console.log("    Imperative ex:", rs1.imperativeVerb.slice(0, 4));
const gs1 = s1Openers(GEN.items, genSentences);
console.log(`  GEN  S1: Welcome/Let's=${gs1.welcome.length}, imperative=${gs1.imperativeVerb.length}, You-can=${gs1.youCan.length}, other-declarative=${gs1.declarative.length}`);
console.log("    GEN Welcome ex:", gs1.welcome.slice(0, 3));

// ── D6: sentence-mood mix (imperative / declarative / question / you-can) ──
console.log("\n### D6 sentence mood mix (all sentences)");
function mood(sents) {
  let imper = 0, q = 0, youCan = 0, decl = 0;
  for (const s of sents) {
    const low = s.toLowerCase().trim();
    if (/\?$/.test(s.trim())) q++;
    else if (/^(do |are |is |can |have |would |will |did )/.test(low)) q++;
    else if (/^you('| can| will| should| may| can also|'ll|'re)\b/.test(low) || /^we (have|serve|offer|provide|are|hope)\b/.test(low)) youCan++;
    else if (/^(please |first|next|begin|start|use |check|enter|browse|select|add|log |make |suggest|propose|offer |recommend|contact|access|set |spread|insert|pour|mix|carefully|evenly|toss|put |dispose|track|participate|lightly|apply|review|download|remember|seek|visit|let |before |after |when |if |feel free|keep |expect|ask )/.test(low)) imper++;
    else decl++;
  }
  return { imper, q, youCan, decl, total: sents.length };
}
const rmood = mood(realAll), gmood = mood(genAll);
console.log(`  REAL imperative=${pct(rmood.imper, rmood.total)} you-stmt=${pct(rmood.youCan, rmood.total)} declarative=${pct(rmood.decl, rmood.total)} question=${pct(rmood.q, rmood.total)}`);
console.log(`  GEN  imperative=${pct(gmood.imper, gmood.total)} you-stmt=${pct(gmood.youCan, gmood.total)} declarative=${pct(gmood.decl, gmood.total)} question=${pct(gmood.q, gmood.total)}`);

// ── D7: yes/no question presence (gen has "Do you have your X?" pattern) ──
console.log("\n### D7 yes/no questions");
const rq = realAll.filter(s => /\?$/.test(s.trim()) && /^(do |are |is |can |have |would |did )/i.test(s.trim()));
const gq = genAll.filter(s => /\?$/.test(s.trim()) && /^(do |are |is |can |have |would |did )/i.test(s.trim()));
console.log(`  REAL yes/no Qs: ${rq.length}/${realAll.length} (${pct(rq.length, realAll.length)})`, rq.slice(0, 3));
console.log(`  GEN  yes/no Qs: ${gq.length}/${genAll.length} (${pct(gq.length, genAll.length)})`, gq.slice(0, 4));

// ── D8: contraction rate ──
console.log("\n### D8 contraction rate");
const cre = /\b(you'll|we'll|it's|we're|you're|they're|don't|can't|won't|isn't|aren't|let's|that's|here's|i'd|i'll|doesn't|didn't|you've|we've)\b/i;
const rc = realAll.filter(s => cre.test(s)).length, gc = genAll.filter(s => cre.test(s)).length;
const ac = audioAll.filter(s => cre.test(s)).length;
console.log(`  REAL: ${rc}/${realAll.length} (${pct(rc, realAll.length)})  AUDIO(clean): ${ac}/${audioAll.length} (${pct(ac, audioAll.length)})  GEN: ${gc}/${genAll.length} (${pct(gc, genAll.length)})`);

// ── D9: direct address "you/your" rate ──
console.log("\n### D9 direct-address (you/your) rate");
const ra = realAll.filter(s => /\byou(r)?\b/i.test(s)).length, ga = genAll.filter(s => /\byou(r)?\b/i.test(s)).length;
console.log(`  REAL: ${pct(ra, realAll.length)}  GEN: ${pct(ga, genAll.length)}`);

// ── D10: hard-sentence comma/clause-break rate ──
console.log("\n### D10 hard-sentence comma rate (multi-clause marker)");
function hardComma(sets, getter, getDiff) {
  let withComma = 0, total = 0;
  for (const set of sets) {
    const arr = set.sentences || [];
    for (let i = 0; i < arr.length; i++) {
      const d = getDiff(arr[i]); if (d !== "hard") continue;
      total++;
      if (/[,;]/.test(getter(set)[i])) withComma++;
    }
  }
  return { withComma, total };
}
const rhc = hardComma(REAL.sets, realSentences, s => s.difficulty);
const ghc = hardComma(GEN.items, genSentences, s => s.difficulty);
console.log(`  REAL hard w/ comma: ${rhc.withComma}/${rhc.total} (${pct(rhc.withComma, rhc.total)})`);
console.log(`  GEN  hard w/ comma: ${ghc.withComma}/${ghc.total} (${pct(ghc.withComma, ghc.total)})`);

// ── D11: conditional "If you..." in hard ──
console.log("\n### D11 'If...' conditional sentences (any tier)");
const rif = realAll.filter(s => /^if\b/i.test(s.trim()) || /\bif you\b/i.test(s)).length;
const gif = genAll.filter(s => /^if\b/i.test(s.trim()) || /\bif you\b/i.test(s)).length;
console.log(`  REAL: ${rif}/${realAll.length} (${pct(rif, realAll.length)})  GEN: ${gif}/${genAll.length} (${pct(gif, genAll.length)})`);

// ── D12: "will result in / suspension / privileges" punitive-warning trope (gen overuses) ──
console.log("\n### D12 punitive-warning trope ('will result in', 'suspension', 'privileges', 'incur', 'fine', 'charge')");
const punRe = /\b(will result in|suspension|privileges|incur|penalt|violation)\b/i;
const rpun = realAll.filter(s => punRe.test(s));
const gpun = genAll.filter(s => punRe.test(s));
console.log(`  REAL: ${rpun.length}/${realAll.length} (${pct(rpun.length, realAll.length)})`, rpun.slice(0, 3));
console.log(`  GEN : ${gpun.length}/${genAll.length} (${pct(gpun.length, genAll.length)})`, gpun.slice(0, 4));

// ── D13: last-sentence "wayfinding/map/help-desk" closer trope (real signature) ──
console.log("\n### D13 final-sentence closer themes (REAL S7/last)");
function lastSents(sets, getter) { return sets.map(s => getter(s)[getter(s).length - 1]).filter(Boolean); }
const rLast = lastSents(REAL.sets, realSentences);
const mapCloser = rLast.filter(s => /\b(map|schedule|guide|directory|floor plan|catalog)\b/i.test(s));
const helpCloser = rLast.filter(s => /\b(help|assist|question|staff|need)\b/i.test(s));
console.log(`  REAL last-sentence mentions map/schedule/guide: ${mapCloser.length}/${rLast.length} (${pct(mapCloser.length, rLast.length)})`);
console.log(`  REAL last-sentence mentions help/assist/staff/question: ${helpCloser.length}/${rLast.length} (${pct(helpCloser.length, rLast.length)})`);
console.log("    ex:", mapCloser.slice(0, 3));
const gLast = lastSents(GEN.items, genSentences);
const gMap = gLast.filter(s => /\b(map|schedule|guide|directory|floor plan|catalog)\b/i.test(s));
console.log(`  GEN  last-sentence map/schedule/guide: ${gMap.length}/${gLast.length} (${pct(gMap.length, gLast.length)})`);

// ── D14: scenario/setting domain mix ──
console.log("\n### D14 scenario domain (REAL settings inferred from audio + content)");
const domainRe = [
  ["library", /\blibrary|book|reference desk|checkout|borrow|due date|study room\b/i],
  ["store/retail", /\bstore|aisle|checkout counter|cashier|merchandise|fitting room|discount|smartphone|headphone|clothing|trousers\b/i],
  ["gym/sports", /\bgym|fitness|trainer|tennis|soccer|basketball|swim|yoga|locker|dumbbell|cardio|exercise equipment\b/i],
  ["lab/IT/computer", /\bcomputer lab|printer|scanner|wifi|wi-fi|log in|dashboard|password|documents|technical\b/i],
  ["procedure/how-to", /\btier|deflate|patch|pump|cookie|dough|oven|brush|paint|salad|chop|dressing|vegetables\b/i],
  ["tour/garden/museum", /\bgarden|greenhouse|pond|rose|sailing ship|reptile|butterfly|treetop|exhibit|gift shop|trail\b/i],
];
const dcount = {};
for (const s of realAll) {
  for (const [name, re] of domainRe) if (re.test(s)) { dcount[name] = (dcount[name] || 0) + 1; }
}
console.log("  REAL keyword hits (overlapping):", dcount);

console.log("\nDONE");
