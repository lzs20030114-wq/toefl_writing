#!/usr/bin/env node
/**
 * Build-a-Sentence difficulty & anti-regression scorer.
 *
 * Quantifies a batch of BS questions into comparable, structured data and judges it
 * against the REAL 2026改后 exam standard (derived from data/realExam2026, tier=recalled).
 *
 * Modes:
 *   --derive                 Re-measure the real corpus and (re)write the frozen standard JSON.
 *   --score <file.json>      Score a batch; emit scorecard + per-item ledger. Forces a deep
 *                            word-by-word audit whenever the aggregate looks like it PASSES.
 *   --selfcheck              Validate the scorer itself: real corpus must read PASS (difficulty),
 *                            current V2 live bank must read FAIL (difficulty). If not → scorer is broken.
 *
 * Detector honesty: length & register detectors are gate-grade; relative-clause / passive
 * detectors are ~80-90% precision (they overlap embedded-Q and catch idioms) → DIRECTION-ONLY,
 * never a hard gate. The real per-item quality verdict (grammaticality / unique arrangement /
 * "reads like a real exam") is NOT auto-decided — it is forced into the word-audit ledger.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const STANDARD_PATH = "data/eval-profiles/bs-difficulty-standard.json";
const REAL_PATH = "data/realExam2026/writing/buildSentence-targets.json";
const V2_PATH = "data/buildSentence/questions.json";

/* ─────────────── tokenization & feature detectors ─────────────── */
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const words = s => (String(s || "").match(WORD_RE) || []);
const IRREG_PP = new Set("taken given seen done made known written built held shown told sent brought thought caught begun chosen driven eaten grown hidden spoken stolen broken frozen".split(" "));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0; };
const r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const rate = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : 0);

