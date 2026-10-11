const { materialHash, itemHash, repairReadingItem, repairReadingRecord } = require("../scripts/realbank/reading_source_repairs");
const ledger = require("../data/realBank/reading/source-repairs.json");

test("verified repair preserves the question and only restores material", () => {
  const item = { material: "short text", stem: "Question?", answer_index: 2, options: ["a", "b", "c", "d"] };
  const entry = { set: "S", section: "reading", module: 2, q: 11, original_material_sha256: materialHash(item.material), material: "complete original text", evidence: { verified: true } };
  expect(repairReadingItem(item, { set: "S", module: 2, q: 11 }, { entries: [entry] })).toEqual({ ...item, material: entry.material });
  expect(item.material).toBe("short text");
});

test("flagged records require two explicit reviews bound to the exact repaired item", () => {
  const original = { q_number: 30, stem: "broken", material: "text", options: [] };
  const record = { section: "reading", module: 1, status: "flagged", q_start: 30, items: [original] };
  const patch = { stem: "Where should this sentence be inserted?", material: "[A] One. [B] Two. [C] Three. [D]", options: ["A", "B", "C", "D"], answer_index: 3 };
  const entry = { set: "S", section: "reading", module: 1, q: 30, original_item_sha256: itemHash(original), promote: true, patch, evidence: { verified: true }, manual_audits: [] };
  const run = () => repairReadingRecord(record, { set: "S" }, { entries: [entry] });
  expect(run().record).toBe(record);
  const vote = { type: "agent_review", checked_by: "agent-one", item_sha256: itemHash({ ...original, ...patch }), pick: "D" };
  entry.manual_audits = [vote, vote];
  expect(run().record).toBe(record);
  entry.manual_audits = [vote, { ...vote, checked_by: "agent-two", pick: "C" }];
  expect(run().record).toBe(record);
  entry.manual_audits = [vote, { ...vote, checked_by: "agent-two" }];
  expect(run().record.status).toBe("ok");
  expect(run().manuallyAudited.has(30)).toBe(true);
  entry.patch.material += " changed";
  expect(run().record).toBe(record);
});

test("changed source, module, question, set or unverified evidence never replays", () => {
  const item = { material: "short text" };
  const context = { set: "S", module: 2, q: 11 };
  const entry = { ...context, section: "reading", original_material_sha256: materialHash(item.material), material: "full", evidence: { verified: true } };
  for (const changed of [{ set: "T" }, { module: 1 }, { q: 12 }]) {
    expect(repairReadingItem(item, { ...context, ...changed }, { entries: [entry] })).toBe(item);
  }
  expect(repairReadingItem({ material: "new source" }, context, { entries: [entry] }).material).toBe("new source");
  expect(repairReadingItem(item, context, { entries: [{ ...entry, evidence: { verified: false } }] })).toBe(item);
});

test("repair ledger identifies both screenshot-verified grouping failures", () => {
  expect(ledger.entries.map((e) => `${e.set}#${e.module}#${e.q}`)).toEqual(expect.arrayContaining([
    "2.1新托福真题B卷#2#11", "2.10新托福真题#1#26",
  ]));
  for (const e of ledger.entries.filter((entry) => entry.original_material_sha256)) {
    expect(e.original_material_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(e.evidence.verified).toBe(true);
    expect(e.material.trim()).not.toBe("");
  }
});

test("sentence restoration requires independent answer and separate exact source review", () => {
  const SS = require("../scripts/realbank/sentence_select");
  const audit = { type: "agent_review", checked_by: "solver", hash: "hash", expected_sentence: "A sentence.", agree: true };
  const entry = { audits: [audit], source_reviews: [] };
  const passes = () => SS.passingHashes({ entries: [entry] });
  expect(passes().has("hash")).toBe(false);
  const source = { type: "source_review", checked_by: "source-reader", verified: true, source_page: "paper p7", hash: "hash", expected_sentence: "A sentence." };
  entry.source_reviews = [{ ...source, checked_by: "solver" }];
  expect(passes().has("hash")).toBe(false);
  entry.source_reviews = [{ ...source, hash: "changed" }];
  expect(passes().has("hash")).toBe(false);
  entry.source_reviews = [source];
  expect(SS.auditPasses(passes(), "hash", "A sentence.")).toBe(true);
  expect(SS.auditPasses(passes(), "hash", "Changed sentence.")).toBe(false);
});

test("reading override callers supply the module that disambiguates repeated question numbers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const build = fs.readFileSync(path.join(__dirname, "../scripts/realbank/build_bank.mjs"), "utf8");
  for (const fn of ["manualAnswerFix", "manualAuditPass"]) {
    const readingCall = new RegExp(`${fn}\\(AUDIT_OVERRIDES, \\{\\s*set: setname, section: "reading", module: r\\.module, q: r\\.item\\.q_number`);
    expect(build).toMatch(readingCall);
  }
});

