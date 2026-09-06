// 真题专区各题型的「已练」key —— 与常规练习页写入的是同一把钥匙（同一道题只有一个 id，
// 本来就该是同一份进度）。场次总览 / 场次详情 / 题型 picker 三处都从这里取，别各自再抄一份。
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { loadDoneIds } from "../../lib/sessionStore";

export const REAL_TYPE_DONE_KEYS = {
  ctw: DONE_STORAGE_KEYS.READING_CTW,
  rdl: DONE_STORAGE_KEYS.READING_RDL,
  ap: DONE_STORAGE_KEYS.READING_AP,
  discussion: DONE_STORAGE_KEYS.DISCUSSION,
  email: DONE_STORAGE_KEYS.EMAIL,
  bs: DONE_STORAGE_KEYS.BUILD_SENTENCE_GP,
};

/** { ctw: Set, rdl: Set, ap: Set, … } —— 非浏览器环境下全是空集（loadDoneIds 自带守卫）。 */
export function loadRealDoneByType(types) {
  const out = {};
  for (const t of types) {
    const key = REAL_TYPE_DONE_KEYS[t];
    out[t] = key ? new Set([...loadDoneIds(key)].map(String)) : new Set();
  }
  return out;
}

/** 一场里做完了几题。 */
export function countSetDone(set, doneByType) {
  let done = 0;
  for (const section of set.sections || []) {
    const ids = doneByType[section.key] || new Set();
    for (const it of section.items) if (ids.has(String(it.id))) done += 1;
  }
  return done;
}
