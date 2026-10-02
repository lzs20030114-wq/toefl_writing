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

/** A missing STT or AI result keeps the band unavailable; zero is only an actual scored zero. */
export function scoreRealSpeaking(repeatItems, interviewItems) {
  const repeat = (repeatItems || []).map((item) => item?.score?.officialLevel ?? item?.score?.score);
  const interview = (interviewItems || []).map((item) => item?.aiScore?.error ? null : item?.aiScore?.score);
  if (repeat.length !== 7 || interview.length !== 4 || [...repeat, ...interview].some((value) => !Number.isFinite(value))) {
    return { raw: null, maxRaw: 55, percent: null, band: null, repeatRaw: null, interviewRaw: null };
  }
  const repeatRaw = repeat.reduce((a, b) => a + Math.max(0, Math.min(5, b)), 0);
  const interviewRaw = interview.reduce((a, b) => a + Math.max(0, Math.min(5, b)), 0);
  const raw = repeatRaw + interviewRaw;
  return { raw, maxRaw: 55, percent: Math.round(raw / 55 * 100), band: bandFromRaw(raw, 55), repeatRaw, interviewRaw };
}