test("reviewed item patches cannot change question identity", () => {
  const item = { q_number: 30, material: "old" };
  const record = { section: "reading", module: 1, status: "flagged", q_start: 30, items: [item] };
  const patch = { q_number: 31, material: "full", stem: "Question?", options: ["A", "B", "C", "D"], answer_index: 0 };
  const vote = { type: "agent_review", checked_by: "one", item_sha256: itemHash({ ...item, ...patch }), pick: "A" };
  const entry = { set: "S", section: "reading", module: 1, q: 30, promote: true, original_item_sha256: itemHash(item), patch, evidence: { verified: true }, manual_audits: [vote, { ...vote, checked_by: "two" }] };
  expect(repairReadingRecord(record, { set: "S" }, { entries: [entry] }).record).toBe(record);
});

test("a later passage patch cannot erase restored insertion positions while retaining the question", () => {
  const { gateRestoredInsertQuestions } = require("../scripts/realbank/reading_source_repairs");
  const material = "[A] One. [B] Two. [C] Three. [D]";
  const ledger = { entries: [{ set: "S", module: 1, q: 35, promote: true, patch: { material, stem: "There are four locations" } }] };
  const make = (passage) => [{ id: "real_ap_s_1_31", source: "S", passage, questions: [{ q_number: 35 }, { q_number: 31 }] }];
  const valid = make(material);
  expect(gateRestoredInsertQuestions(valid, ledger).dropped).toEqual([]);
  const erased = make("One. Two. Three.");
  expect(gateRestoredInsertQuestions(erased, ledger).dropped).toHaveLength(1);
  expect(erased[0].questions).toEqual([{ q_number: 31 }]);
  const changed = make(material + " Changed text.");
  expect(gateRestoredInsertQuestions(changed, ledger).dropped).toHaveLength(1);
});

test("empty parser failures are repaired only against the exact original record and source range", () => {
  const record = { section: "reading", module: 1, type: "ctw", status: "flagged", q_start: 35, q_end: 35, items: [], problems: ["invalid JSON"] };
  const item = { q_number: 35, stem: "Where should it go?", material: "[A] One. [B] Two. [C] Three. [D]", options: ["A", "B", "C", "D"], answer_index: 2 };
  const vote = { type: "agent_review", checked_by: "solver", item_sha256: itemHash(item), pick: "C" };
  const source = { ...vote, type: "source_review", checked_by: "reader", source_page: "p10", verified: true };
  const entry = { set: "S", section: "reading", module: 1, q: 35, promote: true, original_record_sha256: itemHash(record), evidence: { verified: true }, patch: { type: "ap", module: 1, q_start: 35, q_end: 35, status: "ok", items: [item] }, manual_audits: [vote, source] };
  const run = (r = record) => repairReadingRecord(r, { set: "S" }, { entries: [entry] });
  expect(run().record.type).toBe("ap");
  expect(run().manuallyAudited.has(35)).toBe(true);
  const drift = { ...record, problems: ["different failed source"] };
  expect(run(drift).record).toBe(drift);
  entry.patch.q_end = 36;
  expect(run().record).toBe(record);
});

test("image omissions preserve the RDL type and require reviews of every repaired item", () => {
  const item = { q_number: 100101, material: "Refer to previous page", stem: "What is the purpose?", options: ["A", "B", "C", "D"], answer_index: 0 };
  const record = { section: "reading", type: "rdl", module: 1001, status: "ok", q_start: 1, items: [item] };
  const patch = { material: "Original image course description." };
  const vote = { type: "agent_review", checked_by: "solver", item_sha256: itemHash({ ...item, ...patch }), pick: "A" };
  const entry = { set: "S", section: "reading", module: 1001, q: 100101, promote: true, repair_kind: "image_material_omission", original_item_sha256: itemHash(item), patch, evidence: { verified: true, source_image: "original-course.png" }, manual_audits: [vote, { ...vote, checked_by: "other" }] };
  const repaired = repairReadingRecord(record, { set: "S" }, { entries: [entry] });
  expect(repaired.record.type).toBe("rdl");
  expect(repaired.manuallyAudited.has(100101)).toBe(true);
  expect(repaired.record.items[0].options).toEqual(item.options);
  expect(repairReadingRecord({ ...record, items: [item, { ...item, q_number: 100102 }] }, { set: "S" }, { entries: [entry] }).record.items[0].material).toBe(item.material);
  entry.patch.answer_index = 1;
  expect(repairReadingRecord(record, { set: "S" }, { entries: [entry] }).record).toBe(record);
});

test("merged grouping aliases require the exact restored material and a unique live question host", () => {
  const { sourceRepairAliasEdges } = require("../scripts/realbank/reading_source_repairs");
  const entry = { set: "S", q: 26, material: "Full page.", alias_from: "real_rdl_s_1_26", evidence: { verified: true } };
  const host = { id: "real_rdl_s_1_25", source: "S", text: "Full page.", questions: [{ q_number: 26 }] };
  expect(sourceRepairAliasEdges([host], { entries: [entry] })).toEqual([{ from: entry.alias_from, to: host.id, reason: "consolidated" }]);
  expect(sourceRepairAliasEdges([{ ...host, text: "Changed" }], { entries: [entry] })).toEqual([]);
  expect(sourceRepairAliasEdges([host, { ...host, id: "other" }], { entries: [entry] })).toEqual([]);
});
