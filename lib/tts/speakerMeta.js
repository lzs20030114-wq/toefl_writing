"use strict";
/**
 * speakerMeta.js — mint the { gender, role } persona metadata that the single-speaker
 * listening types (lat / la / lcr) never persist in their bank items.
 *
 * The two-speaker type (lc) already carries speakers[].gender, so toneDirector reads it
 * straight. The single-speaker types don't store any speaker metadata, so derivePersona
 * expects item._speaker = { gender, role }. This module derives that _speaker so the
 * persona layer can gender-lock a safe voice and pick a temperament:
 *   - gender: a STABLE hash of item.id → parity → "male" / "female". Deterministic across
 *     runs and platforms (NO Math.random) so re-rendering the same id always picks the same
 *     voice family — a clip never flips gender between renders.
 *   - role:   the raw campus role/context string, passed straight through to toneDirector,
 *     whose AUTHORITY_RE decides the AUTHORITY vs STUDENT_PEER bucket. lat is always a
 *     professor (single-lecturer academic talk).
 *
 * Pure: never writes back onto item, never persists anything.
 */

// Small, stable, platform-independent hash: sum of char codes (kept unsigned).
// Good enough for gender parity — we only need determinism + a rough 50/50 spread.
function stableHash(str) {
  const s = String(str == null ? "" : str);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) >>> 0;
  return h;
}

// Parity of the id hash → a fixed gender for that id.
function genderFor(id) {
  return stableHash(id) % 2 === 0 ? "female" : "male";
}

/**
 * @param {object} item  a single-speaker listening bank item (lat / la / lcr)
 * @param {"lat"|"la"|"lcr"|string} type
 * @returns {{ gender: "male"|"female", role: string|null }}
 */
function deriveSpeakerMeta(item, type) {
  const id = item && item.id;
  const gender = genderFor(id);
  let role = null;
  if (type === "lat") {
    role = "professor"; // academic talk = single lecturer
  } else if (type === "la") {
    role = (item && (item.speaker_role || item.context)) || null;
  } else if (type === "lcr") {
    // lcr has no explicit role; its context (campus_academic / campus_daily / social / …)
    // is the only signal. Pass it verbatim — AUTHORITY_RE self-buckets it.
    role = (item && item.context) || null;
  } else {
    role = (item && (item.speaker_role || item.context)) || null;
  }
  return { gender, role };
}

module.exports = { deriveSpeakerMeta, genderFor, stableHash };
