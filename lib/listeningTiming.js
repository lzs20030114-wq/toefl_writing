// Section-level constants for the TOEFL 2026 adaptive Listening section: ~29
// minutes across the routing + adaptive modules, up to 47 items. Used by the
// mock-exam shell to size each module's on-screen countdown. These model the
// section *budget*, not per-item answer pace.
export const TOEFL_LISTENING_SECTION_SECONDS = 29 * 60;
export const TOEFL_LISTENING_ITEM_COUNT = 47;

// Per-question answer time, by listening task type. On TOEFL 2026 the answer
// clock starts only AFTER the audio finishes (never during playback), and the
// countdown is an upper bound — the test-taker can advance early ("提前跳过")
// instead of waiting it out. Announcement / Conversation items are short with
// straightforward questions (20s); Academic Talk questions are denser (30s).
export const LA_SECONDS_PER_ITEM = 20;   // Listen to an Announcement
export const LC_SECONDS_PER_ITEM = 20;   // Listen to a Conversation
export const LAT_SECONDS_PER_ITEM = 30;  // Listen to an Academic Talk

// Default for any multi-question listening task whose type isn't recognized.
export const LISTENING_SECONDS_PER_ITEM = LAT_SECONDS_PER_ITEM;

export function listeningSecondsForType(taskType) {
  switch (taskType) {
    case "la": return LA_SECONDS_PER_ITEM;
    case "lc": return LC_SECONDS_PER_ITEM;
    case "lat": return LAT_SECONDS_PER_ITEM;
    default: return LISTENING_SECONDS_PER_ITEM;
  }
}

// "Listen and Choose a Response" (LCR): a single short utterance heard once,
// then one pick. Official pace is ~20–30s per item *including* the short listen,
// so the answer-only window (timer runs after the audio) is ~20s.
export const LCR_SECONDS_PER_ITEM = 20;

export function formatAnswerTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}
