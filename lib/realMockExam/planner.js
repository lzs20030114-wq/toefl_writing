import {
  getRealCTWItems, getRealRDLItems, getRealAPItems,
  getRealLCRItems, getRealLCItems, getRealLAItems, getRealLATItems,
  getRealRepeatSets, getRealInterviewSets, getRealBSQuestions,
  getRealEmailPrompts, getRealDiscussionPrompts,
} from "../realBank";
import { realMockIdentity, expandDoneIds } from "./identity";
import { getRealMockConfig, REAL_MOCK_SOURCE, REAL_MOCK_TEMPLATE_VERSION } from "./config";

const URL_OK = /^https:\/\/[^\s]+$/i;
const sources = {
  ctw: getRealCTWItems, rdl: getRealRDLItems, ap: getRealAPItems,
  lcr: getRealLCRItems, lc: getRealLCItems, la: getRealLAItems, lat: getRealLATItems,
  repeat: getRealRepeatSets, interview: getRealInterviewSets, bs: getRealBSQuestions,
  email: getRealEmailPrompts, discussion: getRealDiscussionPrompts,
};
const sectionTypes = {
  reading: ["ctw", "rdl", "ap"], listening: ["lcr", "lc", "la", "lat"],
  speaking: ["repeat", "interview"], writing: ["bs", "email", "discussion"],
};

function eligible(type, item) {
  if (!item?.id || item.tier === "legacy") return false;
  const n = Array.isArray(item.questions) ? item.questions.length : 0;
  switch (type) {
    case "ctw": return item.blanks?.length === 10;
    case "rdl": return n === 2 || n === 3;
    case "ap": return n === 5;
    case "lcr": return URL_OK.test(item.audio_url || "");
    case "lc": case "la": return n === 2 && URL_OK.test(item.audio_url || "");
    case "lat": return n === 4 && URL_OK.test(item.audio_url || "");
    case "repeat": return item.sentences?.length === 7 && item.sentences.every((s) => URL_OK.test(s.audio_url || ""));
    case "interview": return item.questions?.length === 4 && item.questions.every((q) => URL_OK.test(q.audio_url || ""));
    case "bs": return !!item.answer;
    case "email": return !!item.direction;
    case "discussion": return !!item.professor?.text;
    default: return false;
  }
}

export function loadRealMockPool(section) {
  const pool = {};
  for (const type of sectionTypes[section] || []) {
    pool[type] = sources[type]().filter((item) => eligible(type, item)).map((item) => ({
      ...item, taskType: type, realMockRole: "scored", realMockSource: REAL_MOCK_SOURCE,
      realMockDifficulty: "unknown",
      ...realMockIdentity(type, item),
    })).filter((item) => item.realMockKeys.length);
  }
  return pool;
}

function demand(section) {
  if (section === "reading") return {
    m1: [["ctw", 1, "scored"], ["ctw", 1, "practice-extra"], ["rdl2", 1, "scored"], ["rdl2", 1, "practice-extra"], ["rdl3", 1, "scored"], ["rdl3", 1, "practice-extra"], ["ap", 1, "scored"]],
    upper: [["ctw", 1], ["ap", 1]], lower: [["ctw", 1], ["rdl2", 1], ["rdl3", 1]],
  };
  if (section === "listening") return {
    m1: [["lcr", 8, "scored"], ["lcr", 4, "practice-extra"], ["lc", 2, "scored"], ["lc", 1, "practice-extra"], ["la", 2, "scored"], ["la", 1, "practice-extra"], ["lat", 1, "scored"], ["lat", 1, "practice-extra"]],
    upper: [["lcr", 3], ["lc", 2], ["lat", 2]], lower: [["lcr", 7], ["lc", 2], ["la", 2]],
  };
  if (section === "speaking") return { m1: [["repeat", 1], ["interview", 1]], upper: [], lower: [] };
  if (section === "writing") return { m1: [["bs", 10], ["email", 1], ["discussion", 1]], upper: [], lower: [] };
  return null;
}

