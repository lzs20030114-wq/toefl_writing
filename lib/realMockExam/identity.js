import { createHash } from "crypto";
import readingAliases from "../../data/realBank/reading/id-aliases.json";
import writingAliases from "../../data/realBank/writing/id-aliases.json";
import listeningAliases from "../../data/realBank/listening/id-aliases.json";
import speakingAliases from "../../data/realBank/speaking/id-aliases.json";

const aliases = new Map();
for (const ledger of [readingAliases, writingAliases, listeningAliases, speakingAliases]) {
  for (const row of ledger?.aliases || []) {
    if (row?.from && row?.to) aliases.set(normalizeId(row.from), normalizeId(row.to));
  }
}

export function normalizeId(id) {
  const value = String(id || "").trim();
  return value && !value.startsWith("real_") ? `real_${value}` : value;
}

export function canonicalId(id) {
  let value = normalizeId(id);
  const visited = new Set();
  while (aliases.has(value) && !visited.has(value)) {
    visited.add(value);
    value = aliases.get(value);
  }
  return value;
}

function norm(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function materialText(type, item) {
  switch (type) {
    case "ctw": return item.passage;
    case "rdl": return item.text;
    case "ap": return item.passage;
    case "lcr": return item.speaker;
    case "lc": return (item.conversation || []).map((x) => x.text).join(" ");
    case "la": return item.announcement;
    case "lat": return item.transcript;
    case "repeat": return (item.sentences || []).map((x) => x.sentence).join(" ");
    case "interview": return (item.questions || []).map((x) => x.question).join(" ");
    case "bs": return item.answer;
    case "email": return [item.scenario, item.direction, ...(item.goals || [])].join(" ");
    case "discussion": return [item.professor?.text, ...(item.students || []).map((x) => x.text)].join(" ");
    default: return "";
  }
}

export function realMockKeys(type, item) {
  const canonical = canonicalId(item?.recycled_of || item?.alias_of || item?.id);
  const text = norm(materialText(type, item));
  if (!canonical || !text) return [];
  const digest = createHash("sha256").update(text).digest("hex");
  const keys = [`id:${canonical}`, `material:${digest}`];
  // Speaking stays an indivisible 7-sentence / 4-question set, but any repeated
  // child sentence/question makes the whole set ineligible for a new attempt.
  if (type === "repeat" || type === "interview") {
    const children = type === "repeat" ? item.sentences : item.questions;
    const field = type === "repeat" ? "sentence" : "question";
    for (const child of children || []) {
      const childId = canonicalChildId(item, child?.id);
      const childText = norm(child?.[field]);
      if (childId) keys.push(`id:${childId}`);
      if (childText) keys.push(`material:${createHash("sha256").update(childText).digest("hex")}`);
    }
  }
  return [...new Set(keys)];
}

function canonicalChildId(parent, childId) {
  const rawChild = normalizeId(childId);
  const rawParent = normalizeId(parent?.id);
  const keptParent = canonicalId(parent?.recycled_of || parent?.alias_of || parent?.id);
  if (rawChild && rawParent && rawChild.startsWith(`${rawParent}_`) && keptParent) {
    return `${keptParent}${rawChild.slice(rawParent.length)}`;
  }
  return canonicalId(rawChild);
}

export function realMockIdentity(type, item) {
  const keys = realMockKeys(type, item);
  const children = type === "repeat" ? item.sentences : type === "interview" ? item.questions : [];
  return {
    realMockKey: keys[1] || keys[0], realMockKeys: keys,
    canonicalId: canonicalId(item?.recycled_of || item?.alias_of || item?.id),
    realMockChildIds: (children || []).map((child) => canonicalChildId(item, child?.id)).filter(Boolean),
  };
}

export function expandDoneIds(ids, allCandidates) {
  const done = new Set(Array.from(ids || []).map(canonicalId));
  // 造句批次 id（"real-bs-set-3"，本地已练 key 记的就是它）不是条目 id：canonicalId 会给它补成
  // "real_real-bs-set-3"，与 __sourceGroupId 永远对不上，所以批次另按原样比对。
  const raw = new Set(Array.from(ids || []).map((id) => String(id || "").trim()).filter(Boolean));
  const keys = new Set();
  for (const candidate of allCandidates) {
    const group = candidate.__sourceGroupId;
    if (done.has(candidate.canonicalId) || done.has(canonicalId(candidate.id)) || (group && (raw.has(group) || done.has(group))) || (candidate.realMockChildIds || []).some((id) => done.has(id))) {
      candidate.realMockKeys.forEach((key) => keys.add(key));
    }
  }
  return keys;
}
