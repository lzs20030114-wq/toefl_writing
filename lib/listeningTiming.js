export const TOEFL_LISTENING_SECTION_SECONDS = 29 * 60;
export const TOEFL_LISTENING_ITEM_COUNT = 47;

// ETS publishes Listening timing at section/module level. The app uses the
// section pace as a per-item answer timer for standard practice.
export const LISTENING_SECONDS_PER_ITEM = Math.round(
  TOEFL_LISTENING_SECTION_SECONDS / TOEFL_LISTENING_ITEM_COUNT
);

// "Choose a Response" (LCR) items are a single short utterance with one pick,
// so they need far less answer time than the multi-question announcement /
// conversation / lecture tasks (which keep the section pace above).
export const LCR_SECONDS_PER_ITEM = 15;

export function formatAnswerTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}