function bucket(pool, type) {
  if (type === "rdl2") return (pool.rdl || []).filter((x) => x.questions.length === 2);
  if (type === "rdl3") return (pool.rdl || []).filter((x) => x.questions.length === 3);
  return pool[type] || [];
}

function available(items, blocked) {
  const own = new Set(blocked);
  let count = 0;
  for (const item of items) {
    if (item.realMockKeys.some((key) => own.has(key))) continue;
    count++;
    item.realMockKeys.forEach((key) => own.add(key));
  }
  return count;
}

function shuffled(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

function choose(pool, spec, blocked, rng) {
  const out = [];
  for (const [type, count, role = "scored"] of spec) {
    let picked = 0;
    for (const item of shuffled(bucket(pool, type), rng)) {
      if (item.realMockKeys.some((key) => blocked.has(key))) continue;
      out.push({ ...item, realMockRole: role });
      item.realMockKeys.forEach((key) => blocked.add(key));
      if (++picked === count) break;
    }
    if (picked < count) return null;
  }
  return out;
}

export function planRealMockExam(section, { pool = loadRealMockPool(section), doneIds = [], blockedKeys = [], rng = Math.random } = {}) {
  const spec = demand(section);
  if (!spec) return { ok: false, code: "INVALID_SECTION", deficits: [] };
  const all = Object.values(pool).flat();
  const blocked = new Set([...blockedKeys, ...expandDoneIds(doneIds, all)]);
  let m1, upper, lower;
  for (let attempt = 0; attempt < 32; attempt++) {
    m1 = choose(pool, spec.m1, new Set(blocked), rng);
    const m1Keys = new Set(blocked);
    if (m1) m1.forEach((item) => item.realMockKeys.forEach((key) => m1Keys.add(key)));
    upper = m1 && choose(pool, spec.upper, new Set(m1Keys), rng);
    lower = m1 && choose(pool, spec.lower, new Set(m1Keys), rng);
    if (m1 && upper && lower) break;
  }
  if (!m1 || !upper || !lower) {
    // 两条路线各算一遍需求，但同一题型只报一条：need 取两路较大者，path 标出是哪条路线缺
    // （两路都缺 = "both"）。可用量与路线无关（同一题池、同一批已占用 key），每个题型只算一次。
    const byType = new Map();
    const haveOf = new Map();
    for (const path of ["upper", "lower"]) {
      const perType = new Map();
      for (const [type, count] of [...spec.m1, ...spec[path]]) perType.set(type, (perType.get(type) || 0) + count);
      for (const [type, need] of perType) {
        if (!haveOf.has(type)) haveOf.set(type, available(bucket(pool, type), blocked));
        const have = haveOf.get(type);
        if (have >= need) continue;
        const prev = byType.get(type);
        if (!prev) {
          byType.set(type, { path, taskType: type, need, available: have, gap: need - have });
          continue;
        }
        prev.path = "both";
        prev.need = Math.max(prev.need, need);
        prev.gap = prev.need - prev.available;
      }
    }
    const deficits = [...byType.values()];
    if (!deficits.length) deficits.push({ path: "both", taskType: "material-conflict", need: 1, available: 0, gap: 1 });
    return { ok: false, code: "REAL_MOCK_EXHAUSTED", deficits };
  }
  const config = getRealMockConfig(section);
  const paper = {
    section, source: REAL_MOCK_SOURCE, templateVersion: REAL_MOCK_TEMPLATE_VERSION,
    m1Items: m1, m2ByPath: { upper, lower }, items: [...m1, ...upper, ...lower],
    timing: { module1Seconds: config.module1Seconds, module2Seconds: config.module2Seconds, ...(config.taskSeconds && { taskSeconds: config.taskSeconds }) },
    routeThreshold: config.routeThreshold,
  };
  if (section === "speaking") { paper.repeatSet = m1.find((x) => x.taskType === "repeat"); paper.interviewSet = m1.find((x) => x.taskType === "interview"); }
  if (section === "writing") { paper.bsQuestions = m1.filter((x) => x.taskType === "bs"); paper.emailPrompt = m1.find((x) => x.taskType === "email"); paper.discussionPrompt = m1.find((x) => x.taskType === "discussion"); }
  return { ok: true, paper };
}
