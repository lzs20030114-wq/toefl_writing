// Active first-set-survey ROUND.
//
// The first-set survey is gated by a `user_surveys` row keyed on (user_code, survey_type):
// if a row exists for the CURRENT survey_type, the modal won't pop again. Bumping this value
// re-prompts EVERY user — including those who already answered a prior round — because their
// old rows keep their old survey_type, so the gate (a row for the new type) is empty for them.
// The table's `unique (user_code, survey_type)` allows one row per user per round, so prior
// answers are preserved (queryable by their old survey_type), not overwritten.
//
// History of rounds:
//   first_set_completion      — original (pre-2026-06 bank refresh)
//   first_set_completion_v2    — re-run after the full realExam2026 bank replacement
export const FIRST_SET_SURVEY_TYPE = "first_set_completion_v2";
