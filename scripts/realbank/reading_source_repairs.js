/** Screenshot-verified material repairs; exact source hashes prevent stale replay. */
const crypto = require("node:crypto");
const materialHash = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
const itemHash = (item) => materialHash(JSON.stringify(item));
const ITEM_PATCH_KEYS = new Set(["material", "stem", "options", "answer_index", "answer_text", "answer_key", "question_type"]);
function repairReadingRecord(record, context, ledger) {
  if (!record || record.section !== "reading") return { record, manuallyAudited: new Set() };
  const manuallyAudited = new Set();
  // Parser produced no item: bind the complete failed record, never fabricate an old item hash.
  if (record.status === "flagged" && !(record.items || []).length) {
    const entry = ((ledger && ledger.entries) || []).find((e) => e.set === context.set && e.section === "reading" && e.module === record.module && e.q === record.q_start && e.promote === true && e.original_record_sha256 === itemHash(record));
    const patch = entry && entry.patch;
    const item = patch && Array.isArray(patch.items) && patch.items.length === 1 && patch.items[0];
    const allowedRecordPatch = patch && Object.keys(patch).every((key) => ["module", "type", "q_start", "q_end", "items", "status"].includes(key));
    if (entry && entry.evidence && entry.evidence.verified === true && allowedRecordPatch && item && item.q_number === entry.q && patch.type === "ap" && patch.module === record.module && patch.q_start === record.q_start && patch.q_end === record.q_end && patch.status === "ok" && validQuestionPatch(item) && hasTwoReviews(entry, item)) {
      manuallyAudited.add(entry.q);
      return { record: { ...record, ...patch }, manuallyAudited };
    }
    return { record, manuallyAudited };
  }
  const items = (record.items || []).map((item) => {
    const q = item.q_number ?? record.q_start;
    const entry = ((ledger && ledger.entries) || []).find((e) => e.set === context.set && e.section === "reading" && e.module === record.module && e.q === q && e.promote === true && e.original_item_sha256 === itemHash(item));
    if (!entry || !entry.evidence || entry.evidence.verified !== true) return item;
    const patch = entry.patch || {};
    const omittedImage = record.status === "ok" && record.type === "rdl" && entry.repair_kind === "image_material_omission" && entry.evidence.source_image && Object.keys(patch).every((key) => key === "material");
    if (record.status !== "flagged" && !omittedImage) return item;
    // A parser that mislabeled an insert question as CTW omitted q_number entirely.
    // It may only be restored to the failed source record's own question number.
    if (Object.keys(patch).some((key) => !ITEM_PATCH_KEYS.has(key) && !(key === "q_number" && item.q_number == null && patch.q_number === q))) return item;
    const repaired = { ...item, ...patch };
    if (!validQuestionPatch(repaired)) return item;
    if (!hasTwoReviews(entry, repaired)) return item;
    manuallyAudited.add(q);
    return { ...repaired, q_number: q };
  });
  if (!manuallyAudited.size) return { record, manuallyAudited };
  // A flagged multi-item record is promoted only when every item is independently verified.
  if (items.some((it) => !manuallyAudited.has(it.q_number ?? record.q_start))) return { record, manuallyAudited: new Set() };
  return { record: { ...record, items, type: record.status === "flagged" ? "ap" : record.type, status: "ok" }, manuallyAudited };
}
function validQuestionPatch(patch) {
  return !!(patch.material && patch.stem && Array.isArray(patch.options) && patch.options.length === 4 && patch.options.every((x) => typeof x === "string" && x.trim()) && Number.isInteger(patch.answer_index) && patch.answer_index >= 0 && patch.answer_index <= 3);
}
function hasTwoReviews(entry, repaired) {
  const votes = (entry.manual_audits || []).filter((a) =>
    (a.type === "agent_review" || (a.type === "source_review" && a.verified === true && a.source_page)) &&
    a.checked_by && a.item_sha256 === itemHash(repaired) && a.pick === "ABCD"[repaired.answer_index]);
  return votes.some((a) => a.type === "agent_review") && new Set(votes.map((a) => a.checked_by)).size >= 2;
}
function repairReadingItem(item, context, ledger) {
  const entry = ((ledger && ledger.entries) || []).find((e) =>
    e.set === context.set && e.section === "reading" && e.module === context.module &&
    e.q === context.q && e.original_material_sha256 === materialHash(item.material));
  if (!entry || !entry.material || !entry.evidence || !entry.evidence.verified) return item;
  return { ...item, material: entry.material };
}
function gateRestoredInsertQuestions(items, ledger) {
  const dropped = [];
  for (const host of items || []) {
    const module = Number((/^real_ap_.+_(\d+)_\d+$/.exec(String(host.id)) || [])[1]);
    host.questions = (host.questions || []).filter((q) => {
      const entry = ((ledger && ledger.entries) || []).find((e) => e.promote === true && e.set === host.source && e.module === module && e.q === q.q_number);
      const restored = entry && (entry.original_record_sha256 ? entry.patch.items[0] : entry.patch);
      if (!restored || !/four locations/i.test(restored.stem || "")) return true;
      const material = String(host.passage || "").trim();
      const markers = material.match(/\[[ABCD]\]/g) || [];
      if (materialHash(material) === materialHash(String(restored.material || "").trim()) && markers.join("") === "[A][B][C][D]") return true;
      dropped.push({ host: host.id, q: q.q_number, reason: "restored_insert_material_changed", expected_material_sha256: materialHash(String(restored.material || "").trim()), actual_material_sha256: materialHash(material) });
      return false;
    });
  }
  return { dropped };
}
function sourceRepairAliasEdges(items, ledger) {
  const edges = [];
  const live = new Set((items || []).map((x) => x.id));
  for (const entry of (ledger && ledger.entries) || []) {
    if (!entry.alias_from || live.has(entry.alias_from) || !entry.evidence || entry.evidence.verified !== true) continue;
    const hosts = (items || []).filter((x) => x.source === entry.set && (x.questions || []).some((q) => q.q_number === entry.q) && materialHash(String(x.passage || x.text || "").trim()) === materialHash(String(entry.material || "").trim()));
    if (hosts.length === 1) edges.push({ from: entry.alias_from, to: hosts[0].id, reason: "consolidated" });
  }
  return edges;
}
module.exports = { materialHash, itemHash, repairReadingItem, repairReadingRecord, gateRestoredInsertQuestions, sourceRepairAliasEdges };
