// Regression lock for the BS person-prefilled fix (2026-05-29).
//
// History: the "prefilled is overwhelmingly he/she/names" problem was fixed
// repeatedly and kept regressing, because the calibration lived in prompt
// text / a retry loop with NO automated test asserting the output matches
// it. When prompts were rewritten or the pipeline migrated, the soft signal
// silently stopped working.
//
// This test makes that regression LOUD: if the measurement primitive, the
// scoring axis, the gate threshold, or the TPO ground-truth ever break, CI
// goes red and blocks the merge. It cannot guarantee the (non-deterministic)
// generator stays at 30% — but it guarantees the SAFETY NET that catches
// drift cannot silently rot.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCOREBATCH = path.join(ROOT, "lib/quality/scoreBatch.mjs");

let mod;
beforeAll(async () => {
  // scoreBatch.mjs is ESM; load via dynamic import.
  mod = await import("../lib/quality/scoreBatch.mjs");
});

// ── Helpers to build synthetic BS items with a given prefilled ───────────
function bsItem(id, answer, prefilled, distractor = "did") {
  // chunks = answer words minus prefilled words, plus distractor.
  const ansWords = answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  const pfWords = new Set(prefilled.join(" ").toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean));
  const chunkWords = ansWords.filter((w) => !pfWords.has(w));
  // group into a few multi-word chunks so effective-chunk count is realistic
  const chunks = [];
  for (let i = 0; i < chunkWords.length; i += 2) chunks.push(chunkWords.slice(i, i + 2).join(" "));
  if (distractor) chunks.push(distractor);
  const positions = {};
  prefilled.forEach((seg) => {
    const idx = ansWords.indexOf(seg.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/)[0]);
    positions[seg.toLowerCase().replace(/[.,!?;:]/g, "")] = idx >= 0 ? idx : 0;
  });
  return {
    id, prompt: "What did someone ask?", answer,
    chunks, prefilled, prefilled_positions: positions,
    distractor: distractor || null, has_question_mark: false, grammar_points: ["test"],
  };
}

// Build a 10-item batch with `nPerson` items anchored on a person, the rest
// anchored on varied non-person words.
function batch(nPerson) {
  const personPrefills = [["she"], ["he"], ["they"], ["Olivia"], ["Margot"], ["Hector"], ["Emma"], ["Julian"], ["I"], ["Naomi"]];
  const nonPersonPrefills = [["wanted to know"], ["Unfortunately,"], ["the registrar"], ["to me"], ["found out"], ["the package"], ["why"], [], ["in the basement"], ["the official"]];
  const items = [];
  for (let i = 0; i < 10; i++) {
    if (i < nPerson) items.push(bsItem(`p${i}`, "she wanted to know whether the lab was open today", personPrefills[i % personPrefills.length]));
    else items.push(bsItem(`n${i}`, "she wanted to know whether the lab was open today", nonPersonPrefills[i % nonPersonPrefills.length]));
  }
  return items;
}

function scoreSynthetic(items) {
  // scoreBatch reads staging files by session id; write a temp staging file.
  const session = `_regtest_${Math.abs(items.length * 7 + (items[0]?.id || "x").length)}`;
  const stagingDir = path.join(ROOT, "data/buildSentence/staging");
  const file = path.join(stagingDir, `${session}.json`);
  fs.writeFileSync(file, JSON.stringify({ items }));
  try {
    const r = mod.scoreBatch(ROOT, session, { bs: { accepted: items.length } });
    return r.perBank.bs.diversity;
  } finally {
    fs.unlinkSync(file);
  }
}

// ──────────────────────────────────────────────────────────────────────
describe("isPersonPrefilled — measurement primitive (Hole 2 lock)", () => {
  test("subject pronouns are person", () => {
    for (const w of ["I", "he", "she", "they", "we", "He", "She"]) {
      expect(mod.isPersonPrefilled(w)).toBe(true);
    }
  });
  test("proper names are person", () => {
    for (const w of ["Olivia", "Margot", "Professor Cho", "Hector"]) {
      expect(mod.isPersonPrefilled(w)).toBe(true);
    }
  });
  test("non-person anchors are NOT person", () => {
    for (const w of ["wanted to know", "Unfortunately,", "the desk", "the registrar", "to me", "in the basement", "found out", "why", "the official", "fun", "yet"]) {
      expect(mod.isPersonPrefilled(w)).toBe(false);
    }
  });
  test("multi-segment with a person anywhere counts as person", () => {
    // matches TPO measurement methodology (any segment)
    expect(["wanted to know"].some((s) => mod.isPersonPrefilled(s))).toBe(false);
    expect(["he", "yet"].some((s) => mod.isPersonPrefilled(s))).toBe(true);
    expect(["Margot", "deadline"].some((s) => mod.isPersonPrefilled(s))).toBe(true);
  });
});

describe("scoreBatch person axis — scoring bands (Hole 1 lock)", () => {
  test("60% person batch is detected as high", () => {
    const d = scoreSynthetic(batch(6));
    expect(d.detail.personFrac).toBeCloseTo(0.6, 2);
  });
  test("30% person batch (TPO-like) measured correctly", () => {
    const d = scoreSynthetic(batch(3));
    expect(d.detail.personFrac).toBeCloseTo(0.3, 2);
  });
  test("a TPO-like 30% batch scores higher than a 60% batch", () => {
    const good = scoreSynthetic(batch(3));
    const bad = scoreSynthetic(batch(6));
    expect(good.score).toBeGreaterThan(bad.score);
  });
});

