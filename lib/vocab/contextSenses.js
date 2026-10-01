import { hasUsableSense } from "../dict/core";

const text = value => typeof value === "string" ? value.trim() : "";
const at = value => new Date(value || 0).getTime() || 0;

/** Bind meanings only to retained, exact sentences; newer edits win per sentence. */
export function normalizeContextSenses(raw, sentences, resetAt = null) {
  const allowed = new Set(sentences.filter(Boolean));
  const bySentence = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    const sentence = text(item?.sentence), def = text(item?.def);
    if (!allowed.has(sentence) || sentence.length > 400 || def.length > 300 || !hasUsableSense(def)
      || !item.updatedAt || !Number.isFinite(new Date(item.updatedAt).getTime()) || (resetAt && at(item.updatedAt) <= at(resetAt))) continue;
    const previous = bySentence.get(sentence);
    if (!previous || at(item.updatedAt) >= at(previous.updatedAt)) bySentence.set(sentence, { sentence, def, updatedAt: item.updatedAt });
  }
  return [...bySentence.values()].slice(0, 4);
}

/** A special meaning from another sentence must never serve as this sentence's cue. */
export function definitionForContext(card, sentence) {
  if (!card) return "";
  const current = text(sentence);
  if (!current) return hasUsableSense(card.def) ? card.def : "";
  const sense = (card.contextSenses || []).find(item => item.sentence === current);
  if (sense && hasUsableSense(sense.def)) return sense.def;
  if (!(card.contextSenses || []).length) return hasUsableSense(card.def) ? card.def : "";
  return hasUsableSense(card.baseDef) ? card.baseDef : hasUsableSense(card.defFull) ? card.defFull : "";
}
