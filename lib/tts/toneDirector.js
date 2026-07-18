"use strict";
/**
 * toneDirector.js — deterministic persona layer for listening TTS.
 *
 *   derivePersona(item, type): role+gender -> a gender-locked safe voice (the 2 LC
 *     speakers never collide) + a temperament baseline. NO LLM, NO randomness.
 *   renderInstructions(persona): the stable persona baseline + the frozen never-slow
 *     pace clause, as the free-text 'instructions' for gpt-4o-mini-tts. Never returns '';
 *     always ends with the pace clause. Carries NO per-line emotion/emphasis delta (those
 *     were probed inaudible 2026-06-23; see the render note below).
 *   QUESTION_RISE_CLAUSE: a frozen per-sentence clause the render layer (renderListening.js)
 *     appends to yes/no & tag questions so their pitch audibly rises — 2026-07-18 manual A/B
 *     listening test found this strongly-worded clause clearly effective. Kept here so the
 *     frozen text has a single home; do NOT delete it as dead code.
 *
 * Spec: data/claudeGen/reports/LISTENING-DIMENSION-SPEC-2026-06-22.md
 */
const { SAFE_VOICES } = require("./openaiTts");

const PACE_CLAUSE = "Keep a natural, exam-standard speaking pace; do not slow down.";
// Frozen per-sentence question-rise directive; appended by renderListening.js (non-wh
// questions only). V2 wording won the 2026-07-18 A/B listening test.
const QUESTION_RISE_CLAUSE = "Every question sentence must be delivered as a direct question to the listener: the pitch clearly and audibly rises at the end.";

// AUTHORITY vs STUDENT_PEER role bucket.
const AUTHORITY_RE = /(staff|advisor|advising|counsel|librar|professor|faculty|lecturer|admin|administrat|clerk|receptionist|coordinator|director|department|dean|announc|career|recreation|society|club|president|leader|assistant)/i;
function roleBucket(role) {
  return AUTHORITY_RE.test(String(role || "")) ? "AUTHORITY" : "STUDENT_PEER";
}

// Deterministic gender-matched safe voice. Ordered lists: index0 = primary authority,
// index1 = secondary authority (deeper, currently unused), index2 = student/peer.
function voiceFor(gender, bucket) {
  const g = gender === "male" ? "male" : "female";
  const list = SAFE_VOICES[g];
  if (bucket === "AUTHORITY") return list[0]; // nova / echo
  return list[2]; // coral / ash
}

const TEMPERAMENT_BASELINE = {
  "relaxed-campus": "Speak as a college student in a relaxed campus conversation, with natural friendly energy.",
  "measured-helpful": "Speak as helpful campus staff, professional and approachable, with clear enunciation.",
  "bright-announcer": "Speak as an enthusiastic campus announcer sharing good news with students: bright, energetic, welcoming.",
  "engaged-measured": "Speak as a professor giving a short lecture, engaged and informative, with a natural academic cadence.",
  "brisk-neutral": "Speak naturally in clear, standard American English.",
};

function temperamentFor(role, bucket, type) {
  if (type === "lat") return "engaged-measured";
  if (type === "la") {
    if (/club|society|president|leader|recreation|activity/i.test(String(role || ""))) return "relaxed-campus";
    return "bright-announcer";
  }
  if (bucket === "AUTHORITY") return "measured-helpful";
  return "relaxed-campus";
}

function personaForSpeaker(speaker, type) {
  const gender = speaker && speaker.gender === "male" ? "male" : "female";
  const role = (speaker && speaker.role) || null;
  const bucket = roleBucket(role);
  const temperament = temperamentFor(role, bucket, type);
  const voice = voiceFor(gender, bucket);
  return { name: (speaker && speaker.name) || null, gender, role, bucket, temperament, voice };
}

/**
 * derivePersona(item, type) -> array of per-speaker personas.
 *  - lc (2 speakers): both resolved together; voices guaranteed distinct.
 *  - lat/la/lcr (single speaker): reads item._speaker = { gender, role } (minted +
 *    persisted upstream); never uses item.speaker for lcr (that field is the utterance text).
 */
function derivePersona(item, type) {
  const speakers = Array.isArray(item && item.speakers) ? item.speakers : null;
  if (type === "lc" || (speakers && speakers.length === 2)) {
    const list = speakers && speakers.length === 2 ? speakers : [{ gender: "female" }, { gender: "male" }];
    const p0 = personaForSpeaker(list[0], type);
    let p1 = personaForSpeaker(list[1], type);
    if (p0.voice === p1.voice) {
      // same-gender safety walk: first voice in the same gender list != p0.voice
      const alt = SAFE_VOICES[p1.gender].find((v) => v !== p0.voice);
      if (!alt) throw new Error(`derivePersona: no distinct ${p1.gender} voice for the 2nd speaker`);
      p1 = { ...p1, voice: alt };
    }
    if (p0.voice === p1.voice) throw new Error("derivePersona: unresolved voice collision");
    return [p0, p1];
  }
  const sp = (item && item._speaker && typeof item._speaker === "object")
    ? item._speaker
    : { gender: (item && item.gender) || "female", role: (item && item.speaker_role) || null };
  return [personaForSpeaker(sp, type)];
}

// ── render ──
// PERSONA-ONLY for emotion/emphasis. gpt-4o-mini-tts is steerable on broad style (the
// temperament baseline) but NOT on fine per-line emotion/emphasis deltas: probed
// 2026-06-23, those deltas were barely audible, so renderInstructions carries only the
// stable persona baseline + the frozen never-slow pace clause.
//
// EXCEPTION — question rise: the same 2026-06-23 probe also concluded question-contour
// overrides were ignored, but a 2026-07-18 manual A/B listening test OVERTURNED that: the
// strongly-worded per-sentence QUESTION_RISE_CLAUSE (V2) is clearly and audibly effective.
// That clause is added by renderListening.js per question sentence (with a wh-question
// exception), NOT here — so the persona-only conclusion still holds for emotion/emphasis
// deltas only. Per-sentence splitting (lib/tts/wavTools) still prevents intonation bleed.
function renderInstructions(persona) {
  const baseline = (persona && TEMPERAMENT_BASELINE[persona.temperament]) || TEMPERAMENT_BASELINE["brisk-neutral"];
  return `${baseline} ${PACE_CLAUSE}`;
}

module.exports = {
  derivePersona,
  renderInstructions,
  voiceFor,
  roleBucket,
  temperamentFor,
  TEMPERAMENT_BASELINE,
  PACE_CLAUSE,
  QUESTION_RISE_CLAUSE,
};
