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

// Start of the CURRENT round. The gate counts only sessions completed at/after
// this instant, so returning users with pre-refresh history are NOT re-prompted
// the moment they open the site — they must finish at least one set on the new
// bank first (matching the "first-set survey" intent). Set to the moment the
// realExam2026 bank went live: commit 6d737d1 "PROMOTE newBank → live"
// (2026-06-02 11:06:01 +0800). When you bump FIRST_SET_SURVEY_TYPE for a future
// round, move this to that round's start as well.
export const FIRST_SET_SURVEY_SINCE = "2026-06-02T03:06:00Z";

// All rounds, newest first — used by the admin dashboard to let the operator
// view past rounds' responses (rows are never deleted; each round is a separate
// survey_type, preserved by the unique(user_code, survey_type) constraint).
export const FIRST_SET_SURVEY_ROUNDS = [
  { key: "first_set_completion_v2", label: "本轮 · 新题库 (v2)" },
  { key: "first_set_completion", label: "上一轮 (v1)" },
];
