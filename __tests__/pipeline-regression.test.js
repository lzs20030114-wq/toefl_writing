// Regression locks for the nightly-pipeline machinery added/changed in this work:
//   - prune-staging deletion criteria (DESTRUCTIVE — must not drift)
//   - routine-audit CLI end-to-end (no answer-key leak; apply drops mis-keyed + receipt)
//   - scoreBatch quality: rich `score` vs errors-only `passRate` decoupling (the gate
//     keys on passRate, so warnings must move score but NOT passRate)
//
// Same philosophy as bs-person-prefilled.regression.test.js: make a silent
// regression LOUD so CI blocks it.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

// ── prune-staging: the destructive criteria (pure, imported — no deletion runs) ──
describe("prune-staging deletion criteria", () => {
  let P;
  beforeAll(async () => { P = await import("../scripts/prune-staging.mjs"); });

  test("routineDate parses R1 and R2 names, null for non-routine", () => {
    expect(P.routineDate("ap-routine-20260616-190442.json")).toBeInstanceOf(Date);
    expect(P.routineDate("rdl-routine-20260616-190442-short.json")).toBeInstanceOf(Date);
    expect(P.routineDate("lc-routine-r2-20260616-193500.json")).toBeInstanceOf(Date);
    // one-off / fixture names must NOT parse → never pruned
    expect(P.routineDate("la-WAVE1.json")).toBeNull();
    expect(P.routineDate("la-1780214182199.json")).toBeNull();
    expect(P.routineDate("questions.json")).toBeNull();
  });

  test("isPrunable: old dated routine → true; recent / non-dated / today → false", () => {
    const cutoff = P.cutoffFrom(14, new Date(Date.UTC(2026, 5, 20))); // 2026-06-06
    expect(P.isPrunable("ap-routine-20260601-190442.json", cutoff)).toBe(true);   // older than cutoff
    expect(P.isPrunable("ap-routine-20260616-190442.json", cutoff)).toBe(false);  // newer than cutoff
    expect(P.isPrunable("la-WAVE1.json", cutoff)).toBe(false);                     // no date → keep
    expect(P.isPrunable("ap-routine-20260606-000000.json", cutoff)).toBe(false);  // == cutoff day → keep (not strictly older)
    expect(P.isPrunable("notes.txt", cutoff)).toBe(false);                        // not .json
  });

  test("importing the module does not delete anything (CLI guard)", () => {
    // If the guard regressed, importing above in beforeAll would have run the prune
    // against the real staging dirs. Assert the module exposed only pure helpers and
    // a representative real staging file still exists.
    expect(typeof P.routineDate).toBe("function");
    // a known committed staging file should be untouched by import
    const sample = path.join(ROOT, "data/reading/staging");
    expect(fs.existsSync(sample)).toBe(true);
  });
});

