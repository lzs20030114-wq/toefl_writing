import { TASK_IDS } from "../mockExam/contracts";

const WRITING_TASKS = [TASK_IDS.BUILD_SENTENCE, TASK_IDS.EMAIL_WRITING, TASK_IDS.ACADEMIC_WRITING];

function bandFromRaw(raw, max) {
  return Math.max(1, Math.min(6, Math.round((1 + 5 * raw / max) * 2) / 2));
}

/** Site estimate only; every writing task must have a verified score. */
export function scoreRealWriting(attempts) {
  const scores = WRITING_TASKS.map((id) => attempts?.[id]?.score);
  if (scores.some((value) => !Number.isFinite(value))) return { raw: null, maxRaw: 20, percent: null, band: null };
  const raw = Math.max(0, Math.min(10, scores[0])) + Math.max(0, Math.min(5, scores[1])) + Math.max(0, Math.min(5, scores[2]));
  return { raw, maxRaw: 20, percent: Math.round(raw / 20 * 100), band: bandFromRaw(raw, 20) };
}

// One speaking item → { points } (0-5), flagged `unanswered` or `unscored` when it has no score.
//   recorded === false → the student never answered: 0 points, like a blank essay or an
//                        unanswered reading / listening question.
//   recorded (or a legacy item without the flag) but no finite score / an AI error →
//                        unscored: a speech-recognition or AI failure is not a wrong answer.
function speakingItemPoints(item, scoreOf) {
  if (item?.recorded === false) return { points: 0, unanswered: true };
  const value = scoreOf(item);
  return Number.isFinite(value) ? { points: Math.max(0, Math.min(5, value)) } : { points: 0, unscored: true };
}

const repeatItemScore = (item) => item?.score?.officialLevel ?? item?.score?.score;
const interviewItemScore = (item) => (item?.aiScore?.error ? null : item?.aiScore?.score);

/**
 * Site estimate on the 7 + 4 raw structure (repeat 0-35 + interview 0-20 = 0-55).
 * Unanswered items count 0. Any unscored item keeps raw / percent / band unavailable,
 * but a part (repeat / interview) with no unscored item still reports its raw.
 */
export function scoreRealSpeaking(repeatItems, interviewItems) {
  if (!Array.isArray(repeatItems) || repeatItems.length !== 7 || !Array.isArray(interviewItems) || interviewItems.length !== 4) {
    return { raw: null, maxRaw: 55, percent: null, band: null, repeatRaw: null, interviewRaw: null, unanswered: null, unscored: null };
  }
  const repeat = repeatItems.map((item) => speakingItemPoints(item, repeatItemScore));
  const interview = interviewItems.map((item) => speakingItemPoints(item, interviewItemScore));
  const partRaw = (part) => (part.some((x) => x.unscored) ? null : part.reduce((sum, x) => sum + x.points, 0));
  const repeatRaw = partRaw(repeat);
  const interviewRaw = partRaw(interview);
  const all = [...repeat, ...interview];
  const unanswered = all.filter((x) => x.unanswered).length;
  const unscored = all.filter((x) => x.unscored).length;
  if (unscored > 0) return { raw: null, maxRaw: 55, percent: null, band: null, repeatRaw, interviewRaw, unanswered, unscored };
  const raw = repeatRaw + interviewRaw;
  return { raw, maxRaw: 55, percent: Math.round(raw / 55 * 100), band: bandFromRaw(raw, 55), repeatRaw, interviewRaw, unanswered, unscored };
}
