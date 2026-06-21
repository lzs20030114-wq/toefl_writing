// Voice-upgrade A/B vote ("听力语音惊喜升级") — a one-shot campaign poll.
//
// Reuses the existing `user_surveys` table (see scripts/sql/user-surveys-schema.sql):
// one row per (user_code, survey_type), uniquely constrained, so a user is counted
// once. No migration needed — the vote rides on the same storage as the first-set
// survey, distinguished only by this survey_type.
//
//   status='submitted' + responses={ choice: 'upgrade'|'keep', loggedIn }  → a vote
//   status='dismissed'                                                     → closed without voting
//
// To re-run the campaign later (e.g. after the price actually changes), bump the
// type suffix; old rows keep their old type and stay queryable.
export const VOICE_VOTE_TYPE = "voice_upgrade_2026_06";

// Allowed vote choices. Kept deliberately tiny — this is a yes/no willingness poll,
// not a rating matrix.
export const VOICE_VOTE_CHOICES = ["upgrade", "keep"];

export const VOICE_VOTE_LABELS = {
  upgrade: "支持升级",
  keep: "维持现状",
};
