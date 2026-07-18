/**
 * Speaking intro-narration templates — pure, deterministic string builders.
 *
 * Distilled verbatim from the 2026 real exam corpus:
 *   - data/realExam2026/speaking/ (repeat-from-audio.json + interview.json)
 *   - .codex-tmp/asr/*Speaking*.txt  (13 Listen&Repeat + 14 Interview intros)
 * See data/claudeGen/reports/SPEAKING-INTRO-PARADIGM-2026-07-16.md for the
 * full paradigm + variant weights.
 *
 * The Listen&Repeat intro is 3 beats: setting sentence → instruction sentence →
 * fixed "Repeat only once." tail. The instruction's referent obeys a hard rule:
 * when the setting names a *manager*, the instruction repeats the noun
 * ("Listen to the manager and repeat what the manager says.") — never a pronoun.
 * Otherwise it splits ~1:1 between "your trainer / he-she" and "the speaker /
 * he-she", chosen deterministically per set id so a set always narrates the same.
 *
 * The Interview intro is 2 beats: setting sentence (the bank's `intro` field,
 * present-perfect) → logistics sentence (fixed main template, 57% of real). The
 * interviewer's opener already lives in the bank's Q1 text, so it is not repeated
 * here.
 *
 * These are UI-facing (rendered on the pre-task intro screen while TTS reads the
 * same text), NOT part of the generation pipeline — but they encode the same
 * real-exam paradigm, so they live beside the speaking generators.
 */

// Interview logistics — the dominant real-exam template (57% occurrence).
export const INTERVIEW_LOGISTICS =
  "You will have a short online interview with a researcher. The researcher will ask you some questions.";

// Task-level section narration, verbatim from the real exam (14/14 identical).
// Read once at the very start of the speaking mock, before Task 1.
export const SPEAKING_SECTION_NARRATION =
  "Speaking section. In the speaking section, you will answer 11 questions to demonstrate how well you can speak English. There are two types of tasks. Listen and repeat. You will listen as someone speaks to you. Listen carefully and then repeat what you have heard. In an actual test, the clock will indicate how much time you have to speak. No time for preparation will be provided.";

// Task-level narration read before the interview task, verbatim from real exam.
export const INTERVIEW_TASK_NARRATION =
  "Take an interview. An interviewer will ask you questions. Answer the questions and be sure to say as much as you can in the time allowed. No time for preparation will be provided.";

// Fixed tail of every Listen&Repeat setting narration (zero real-exam variants).
const REPEAT_TAIL = "Repeat only once.";

// Scenario-tag tokens that must stay upper-case when normalized to a "place"
// phrase (e.g. "IT Help Desk" → "IT help desk", not "it help desk").
const RESERVED_UPPER = new Set([
  "IT", "TV", "AV", "ID", "US", "UK", "DIY", "STEM", "AI", "PC", "HR", "QA", "GPS", "DJ",
]);

/**
 * Deterministic non-negative 32-bit-ish hash of a string. Same input → same
 * output across runs/processes so a given set always narrates identically.
 */
function hashString(str) {
  const s = String(str == null ? "" : str);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h < 0 ? -h : h;
}

/**
 * Turn a scenario tag into a natural lower-case "place" phrase, preserving
 * known abbreviations and stripping a trailing "(how-to)" qualifier.
 *   "IT Help Desk"                → "IT help desk"
 *   "Botanical Garden Tour"       → "botanical garden tour"
 *   "Bike Tire Repair (how-to)"   → "bike tire repair"
 */
export function normalizePlace(scenario) {
  const raw = String(scenario == null ? "" : scenario)
    .replace(/\s*\(how-?to\)\s*/i, " ")
    .trim();
  if (!raw) return "";
  return raw
    .split(/\s+/)
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, "");
      if (bare && RESERVED_UPPER.has(bare.toUpperCase())) return bare.toUpperCase();
      return w.toLowerCase();
    })
    .join(" ");
}

/**
 * Generic training-task phrase. The real exam embeds task semantics richly; we
 * only need a natural generic verb phrase (the setting's job is to frame the
 * scene, and the sentences themselves carry the content).
 */
function inferTask(scenario) {
  const s = String(scenario == null ? "" : scenario).toLowerCase();
  if (/(store|shop|grocer|bookstore|dining|market|rental|cafe|salad|cookie|bak)/.test(s)) {
    return "assist customers";
  }
  return "assist visitors";
}

/**
 * Build the Listen&Repeat intro from a set's metadata.
 *
 * @param {{ id?: string, scenario?: string, speaker_role?: string }} setInfo
 * @returns {{ settingText: string, instructionText: string }}
 *   instructionText always ends with the fixed "Repeat only once." tail.
 */
export function buildRepeatIntro({ id, scenario, speaker_role } = {}) {
  const place = normalizePlace(scenario);
  const role = String(speaker_role == null ? "" : speaker_role).toLowerCase();

  // Manager rule: setting names the manager; instruction repeats the NOUN.
  if (/manager/.test(role)) {
    const settingText = place
      ? `You are working at the ${place}. Your manager is training you to assist people there.`
      : "You are working here. Your manager is training you to assist people.";
    return {
      settingText,
      instructionText: `Listen to the manager and repeat what the manager says. ${REPEAT_TAIL}`,
    };
  }

  // Total fallback — no scenario at all (e.g. personal-bank sets). Deterministic
  // generic trainer version (matches the documented fallback string).
  if (!place) {
    return {
      settingText: "You are being trained to assist visitors.",
      instructionText: `Listen to your trainer and repeat what he says. ${REPEAT_TAIL}`,
    };
  }

  const task = inferTask(scenario);
  const useTrainer = hashString(id) % 2 === 0;
  const pron = hashString(`${id}|pron`) % 2 === 0 ? "he" : "she";

  if (useTrainer) {
    return {
      settingText: `You are being trained to ${task} at the ${place}.`,
      instructionText: `Listen to your trainer and repeat what ${pron} says. ${REPEAT_TAIL}`,
    };
  }
  return {
    settingText: `You are learning to ${task} at the ${place}.`,
    instructionText: `Listen to the speaker and repeat what ${pron} says. ${REPEAT_TAIL}`,
  };
}

/**
 * Build the Interview intro from a set's metadata.
 *
 * @param {{ intro?: string }} setInfo — `intro` is the bank's present-perfect
 *   setting sentence ("You have agreed to participate in a survey about …").
 * @returns {{ settingText: string, logisticsText: string }}
 */
export function buildInterviewIntro({ intro } = {}) {
  const settingText =
    String(intro == null ? "" : intro).trim() ||
    "You have agreed to participate in a short research interview.";
  return { settingText, logisticsText: INTERVIEW_LOGISTICS };
}
