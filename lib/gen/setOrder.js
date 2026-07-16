// Within-set question ordering for assembled banks.
//
// Real 2026 papers (data/realExam2026) show NO easy→hard progression inside a
// paper — word-count sequences like "13 6 12 12 10 8 7 12 9 4" are the norm.
// Authored/generated batches, however, are written easy-first, so any pipeline
// that ships sets in authoring order re-introduces a progression real exams
// don't have. Every set-assembly chokepoint must shuffle through here.
//
// The shuffle is SEEDED BY CONTENT (not Math.random) so builds stay
// reproducible: the same set of answers always yields the same order, and
// re-running an assembly/merge script is idempotent instead of churning diffs.

// FNV-1a 32-bit string hash → PRNG seed.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — tiny deterministic PRNG, plenty for a 10-element shuffle.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle seeded by seedStr. Returns a NEW array.
 */
function seededShuffle(arr, seedStr) {
  const rnd = mulberry32(hash32(String(seedStr)));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle a set's questions into a content-determined scrambled order.
 * The input is first canonicalized (sorted by answer) so the result is a pure
 * function of the set's CONTENT, independent of incoming array order — running
 * this on an already-shuffled set returns the same order (idempotent).
 * Questions keep their ids — only array order changes.
 */
function shuffleSetQuestions(questions, extraSeed = "") {
  const canon = [...questions].sort((a, b) => {
    const x = String(a?.answer ?? ""), y = String(b?.answer ?? "");
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const seed = extraSeed + "|" + canon.map((q) => q && q.answer).join("|");
  return seededShuffle(canon, seed);
}

module.exports = { seededShuffle, shuffleSetQuestions, hash32 };
