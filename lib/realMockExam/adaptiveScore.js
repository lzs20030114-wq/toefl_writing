import { bandToCEFR, getScoreColor } from "../mockExam/adaptiveScoring";
import { plannedTotal } from "../mockExam/timeoutFinalize";

export const REAL_ADAPTIVE_SCORE_VERSION = "site-raw-35-v1";

export function summarizeRealModule(items, results) {
  let scoredCorrect = 0, scoredTotal = 0, extraCorrect = 0, extraTotal = 0;
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i];
    const result = results?.[i];
    const total = item?.taskType === "ctw" ? (item.blanks || []).length : item?.taskType === "lcr" ? 1 : (item?.questions || []).length;
    const correct = Math.max(0, Math.min(total, Number(result?.correct) || 0));
    if (item?.realMockRole === "scored") {
      scoredCorrect += correct;
      scoredTotal += total;
    } else if (item?.realMockRole === "practice-extra") {
      extraCorrect += correct;
      extraTotal += total;
    }
  }
  return { scoredCorrect, scoredTotal, extraCorrect, extraTotal };
}

export function routeRealModule(items, results, threshold = 0.6) {
  const { scoredCorrect, scoredTotal } = summarizeRealModule(items, results);
  return scoredTotal > 0 && scoredCorrect / scoredTotal >= threshold ? "upper" : "lower";
}

export function calculateRealAdaptiveScore(m1Items, m1Results, m2Items, m2Results, path) {
  const m1 = summarizeRealModule(m1Items, m1Results);
  const m2 = summarizeRealModule(m2Items, m2Results);
  const correct = m1.scoredCorrect + m2.scoredCorrect;
  const total = m1.scoredTotal + m2.scoredTotal;
  const rawScore = total ? correct / total : 0;
  const band = Math.max(1, Math.min(6, Math.round((1 + 5 * rawScore) * 2) / 2));
  return {
    band, correct, total, rawScore, path, m1, m2,
    extraCorrect: m1.extraCorrect + m2.extraCorrect,
    extraTotal: m1.extraTotal + m2.extraTotal,
    cefr: bandToCEFR(band), color: getScoreColor(band),
    scoreVersion: REAL_ADAPTIVE_SCORE_VERSION,
  };
}

export function validateRealAdaptivePaper(paper, section, userCode) {
  const m1Total = section === "reading" ? 35 : 32;
  if (!paper || paper.section !== section || paper.userCode !== userCode ||
      !paper.attemptId || !paper.templateVersion ||
      !Array.isArray(paper.m1Items) || plannedTotal(paper.m1Items) !== m1Total) return false;
  if (summarizeRealModule(paper.m1Items, []).scoredTotal !== 20) return false;
  const countType = (items, type) => plannedTotal(items.filter((item) => item.taskType === type));
  if (section === "reading") {
    const ctw = countType(paper.m1Items, "ctw");
    const rdl = countType(paper.m1Items, "rdl");
    const ap = countType(paper.m1Items, "ap");
    if (ctw !== 20 || !((rdl === 10 && ap === 5) || (rdl === 5 && ap === 10))) return false;
  } else if (countType(paper.m1Items, "lcr") !== 12 ||
             countType(paper.m1Items, "lc") !== 6 ||
             countType(paper.m1Items, "la") !== 6 ||
             countType(paper.m1Items, "lat") !== 8) return false;
  for (const path of ["upper", "lower"]) {
    const items = paper.m2ByPath?.[path];
    if (!Array.isArray(items) || plannedTotal(items) !== 15 ||
        summarizeRealModule(items, []).scoredTotal !== 15) return false;
    const expected = section === "reading"
      ? (path === "upper" ? { ctw: 10, ap: 5 } : { ctw: 10, rdl: 5 })
      : (path === "upper" ? { lcr: 3, lc: 4, lat: 8 } : { lcr: 7, lc: 4, la: 4 });
    for (const [type, count] of Object.entries(expected)) if (countType(items, type) !== count) return false;
    for (const item of items) if (!(item.taskType in expected)) return false;
  }
  return Number(paper.timing?.module1Seconds) > 0 &&
    Number(paper.timing?.module2Seconds?.upper) > 0 &&
    Number(paper.timing?.module2Seconds?.lower) > 0;
}
