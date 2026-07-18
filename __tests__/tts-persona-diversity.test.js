/**
 * Persona-diversity regression gate over the LIVE listening banks.
 *
 * The persona layer (speakerMeta + toneDirector) is deterministic per item id, and its
 * mapping rules are unit-locked elsewhere. What nothing else locks is the REALIZED
 * distribution over the live banks: an id-naming change could skew the gender hash, a
 * role-vocabulary drift could collapse every item into one temperament, and no unit
 * test would notice. This suite fails the build when the live distribution degrades.
 *
 * Bounds are deliberately loose (30% minority floor) so organic bank growth never
 * false-positives; only a systematic skew can trip them. 2026-07-18, alongside the
 * gpt-4o-mini-tts persona rollout.
 */
const fs = require("fs");
const path = require("path");
const { deriveSpeakerMeta } = require("../lib/tts/speakerMeta");
const { derivePersona } = require("../lib/tts/toneDirector");

const BANK_DIR = path.join(__dirname, "..", "data", "listening", "bank");
const SINGLE_SPEAKER_TYPES = ["lat", "la", "lcr"];
const MIN_ITEMS_TO_ENFORCE = 20; // don't gate tiny/rebuilding banks
const MINORITY_FLOOR = 0.3;

function loadItems(type) {
  const raw = fs.readFileSync(path.join(BANK_DIR, `${type}.json`), "utf8");
  return (JSON.parse(raw).items || []).filter((it) => it && it.id);
}

function personaOf(item, type) {
  const [p] = derivePersona({ ...item, _speaker: deriveSpeakerMeta(item, type) }, type);
  return p;
}

// All text that describes the speaker to the test taker (stems / options / explanations).
const vals = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
function itemTexts(it) {
  const parts = [];
  for (const q of it.questions || []) parts.push(q.question, q.explanation, ...vals(q.options));
  if (it.explanation) parts.push(it.explanation);
  parts.push(...vals(it.options));
  return parts.filter((p) => typeof p === "string").join(" ");
}

describe.each(SINGLE_SPEAKER_TYPES)("persona diversity over live %s bank", (type) => {
  const items = loadItems(type);
  const enforced = items.length >= MIN_ITEMS_TO_ENFORCE;

  test("gender split stays near parity (minority ≥ 30%)", () => {
    if (!enforced) return;
    const personas = items.map((it) => personaOf(it, type));
    const male = personas.filter((p) => p.gender === "male").length;
    const minorityShare = Math.min(male, items.length - male) / items.length;
    expect(minorityShare).toBeGreaterThanOrEqual(MINORITY_FLOOR);
  });

  test("at least 2 distinct voices in service", () => {
    if (!enforced) return;
    const voices = new Set(items.map((it) => personaOf(it, type).voice));
    expect(voices.size).toBeGreaterThanOrEqual(2);
  });

  test("no item's own text contradicts the assigned gender", () => {
    // "What does the woman imply?" spoken by a male voice is an instantly-audible bug.
    const conflicts = [];
    for (const it of items) {
      const txt = itemTexts(it);
      const saysMale = /\bthe man\b|\bthe male\b/i.test(txt);
      const saysFemale = /\bthe woman\b|\bthe female\b/i.test(txt);
      if (!saysMale && !saysFemale) continue;
      const assigned = personaOf(it, type).gender;
      if ((saysMale && assigned === "female") || (saysFemale && assigned === "male")) {
        conflicts.push(`${type} ${it.id}: text says "${saysMale ? "the man" : "the woman"}", voice is ${assigned}`);
      }
    }
    expect(conflicts).toEqual([]);
  });
});

test("lc conversations keep two distinct voices per item", () => {
  const items = loadItems("lc");
  for (const it of items.filter((i) => Array.isArray(i.speakers) && i.speakers.length === 2)) {
    const [a, b] = derivePersona(it, "lc");
    expect(a.voice).not.toBe(b.voice);
  }
});