describe("gate threshold — single source of truth (Hole 3 lock)", () => {
  test("PERSON_PREFILLED_GATE is exported and = 0.45", () => {
    expect(mod.PERSON_PREFILLED_GATE).toBe(0.45);
  });
  test("isPersonOveruse flags >45%, passes ≤45%", () => {
    expect(mod.isPersonOveruse(0.6)).toBe(true);
    expect(mod.isPersonOveruse(0.5)).toBe(true);
    expect(mod.isPersonOveruse(0.45)).toBe(false); // exactly at gate passes
    expect(mod.isPersonOveruse(0.3)).toBe(false);
    expect(mod.isPersonOveruse(0.15)).toBe(false);
  });
  test("check-quality-gates.mjs imports the shared constant (no hardcoded 0.45)", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/check-quality-gates.mjs"), "utf8");
    expect(src).toMatch(/isPersonOveruse|PERSON_PREFILLED_GATE/);
    // must NOT reintroduce a hardcoded magic threshold compare
    expect(src).not.toMatch(/personFrac\s*>\s*0\.45/);
  });
});

describe("distractor variety — collapse gate (locks the distractor fix)", () => {
  // The distractor regression: batches collapsed to 71% "did", ~3 distinct.
  // We gate on the COLLAPSE signal (one word dominating / too few distinct),
  // NOT a precise TPO match (TPO distractors can't be measured precisely).
  function distractorBatch(words) {
    // words: array of 10 distractor strings (one per item)
    return words.map((d, i) => bsItem(`d${i}`, "she wanted to know whether the lab was open today", [["she"], ["wanted to know"], ["the registrar"], ["to me"]][i % 4], d));
  }

  test("a collapsed all-did batch is detected (isDistractorCollapsed=true)", () => {
    const items = distractorBatch(Array(10).fill("did"));
    const d = scoreSynthetic(items).detail;
    expect(d.distinctDistractors).toBe(1);
    expect(d.topDistractorFrac).toBeCloseTo(1.0, 2);
    expect(mod.isDistractorCollapsed(d)).toBe(true);
  });

  test("today's pattern (7 did + 3 others) is detected as collapsed", () => {
    const items = distractorBatch(["did","did","did","did","did","did","did","does","do","is"]);
    const d = scoreSynthetic(items).detail;
    expect(d.topDistractorFrac).toBeGreaterThan(0.5);
    expect(mod.isDistractorCollapsed(d)).toBe(true);
  });

  test("a varied auxiliary-family batch passes the gate", () => {
    const items = distractorBatch(["did","do","does","is","was","were","can","have","had","not"]);
    const d = scoreSynthetic(items).detail;
    expect(d.distinctDistractors).toBeGreaterThanOrEqual(6);
    expect(d.topDistractorFrac).toBeLessThanOrEqual(0.5);
    expect(mod.isDistractorCollapsed(d)).toBe(false);
  });

  test("gate constants exported + check-quality-gates uses them", () => {
    expect(mod.DISTRACTOR_TOP_FRAC_GATE).toBe(0.5);
    expect(mod.DISTRACTOR_MIN_DISTINCT).toBe(4);
    const src = fs.readFileSync(path.join(ROOT, "scripts/check-quality-gates.mjs"), "utf8");
    expect(src).toMatch(/isDistractorCollapsed/);
  });

  test("prompt no longer says 'Mainly: did, do, does' (the root cause line)", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/bsGen/prompts.mjs"), "utf8");
    expect(src).not.toMatch(/Mainly:\s*did,\s*do,\s*does/);
    // and it must teach variety
    expect(src).toMatch(/SPREAD across the whole family|HARD VARIETY RULE/);
  });
});

describe("TPO ground truth — calibration lock (locks the target itself)", () => {
  // Re-measure tpo_source.md and assert the person-as-prefilled ratio is in
  // the expected band. If someone corrupts the source or the measurement
  // logic drifts, this fails loudly — so the "30% target" can't silently move.
  const tpoPath = path.join(ROOT, "data/buildSentence/tpo_source.md");

  test("tpo_source.md exists", () => {
    expect(fs.existsSync(tpoPath)).toBe(true);
  });

  test("real TPO person-as-prefilled ratio stays ~30% (band 25-45%)", () => {
    const raw = fs.readFileSync(tpoPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const items = [];
    let cur = null;
    for (const line of lines) {
      const qm = line.match(/^__(\d+)\\?\.__\s*(.*)/);
      if (qm) { if (cur && cur.template) items.push(cur); cur = { template: "" }; continue; }
      if (!cur) continue;
      if (line.includes("\\_")) cur.template += (cur.template ? " " : "") + line.trim();
    }
    if (cur && cur.template) items.push(cur);
    expect(items.length).toBeGreaterThanOrEqual(50); // sanity: ~60 items

    const PRON = /^(i|he|she|they|we)$/i;
    const COMMON = new Set(["unfortunately","yes","no","some","the","this","that","these","those","many","few","several","all","most","every","each","could","would","should","can","will","did","do","does","is","was","were","have","has","yet","fun","when","why","what","where","how","to","in","on","at"]);
    const isPerson = (seg) => seg.split(/\s+/).some((w) => {
      const c = w.replace(/[^A-Za-z']/g, "");
      return PRON.test(c) || (/^[A-Z][a-z]+$/.test(c) && !COMMON.has(c.toLowerCase()));
    });

    let person = 0;
    for (const it of items) {
      let t = it.template.replace(/\\_/g, "_").replace(/\\\./g, ".").replace(/\s+/g, " ").trim();
      t = t.replace(/__[^_]*__/g, " ").replace(/\s+/g, " ").trim();
      const segs = t.split(/_{2,}/).map((p) => p.replace(/[.?!,;:]/g, "").trim()).filter(Boolean);
      if (segs.some(isPerson)) person++;
    }
    const ratio = person / items.length;
    expect(ratio).toBeGreaterThanOrEqual(0.25);
    expect(ratio).toBeLessThanOrEqual(0.45);
  });
});