// ── routine-audit CLI: blind extract (no leak) + apply drops mis-keyed + receipt ──
describe("routine-audit CLI end-to-end", () => {
  const SESSION = "_regtest_auditcli";
  const stagingFile = path.join(ROOT, `data/reading/staging/ap-${SESSION}.json`);
  const BLIND = path.join(ROOT, "data/.audit-blind.json");
  const SOLVED = path.join(ROOT, "data/.audit-solved.json");
  const REPORT = path.join(ROOT, "data/.audit-report.json");
  let savedReport = null;

  const apItem = (id) => ({
    id, passage: "A short passage for the regression test.",
    questions: [{ stem: "q?", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A" }],
  });

  beforeAll(() => {
    if (fs.existsSync(REPORT)) savedReport = fs.readFileSync(REPORT, "utf8");
    fs.writeFileSync(stagingFile, JSON.stringify({ items: [apItem("a0"), apItem("a1")] }));
  });
  afterAll(() => {
    for (const f of [stagingFile, BLIND, SOLVED]) if (fs.existsSync(f)) fs.unlinkSync(f);
    if (savedReport != null) fs.writeFileSync(REPORT, savedReport);
    else if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);
  });

  test("extract emits blind questions with NO answer key leaked", () => {
    execSync(`node scripts/routine-audit.mjs extract ${SESSION}`, { cwd: ROOT, stdio: "pipe" });
    const blind = JSON.parse(fs.readFileSync(BLIND, "utf8"));
    expect(blind.count).toBe(2);
    const blob = JSON.stringify(blind);
    expect(blob).not.toContain("correct_answer");
    // keys must be the stable per-question keys
    expect(blind.questions.map((q) => q.key).sort()).toEqual([
      `ap-${SESSION}.json#0#q0`, `ap-${SESSION}.json#1#q0`,
    ]);
  });

  test("apply drops the mis-keyed item and writes a receipt", () => {
    const answers = {
      [`ap-${SESSION}.json#0#q0`]: "A", // matches marked → keep
      [`ap-${SESSION}.json#1#q0`]: "B", // disagrees with marked A → drop a1
    };
    fs.writeFileSync(SOLVED, JSON.stringify({ answers }));
    execSync(`node scripts/routine-audit.mjs apply ${SESSION}`, { cwd: ROOT, stdio: "pipe" });

    const staging = JSON.parse(fs.readFileSync(stagingFile, "utf8"));
    expect(staging.items.map((i) => i.id)).toEqual(["a0"]); // a1 dropped

    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    expect(report.totals.rejected_items).toBe(1);
    expect(report.rejected[0]).toMatchObject({ marked: "A", claude: "B", id: "a1" });
  });
});

// ── scoreBatch: rich score vs errors-only passRate (gate decoupling) ──
describe("scoreBatch quality score/passRate decoupling", () => {
  let mod;
  const AP_PASSAGE = "Coral reefs form when tiny animals called polyps settle on hard surfaces and slowly build limestone skeletons around themselves. Over many centuries these skeletons accumulate into vast underwater structures that shelter thousands of species. The polyps depend on microscopic algae living inside their tissues, and the algae supply food through photosynthesis. When ocean water grows too warm, the algae are expelled and the coral loses its main energy source. This process, known as bleaching, can leave a reef pale and weakened. If warm conditions persist, large sections of the reef may die, and the many fish that rely on it for shelter must move elsewhere or perish in the barren ruins that remain.";
  const apQ = (stem, options, correct_answer) => ({ question_type: "factual_detail", stem, options, correct_answer });
  const validApItem = (i) => ({
    id: `ap${i}`, topic: "biology", subtopic: "coral", passage: AP_PASSAGE, paragraphs: [AP_PASSAGE],
    questions: [
      apQ("What do polyps build around themselves?", { A: "Limestone skeletons", B: "Soft tissue that dissolves in warm tropical seawater quickly", C: "Algae", D: "Sand" }, "A"),
      apQ("What do the algae supply to the polyps?", { A: "Shelter from predators that hunt across the reef at night", B: "Food", C: "Limestone", D: "Cooler water" }, "B"),
      apQ("What causes bleaching?", { A: "Heavy rain", B: "New fish", C: "Warm water", D: "Strong currents that carry polyps far away from the reef" }, "C"),
      apQ("What happens to fish when a reef dies?", { A: "They build new skeletons themselves over many following centuries", B: "They eat algae", C: "They grow larger", D: "They leave" }, "D"),
      apQ("What are coral skeletons made of?", { A: "Limestone", B: "Photosynthetic algae cells packed tightly within the tissue", C: "Plankton", D: "Salt" }, "A"),
    ],
  });

  beforeAll(async () => { mod = await import("../lib/quality/scoreBatch.mjs"); });

  function writeStaging(session, items) {
    const file = path.join(ROOT, `data/reading/staging/ap-${session}.json`);
    fs.writeFileSync(file, JSON.stringify({ items }));
    return file;
  }

  test("warnings move the rich score below 100 but keep passRate at 100", () => {
    // The valid AP item passes (no hard errors) but trips soft warnings
    // (paragraph count / no_contrast / question_type_diversity), so the gate signal
    // (passRate) stays 100 while the displayed score drops. If these ever couple,
    // the gate would false-trigger R2 on cosmetic warnings.
    const session = "_regtest_decouple_warn";
    const file = writeStaging(session, Array.from({ length: 5 }, (_, i) => validApItem(i)));
    try {
      const q = mod.scoreBatch(ROOT, session, { "reading-ap": { accepted: 5 } }).perBank["reading-ap"].quality;
      expect(q.passRate).toBe(100);
      expect(q.score).toBeGreaterThan(0);
      expect(q.score).toBeLessThan(100);
    } finally { fs.unlinkSync(file); }
  });

  test("a hard validator error drags passRate below 100", () => {
    const session = "_regtest_decouple_err";
    const file = writeStaging(session, Array.from({ length: 5 }, (_, i) => ({ ...validApItem(i), questions: [] })));
    try {
      const q = mod.scoreBatch(ROOT, session, { "reading-ap": { accepted: 5 } }).perBank["reading-ap"].quality;
      expect(q.passRate).toBeLessThan(100);
    } finally { fs.unlinkSync(file); }
  });
});