function features(answer) {
  const ws = words(answer); const W = ws.length; const low = " " + String(answer).toLowerCase() + " "; const t = String(answer).trim().toLowerCase();
  // difficulty structures
  const embeddedQ = /\b(know|tell|wonder|ask(?:ed|s)?|sure|see|whether|if)\b[^?.]*\b(whether|if|what|where|when|why|how|who|whom|which)\b/.test(low)
    && !/^\s*(do|does|did|can|could|will|would|is|are|was|were|have|has|should|may|might)\b/.test(t);
  const relClause = /\b\w+\s+(who|whom|whose|which|that)\s+\w+/.test(low) && W > 6 && !/^(who|what|which|where)/.test(t);
  const subord = /\b(because|although|though|while|when|after|before|since|unless|whereas)\b/.test(low);
  let passive = /\b(is|are|was|were|be|been|being|am)\s+(\w+ed|\w+en)\b/.test(low)
    || ws.some((w, i) => /^(is|are|was|were|be|been|being)$/i.test(ws[i - 1] || "") && IRREG_PP.has(w.toLowerCase()));
  const negation = /\b(not|never|no|none|nothing|nobody|cannot)\b/.test(low) || /n't/.test(low);
  const modal = /\b(can|could|will|would|should|might|may|must|shall)\b/.test(low);
  // register
  const firstPerson = /\b(i|i'm|i've|i'd|i'll|my|me|we|we're|we've|our|us)\b/.test(low);
  const secondPerson = /\b(you|your|you're|you've)\b/.test(low);
  const contraction = /n't|\b\w+'(re|ve|ll|d|m)\b/.test(low) || /\b(it|that|he|she|here|there|what|who)'s\b/.test(low);
  const casualOpener = /^(yes|no|sorry|unfortunately|that's right|actually|sure|well|oh|hmm|thanks)\b/.test(t);
  const thirdFormal = !firstPerson && !secondPerson && /^(the|a|an|this|that|these|those|[a-z]+ )/.test(t);
  const heavy = [embeddedQ, relClause, subord, passive].filter(Boolean).length;
  const light = [negation, modal].filter(Boolean).length;
  const band = W <= 7 ? "easy" : W <= 11 ? "med" : "hard";
  return { W, band, index: W + 2 * heavy + light,
    embeddedQ, relClause, subord, passive, negation, modal,
    firstPerson, secondPerson, contraction, casualOpener, thirdFormal };
}

/* ─────────────── input normalization ─────────────── */
// Accept: {items:[{target}]} (real), {question_sets:[{questions:[...]}]} (app bank), {questions:[...]}, or [..]
function normalize(json) {
  let sets = [];
  if (Array.isArray(json)) sets = [{ questions: json }];
  else if (json.question_sets) sets = json.question_sets;
  else if (json.questions) sets = [{ questions: json.questions }];
  else if (json.items) sets = [{ questions: json.items, _src_field: true }];
  const items = [];
  for (const set of sets) {
    const sid = set.set_id ?? set.id ?? set.source ?? null;
    for (const q of (set.questions || [])) {
      const answer = q.answer ?? q.target ?? q.sentence ?? (typeof q === "string" ? q : "");
      items.push({
        answer: String(answer),
        chunks: q.chunks || null,
        prefilled: q.prefilled || null,
        prefilled_positions: q.prefilled_positions || null,
        distractor: q.distractor ?? null,
        prompt: q.prompt ?? q.prompt_context ?? null,
        grammar_points: q.grammar_points || null,
        setId: sid,
      });
    }
  }
  return items;
}
// real corpus groups one "set" per exam source → regroup for intra-set stats
function groupBySource(jsonPath) {
  const j = JSON.parse(readFileSync(jsonPath, "utf8"));
  const map = {};
  for (const it of (j.items || [])) (map[it.source] = map[it.source] || []).push(String(it.target));
  return Object.values(map).map(arr => arr.map(a => ({ answer: a })));
}

/* ─────────────── aggregate metrics ─────────────── */
function aggregate(items) {
  const fs = items.map(it => ({ ...it, f: features(it.answer) }));
  const Ws = fs.map(x => x.f.W);
  const lenBands = { easy: rate(fs, x => x.f.band === "easy"), med: rate(fs, x => x.f.band === "med"), hard: rate(fs, x => x.f.band === "hard") };
  const sr = k => rate(fs, x => x.f[k]);
  // opening-trigram diversity & exact-dup
  const opens = fs.map(x => x.answer.toLowerCase().split(/\s+/).slice(0, 3).join(" "));
  const norm = fs.map(x => x.answer.toLowerCase().replace(/[^a-z ]/g, "").trim());
  const openDiv = items.length ? new Set(opens).size / items.length : 0;
  const exactDup = items.length ? 1 - new Set(norm).size / items.length : 0;
  // hard-band conditional profile (length>=12)
  const hb = fs.filter(x => x.f.band === "hard");
  return {
    n: items.length,
    length: { mean: r2(mean(Ws)), median: pct(Ws, 50), p10: pct(Ws, 10), p90: pct(Ws, 90), max: Math.max(0, ...Ws) },
    length_bands: { easy: r3(lenBands.easy), med: r3(lenBands.med), hard: r3(lenBands.hard) },
    structure: { relative_clause: r3(sr("relClause")), passive: r3(sr("passive")), embedded_question: r3(sr("embeddedQ")), negation: r3(sr("negation")), modal: r3(sr("modal")), subordinate: r3(sr("subord")) },
    register: { first_person: r3(sr("firstPerson")), contraction: r3(sr("contraction")), casual_opener: r3(sr("casualOpener")), third_person_formal: r3(sr("thirdFormal")) },
    hard_band_profile: { n: hb.length, first_person: r3(rate(hb, x => x.f.firstPerson)), relative_clause: r3(rate(hb, x => x.f.relClause)), passive: r3(rate(hb, x => x.f.passive)) },
    diversity: { opening_trigram_diversity: r3(openDiv), exact_dup_rate: r3(exactDup) },
    _items: fs,
  };
}

/* ─────────────── DERIVE the standard from the real corpus ─────────────── */
function computeStandard() {
  const real = normalize(JSON.parse(readFileSync(REAL_PATH, "utf8")));
  const agg = aggregate(real);
  // intra-set: per exam paper
  const sets = groupBySource(REAL_PATH).filter(g => g.length >= 6);
  const setMix = sets.map(g => { const b = aggregate(g).length_bands; const idx = aggregate(g)._items.map(x => x.f.index); return { ...b, range: Math.max(...idx) - Math.min(...idx) }; });
  const std = {
    type: "bs",
    derived_from: `${REAL_PATH} (n=${agg.n}, ${sets.length} exam papers, tier=recalled)`,
    derived_by: "scripts/bs-difficulty-scorer.mjs --derive",
    note: "recalled corpus → tolerances are intentionally WIDE; relClause/passive are direction-only (detector ~80-90%).",
    difficulty: {
      length_bands: { easy_le7: r3(agg.length_bands.easy), med_8_11: r3(agg.length_bands.med), hard_ge12: r3(agg.length_bands.hard), tol_pp: 0.05, gate: true },
      length_words: agg.length,
    },
    register: {
      first_person: { target: agg.register.first_person, band: [r2(agg.register.first_person - 0.07), r2(agg.register.first_person + 0.07)], gate: true },
      contraction: { target: agg.register.contraction, band: [r2(agg.register.contraction - 0.05), r2(agg.register.contraction + 0.06)], gate: true },
      third_person_formal: { target: agg.register.third_person_formal, max: r2(agg.register.third_person_formal + 0.05), gate: true },
      casual_opener: { target: agg.register.casual_opener, band: [0.04, 0.18], gate: false },
    },
    structure_direction_only: agg.structure,
    hard_band_profile: agg.hard_band_profile,
    diversity: { opening_trigram_diversity_min: r2(agg.diversity.opening_trigram_diversity - 0.05), exact_dup_max: 0.02, gate: true },
    intra_set: {
      per_set_items: 10,
      typical_mix: { easy: r2(mean(setMix.map(m => m.easy))), med: r2(mean(setMix.map(m => m.med))), hard: r2(mean(setMix.map(m => m.hard))) },
      min_index_range: Math.round(pct(setMix.map(m => m.range), 15)),
      rule: "every set must contain easy AND med AND hard; no single-band set",
      gate: true,
    },
    correctness: {
      reconstructable_from_chunks: { target: 1.0, gate: true },
      distractor_presence: { target: 0.0, policy: "real render shows 0 distractor tiles; MONITOR (reconcile vs etsProfile 82%)", gate: false },
      unique_arrangement: { verdict: "deferred-to-word-audit", gate: "human" },
      grammatical_and_reads_real: { verdict: "deferred-to-word-audit", gate: "human" },
    },
  };
  // prompt register — from the RAW real corpus prompts (OCR noise filtered). 2026-06-10 user
  // morning-review caught generated prompts collapsing to statements (2% questions vs real ~71%).
  try {
    const NOISE = /make an appropriate|screen-|hide tim|mp4|^\d/i;
    const pReal = JSON.parse(readFileSync("data/realExam2026/writing/buildSentence.json", "utf8"))
      .items.map(it => it.prompt_context).filter(p => p && !NOISE.test(String(p).trim()) && String(p).trim().length > 10);
    if (pReal.length >= 50) {
      const eq = rate(pReal, p => /\?\s*$/.test(p.trim()));
      const ay = rate(pReal, p => /\b(you|your)\b/i.test(p));
      std.prompt_register = {
        n: pReal.length,
        ends_question: { target: r3(eq), band: [r2(eq - 0.2), r2(Math.min(0.98, eq + 0.25))], gate: true },
        addresses_you: { target: r3(ay), band: [r2(ay - 0.18), r2(Math.min(0.95, ay + 0.2))], gate: true },
      };
    }
  } catch { /* corpus absent → prompt gates simply not emitted */ }
  // prefilled register — NOT derivable from the targets corpus (render-layer dimension). Values
  // INHERITED from organizational memory: lib/questionBank/etsProfile.js PREFILLED_PROFILE
  // (hand-coded real TPO render sample; the file documents the exact bug this gate prevents:
  // anchors collapsing to first-word bare subject pronouns) + eval-profiles/bs.json. Wide bands.
  std.prefilled_register = {
    source: "etsProfile.PREFILLED_PROFILE + eval-profiles/bs.json (inherited, not corpus-derived)",
    presence: { target: 0.85, band: [0.68, 0.97], gate: true },
    bare_subject_pronoun: { target: 0.30, max: 0.45, gate: true },
    multi_anchor: { target: 0.25, band: [0.08, 0.45], gate: true },
    non_start_position: { target: 0.35, min: 0.10, gate: true },
  };
  // answer style monitors (direction-only): real answers spread their openers; generated batches
  // drifted to 51% I/I'm openers vs real ~31% and under-used the do-you-know signature.
  std.answer_style_monitor = {
    signature_q_rate: { target: r3(rate(real, it => /^(do you know|can you tell me|could you tell me)/i.test(it.answer.trim()))) },
    first_person_opener: (() => { const t = rate(real, it => /^(i|i'm|i'd|i've|i'll|my)\b/i.test(it.answer.trim())); return { target: r3(t), warn_above: r2(t + 0.15) }; })(),
  };
  return std;
}
function deriveStandard() {
  const std = computeStandard();
  writeFileSync(STANDARD_PATH, JSON.stringify(std, null, 2));
  console.log("✓ wrote", STANDARD_PATH);
  console.log(JSON.stringify(std, null, 2));
  return std;
}

/* ─────────────── per-item word-by-word audit ─────────────── */
function auditItem(it) {
  const f = features(it.answer);
  const flags = [];
  let reconstructable = null;
  if (it.chunks) {
    // tiles may be MULTI-word ("the bus", "pick up") → tokenize to words before multiset compare.
    const tileWords = arr => arr.flatMap(t => words(t).map(w => w.toLowerCase()));
    const poolMinus = tileWords([...it.chunks, ...(it.prefilled || [])]);
    const dis = it.distractor == null ? [] : tileWords(Array.isArray(it.distractor) ? it.distractor : [it.distractor]);
    for (const d of dis) { const i = poolMinus.indexOf(d); if (i >= 0) poolMinus.splice(i, 1); }
    const ansW = words(it.answer).map(w => w.toLowerCase());
    const ms = a => a.slice().sort().join("|");
    reconstructable = ms(poolMinus) === ms(ansW);
    // NOTE: word-multiset equality is necessary; exact tile-ordering/uniqueness is deferred to word-audit.
    if (!reconstructable) flags.push("RECONSTRUCT_FAIL(词块词集≠答案词集)");
  }
  if (it.distractor != null && (Array.isArray(it.distractor) ? it.distractor.length : 1) > 0) flags.push("HAS_DISTRACTOR(真题=0)");
  if (f.W < 4) flags.push("TOO_SHORT");
  // prompt-answer coherence heuristic
  if (it.prompt) {
    const pc = new Set(words(it.prompt).map(w => w.toLowerCase()));
    const shared = words(it.answer).filter(w => pc.has(w.toLowerCase()) && w.length > 3).length;
    if (shared === 0 && !f.firstPerson) flags.push("LOW_PROMPT_COHERENCE?");
  }
  return {
    answer: it.answer.trim(), setId: it.setId, W: f.W, band: f.band, index: f.index,
    struct: ["embeddedQ", "relClause", "subord", "passive", "negation", "modal"].filter(k => f[k]),
    register: ["firstPerson", "contraction", "casualOpener", "thirdFormal"].filter(k => f[k]),
    reconstructable, flags,
    needs_human: ["语法正确?", "排列唯一合理?", "读着像真题口吻?"],
  };
}

/* ─────────────── compare batch to standard → verdict ─────────────── */
function score(file) {
  if (!existsSync(STANDARD_PATH)) { console.error("standard missing — run --derive first"); process.exit(2); }
  const std = JSON.parse(readFileSync(STANDARD_PATH, "utf8"));
  const items = normalize(JSON.parse(readFileSync(file, "utf8")));
  const agg = aggregate(items);
  const checks = [];
  const chk = (name, ok, detail) => checks.push({ name, verdict: ok ? "PASS" : "FAIL", detail });
  const warn = (name, detail) => checks.push({ name, verdict: "WARN", detail });

  // length bands (gate)
  const lb = std.difficulty.length_bands, tol = lb.tol_pp;
  for (const [k, key] of [["easy", "easy_le7"], ["med", "med_8_11"], ["hard", "hard_ge12"]]) {
    const got = agg.length_bands[k], want = lb[key];
    chk(`length_band.${k}`, Math.abs(got - want) <= tol, `got ${got} want ${want}±${tol}`);
  }
  // register gates
  const fp = std.register.first_person; chk("register.first_person", agg.register.first_person >= fp.band[0] && agg.register.first_person <= fp.band[1], `got ${agg.register.first_person} band ${JSON.stringify(fp.band)}`);
  const co = std.register.contraction; chk("register.contraction", agg.register.contraction >= co.band[0] && agg.register.contraction <= co.band[1], `got ${agg.register.contraction} band ${JSON.stringify(co.band)}`);
  const tf = std.register.third_person_formal; chk("register.third_person_formal", agg.register.third_person_formal <= tf.max, `got ${agg.register.third_person_formal} max ${tf.max}`);
  // diversity gate
  chk("diversity.opening", agg.diversity.opening_trigram_diversity >= std.diversity.opening_trigram_diversity_min, `got ${agg.diversity.opening_trigram_diversity} min ${std.diversity.opening_trigram_diversity_min}`);
  chk("diversity.exact_dup", agg.diversity.exact_dup_rate <= std.diversity.exact_dup_max, `got ${agg.diversity.exact_dup_rate} max ${std.diversity.exact_dup_max}`);
  // intra-set: no single-band set (only if multiple sets present)
  const bySet = {}; for (const x of agg._items) (bySet[x.setId ?? "_"] = bySet[x.setId ?? "_"] || []).push(x.f.band);
  const singleBand = Object.entries(bySet).filter(([, b]) => new Set(b).size === 1 && b.length >= 4);
  if (Object.keys(bySet).length > 1) chk("intra_set.mixed", singleBand.length === 0, singleBand.length ? `${singleBand.length} single-band set(s)` : "all sets mixed");
  // distractor diversity — aligned with the LIVE gate (lib/quality/scoreBatch.mjs): per set
  // ≥4 distinct, no single word >50%. All-"did" collapse is a previously-fixed regression.
  const dBySet = {}; for (const x of agg._items) if (x.distractor != null) (dBySet[x.setId ?? "_"] = dBySet[x.setId ?? "_"] || []).push(String(x.distractor).toLowerCase());
  const dFails = [];
  for (const [sid, arr] of Object.entries(dBySet)) {
    if (arr.length < 6) continue;
    const counts = {}; arr.forEach(d => counts[d] = (counts[d] || 0) + 1);
    const distinct = Object.keys(counts).length, top = Math.max(...Object.values(counts)) / arr.length;
    if (distinct < 4 || top > 0.5) dFails.push(`set ${sid}: distinct=${distinct} top=${Math.round(top * 100)}%`);
  }
  if (Object.keys(dBySet).length) chk("distractor.diversity", dFails.length === 0, dFails.length ? dFails.join("; ") : "≥4 distinct & top≤50% per set");
  // prompt register gates (only when the batch carries prompts; real targets corpus has none)
  const withPrompt = agg._items.filter(x => x.prompt);
  if (std.prompt_register && withPrompt.length >= 10) {
    const eq = rate(withPrompt, x => /\?\s*$/.test(String(x.prompt).trim()));
    const ay = rate(withPrompt, x => /\b(you|your)\b/i.test(String(x.prompt)));
    const pr = std.prompt_register;
    chk("prompt.ends_question", eq >= pr.ends_question.band[0] && eq <= pr.ends_question.band[1], `got ${r3(eq)} band ${JSON.stringify(pr.ends_question.band)} (real ${pr.ends_question.target})`);
    chk("prompt.addresses_you", ay >= pr.addresses_you.band[0] && ay <= pr.addresses_you.band[1], `got ${r3(ay)} band ${JSON.stringify(pr.addresses_you.band)} (real ${pr.addresses_you.target})`);
  }
  // prefilled register gates (only when the batch carries prefilled metadata)
  const withPf = agg._items.filter(x => Array.isArray(x.prefilled));
  if (std.prefilled_register && withPf.length >= 10) {
    const pr = std.prefilled_register;
    const has = withPf.filter(x => x.prefilled.length > 0);
    const presence = has.length / withPf.length;
    const PRON = new Set(["i", "we", "she", "he", "they", "it", "you"]);
    const bare = has.length ? rate(has, x => x.prefilled.length === 1 && PRON.has(String(x.prefilled[0]).trim().toLowerCase())) : 0;
    const multi = has.length ? rate(has, x => x.prefilled.length >= 2) : 0;
    const nonStart = has.length ? rate(has, x => Object.values(x.prefilled_positions || {}).some(p => p > 0)) : 0;
    chk("prefilled.presence", presence >= pr.presence.band[0] && presence <= pr.presence.band[1], `got ${r3(presence)} band ${JSON.stringify(pr.presence.band)}`);
    chk("prefilled.bare_pronoun", bare <= pr.bare_subject_pronoun.max, `got ${r3(bare)} max ${pr.bare_subject_pronoun.max}`);
    chk("prefilled.multi_anchor", multi >= pr.multi_anchor.band[0] && multi <= pr.multi_anchor.band[1], `got ${r3(multi)} band ${JSON.stringify(pr.multi_anchor.band)}`);
    chk("prefilled.non_start_position", nonStart >= pr.non_start_position.min, `got ${r3(nonStart)} min ${pr.non_start_position.min}`);
  }
  // answer style (direction-only WARNs — fixed by rebalancing NEW batches, not rewriting judged ones)
  if (std.answer_style_monitor) {
    const io = rate(agg._items, x => /^(i|i'm|i'd|i've|i'll|my)\b/i.test(x.answer.trim()));
    const sg = rate(agg._items, x => /^(do you know|can you tell me|could you tell me)/i.test(x.answer.trim()));
    const mon = std.answer_style_monitor;
    if (io > mon.first_person_opener.warn_above) warn("answer.first_person_opener(dir-only)", `got ${r3(io)} vs real ${mon.first_person_opener.target} — 新批须低I开头补偏`);
    if (Math.abs(sg - mon.signature_q_rate.target) > 0.10) warn("answer.signature_q(dir-only)", `got ${r3(sg)} vs real ${mon.signature_q_rate.target}`);
  }
  // correctness (per-item, gate)
  const audits = agg._items.map(x => auditItem(x));
  const reconItems = audits.filter(a => a.reconstructable !== null);
  const reconFail = reconItems.filter(a => a.reconstructable === false).length;
  if (reconItems.length) chk("correctness.reconstructable", reconFail === 0, `${reconFail}/${reconItems.length} fail`);
  else warn("correctness.reconstructable", "no chunks in batch — cannot auto-check; word-audit must verify");
  // structure direction-only → WARN if far from real
  for (const k of ["relative_clause", "passive"]) {
    const got = agg.structure[k], want = std.structure_direction_only[k];
    if (Math.abs(got - want) > 0.12) warn(`structure.${k}(dir-only)`, `got ${got} vs real ${want} — informational`);
  }

  const fails = checks.filter(c => c.verdict === "FAIL");
  const aggregateVerdict = fails.length === 0 ? "PASS" : "FAIL";
  // FORCE word-audit whenever aggregate PASSES (insurance against proxy-gaming)
  const forceWordAudit = aggregateVerdict === "PASS";
  // risk-ranked items for mandatory reading
  const risky = [...audits].sort((a, b) =>
    (b.flags.length - a.flags.length) || (b.W - a.W)).slice(0, Math.min(12, audits.length));

  const scorecard = {
    file, n: agg.n, aggregateVerdict, forceWordAudit,
    checks, metrics: { length: agg.length, length_bands: agg.length_bands, register: agg.register, structure: agg.structure, diversity: agg.diversity, hard_band_profile: agg.hard_band_profile },
    per_item_audit: audits,
  };
  // write ledger
  const stamp = file.replace(/[\\/]/g, "_").replace(/\.json$/, "");
  const ledgerPath = `data/claudeGen/reports/scorecard_${stamp}.json`;
  writeFileSync(ledgerPath, JSON.stringify(scorecard, null, 2));

  // ── human-readable summary ──
  console.log(`\n══ BS SCORECARD: ${file}  (n=${agg.n}) ══`);
  console.log(`长度档 易/中/难 = ${agg.length_bands.easy}/${agg.length_bands.med}/${agg.length_bands.hard}  (真题 ${std.difficulty.length_bands.easy_le7}/${std.difficulty.length_bands.med_8_11}/${std.difficulty.length_bands.hard_ge12})`);
  console.log(`语域 第一人称/缩写/三人称正式 = ${agg.register.first_person}/${agg.register.contraction}/${agg.register.third_person_formal}`);
  console.log(`多样性 开头三元组/重复 = ${agg.diversity.opening_trigram_diversity}/${agg.diversity.exact_dup_rate}`);
  console.log(`结构(看方向) 关系从句/被动 = ${agg.structure.relative_clause}/${agg.structure.passive}`);
  console.log("\n判定:");
  for (const c of checks) console.log(`  ${c.verdict === "PASS" ? "✓" : c.verdict === "WARN" ? "~" : "✗"} ${c.name}: ${c.detail}`);
  console.log(`\n聚合判定: ${aggregateVerdict}${fails.length ? " ("+fails.length+" FAIL)" : ""}`);
  if (forceWordAudit) {
    console.log("\n⚠ 聚合看似通过 → 强制逐字审核（保险）。必须人/LLM 逐条核对以下高风险项，确认无问题再接受：");
    for (const a of risky) console.log(`  [${a.band} ${a.W}w${a.flags.length ? " ⚑"+a.flags.join(",") : ""}] "${a.answer}"  结构{${a.struct.join(",")}}`);
    console.log(`\n  完整逐字 ledger（每条含 needs_human 清单: 语法/唯一排列/真题口吻）→ ${ledgerPath}`);
    console.log("  约定：逐字审核未完成且通过前，本批不得标记 accepted。");
  } else {
    console.log(`\n未过聚合 → 先改 FAIL 项再重生。ledger → ${ledgerPath}`);
  }
  return scorecard;
}

/* ─────────────── self-check: prove the scorer discriminates ─────────────── */
function selfcheckCore(quiet = false) {
  const std = existsSync(STANDARD_PATH) ? JSON.parse(readFileSync(STANDARD_PATH, "utf8")) : deriveStandard();
  const realAgg = aggregate(normalize(JSON.parse(readFileSync(REAL_PATH, "utf8"))));
  const v2Agg = aggregate(normalize(JSON.parse(readFileSync(V2_PATH, "utf8"))));
  const lb = std.difficulty.length_bands;
  const realHardOk = Math.abs(realAgg.length_bands.hard - lb.hard_ge12) <= lb.tol_pp;
  const v2HardFail = Math.abs(v2Agg.length_bands.hard - lb.hard_ge12) > lb.tol_pp;
  const ok = realHardOk && v2HardFail;
  if (!quiet) {
    console.log("══ SELF-CHECK (打分器判别力验证) ══");
    console.log(`真题(应=标准) 难档=${realAgg.length_bands.hard} 中位词数=${realAgg.length.median} 第一人称=${realAgg.register.first_person}`);
    console.log(`V2线上(应退化) 难档=${v2Agg.length_bands.hard} 中位词数=${v2Agg.length.median} 第一人称=${v2Agg.register.first_person}`);
    console.log(`\n判别结果: 真题难档达标=${realHardOk ? "✓PASS" : "✗"}   V2难档退化检出=${v2HardFail ? "✓检出FAIL" : "✗未检出"}`);
    console.log(ok ? "\n✓ 打分器可信：真题判达标、V2判退化。" : "\n✗ 打分器判别力不足 — 修正后再用，切勿用它驱动循环。");
  }
  return ok;
}

/* ─────────────── GATE: full anti-regression check for a candidate bank ───────────────
 * Layers (any FAIL → exit 1; instrument problems → exit 2):
 *   0. instrument  — selfcheck must still discriminate real-vs-V2 (scorer rot guard)
 *   1. standard    — frozen standard must match a fresh in-memory re-derive (stale-standard guard)
 *   2. hard gates  — everything score() already gates (difficulty bands / register / diversity /
 *                    intra-set mixing / reconstructability)
 *   3. drift bands — structure dims measured by the SAME detector on both corpora; systematic
 *                    detector bias cancels in the ratio, so share-ratio outside [0.4x, 2.5x] of the
 *                    real share is real drift, not detector noise. Only dims with real share ≥5%.
 *                    Also gates casual_opener against its standard band (was monitor-only; its 0%
 *                    collapse in early claudeGen batches is exactly the drift this layer exists for).
 * Every run appends one line to bs-quality-history.jsonl for trend visibility.
 */
const HISTORY_PATH = "data/claudeGen/reports/bs-quality-history.jsonl";
const DRIFT_BAND = [0.4, 2.5];
function gate(file) {
  if (!existsSync(file)) { console.error(`gate: file not found: ${file}`); process.exit(2); }
  if (!existsSync(STANDARD_PATH)) { console.error("gate: standard missing — run --derive first"); process.exit(2); }
  console.log(`\n════════ BS REGRESSION GATE: ${file} ════════\n`);

  // 0. instrument
  if (!selfcheckCore(true)) {
    console.log("✗ [instrument] 打分器自校验失败（真题/V2 判别力丢失）— 仪器不可信，先修打分器。");
    process.exit(2);
  }
  console.log("✓ [instrument] selfcheck: 真题判达标 / V2判退化");

  // 1. standard freshness
  const std = JSON.parse(readFileSync(STANDARD_PATH, "utf8"));
  const fresh = computeStandard();
  const staleKeys = [];
  for (const k of ["easy_le7", "med_8_11", "hard_ge12"]) {
    if (Math.abs(std.difficulty.length_bands[k] - fresh.difficulty.length_bands[k]) > 0.005) staleKeys.push(`length.${k}`);
  }
  for (const k of ["first_person", "contraction", "third_person_formal", "casual_opener"]) {
    if (Math.abs(std.register[k].target - fresh.register[k].target) > 0.005) staleKeys.push(`register.${k}`);
  }
  if (staleKeys.length) {
    console.log(`✗ [standard] 冻结标准与真题语料当前重算不一致 (${staleKeys.join(", ")}) — 语料或检测器变了，先 --derive 重冻并 review。`);
    process.exit(2);
  }
  console.log("✓ [standard] 冻结标准与现重算一致");

  // 2. hard gates (score() prints its own scorecard)
  const sc = score(file);

  // 3. drift bands
  const driftFails = [];
  const structReal = std.structure_direction_only;
  for (const [k, want] of Object.entries(structReal)) {
    if (want < 0.05) continue; // sub-5% real share → ratio too noisy to gate
    const got = sc.metrics.structure[k];
    const ratio = got / want;
    const ok = ratio >= DRIFT_BAND[0] && ratio <= DRIFT_BAND[1];
    if (!ok) driftFails.push(`${k}: got ${got} vs real ${want} (ratio ${ratio.toFixed(2)}x, band ${DRIFT_BAND[0]}–${DRIFT_BAND[1]}x)`);
  }
  const co = sc.metrics.register.casual_opener ?? 0;
  const coBand = std.register.casual_opener.band;
  if (co < coBand[0] || co > coBand[1]) driftFails.push(`casual_opener: got ${co} band ${JSON.stringify(coBand)}`);
  console.log("\n[drift bands] 结构/语气漂移带 (同检测器比率, band 0.4–2.5x):");
  if (driftFails.length) driftFails.forEach(d => console.log(`  ✗ ${d}`));
  else console.log("  ✓ 全部在带内");

  // verdict + history
  const verdict = sc.aggregateVerdict === "PASS" && driftFails.length === 0 ? "PASS" : "FAIL";
  const rec = {
    ts: new Date().toISOString(), file, n: sc.n, verdict,
    length_bands: sc.metrics.length_bands, register: sc.metrics.register, structure: sc.metrics.structure,
    diversity: sc.metrics.diversity,
    hard_gate_fails: sc.checks.filter(c => c.verdict === "FAIL").map(c => c.name),
    drift_fails: driftFails,
  };
  // History is telemetry only — a missing dir (data/claudeGen/ is untracked, so absent
  // on a fresh CI checkout) must NEVER crash the gate verdict that callers depend on.
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    appendFileSync(HISTORY_PATH, JSON.stringify(rec) + "\n");
  } catch (e) {
    console.warn(`(history log skipped: ${e.message})`);
  }
  console.log(`\n════ GATE 总判定: ${verdict} ════  (history → ${HISTORY_PATH})`);
  if (verdict === "FAIL") console.log("不得并库/不得标记收敛。修复后重跑 gate。");
  process.exit(verdict === "PASS" ? 0 : 1);
}

/* ─────────────── main ─────────────── */
const arg = process.argv[2];
if (arg === "--derive") deriveStandard();
else if (arg === "--selfcheck") process.exit(selfcheckCore(false) ? 0 : 1);
else if (arg === "--score" && process.argv[3]) score(process.argv[3]);
else if (arg === "--gate" && process.argv[3]) gate(process.argv[3]);
else { console.log("usage: node scripts/bs-difficulty-scorer.mjs [--derive | --selfcheck | --score <file> | --gate <file>]"); process.exit(1); }
