/** Locks the actual restored questions, not a mocked build output. */
const { materialHash } = require("../scripts/realbank/reading_source_repairs");
const SS = require("../scripts/realbank/sentence_select");
const sourceLedger = require("../data/realBank/reading/source-repairs.json");
const sentenceLedger = require("../data/realBank/reading/sentence-select.json");
const ap = require("../data/realBank/reading/ap.json").items;
const rdl = require("../data/realBank/reading/rdl.json").items;
const aliases = require("../data/realBank/reading/id-aliases.json").aliases;

test("all nine source-restored insertion questions retain their audited final passage and four positions", () => {
  const repairs = sourceLedger.entries.filter((e) => e.promote && /four locations/i.test((e.original_record_sha256 ? e.patch.items[0] : e.patch).stem || ""));
  expect(repairs).toHaveLength(9);
  for (const e of repairs) {
    const repaired = e.original_record_sha256 ? e.patch.items[0] : e.patch;
    const hosts = ap.filter((x) => x.source === e.set && Number(x.id.split("_")[3]) === e.module && x.questions.some((q) => q.q_number === e.q));
    expect(hosts).toHaveLength(1);
    const host = hosts[0];
    expect(host.questions.filter((q) => q.q_number === e.q)).toHaveLength(1);
    expect(host.passage.match(/\[[ABCD]\]/g)).toEqual(["[A]", "[B]", "[C]", "[D]"]);
    expect(materialHash(host.passage.trim())).toBe(materialHash(repaired.material.trim()));
    expect(host.questions.find((q) => q.q_number === e.q).correct_answer).toBe("ABCD"[repaired.answer_index]);
  }
});

test("the restored sentence selections address the real displayed paragraph and retain their exact audit hash", () => {
  const passes = SS.passingHashes(sentenceLedger);
  for (const [id, qnum, paragraph] of [["real_ap_128a_1_27", 29, 4], ["real_ap_318_2_11", 14, 2]]) {
    const host = ap.find((x) => x.id === id);
    const qs = host.questions.filter((q) => q.q_number === qnum);
    expect(qs).toHaveLength(1);
    const q = qs[0];
    expect(SS.isSentenceSelectQuestion(q)).toBe(true);
    expect(q.paragraph).toBe(paragraph);
    expect(q.paragraph_index).toBe(SS.expectedParagraphIndex(host.paragraphs, paragraph));
    const text = host.paragraphs[q.paragraph_index];
    for (const sentence of Object.values(q.options)) expect(text).toContain(sentence);
    expect(SS.auditPasses(passes, SS.auditHash(q.stem, text), SS.correctSentenceOf(q))).toBe(true);
  }
});

test("Japan study tour remains a complete three-question group and the old split id resolves to it", () => {
  const host = rdl.find((x) => x.id === "real_rdl_210_1_25");
  expect(host.questions.map((q) => q.q_number)).toEqual([25, 26, 27]);
  expect(rdl.some((x) => x.id === "real_rdl_210_1_26")).toBe(false);
  expect(aliases.find((a) => a.from === "real_rdl_210_1_26").to).toBe(host.id);
});

test("the omitted original course image produces one complete RDL group with its original answer keys", () => {
  const host = rdl.find((x) => x.id === "real_rdl_rp0822_1001_100101");
  expect(host.questions.map((q) => q.q_number)).toEqual([100101, 100102, 100103]);
  expect(host.questions.map((q) => q.correct_answer)).toEqual(["A", "C", "B"]);
  expect(host.text).toContain("newly developed Creative Writing Seminar");
  expect(host.text).toContain("one first-year-level course");
});
