/**
 * 给 #29（词形成组，2026-10-15）之前从词形表收藏的词补组。
 *
 * 那时收藏不带组名，词散在单词本里各自复习。笔记里的 AI 回答还在：
 * 逐条找出「列出所有词形」的表，表里有 ≥2 个词已收藏、且从没进过组的，就按当时的组名归进去。
 * 只看从没成过组的卡（familyUpdatedAt 为空）：用户手动移出组的词不会被拉回来。不碰复习进度。
 */
import { familyHead, splitWordForms } from "../notes/wordForms";
import { normalizeFamily } from "./book";

/** 返回 [{ family, words }]：每组只含这次要补进去的词。 */
export function familyBackfillPlan(notes, cards) {
  const book = new Map((cards || []).filter((c) => c && !c.deletedAt).map((c) => [c.word, c]));
  const taken = new Set();
  const plan = [];
  const ordered = (Array.isArray(notes) ? notes : []).filter((n) => n && !n.deletedAt)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  for (const note of ordered) {
    for (const turn of Array.isArray(note.turns) ? note.turns : []) {
      const parsed = splitWordForms(turn?.a);
      if (!parsed) continue;
      const family = normalizeFamily(familyHead(parsed.forms, note.quote));
      if (!family) continue;
      const saved = parsed.forms.map((f) => f.word.toLowerCase()).filter((w) => book.has(w));
      const fresh = saved.filter((w) => !taken.has(w) && !book.get(w).family && !book.get(w).familyUpdatedAt);
      const already = saved.filter((w) => book.get(w).family === family);
      if (!fresh.length || fresh.length + already.length < 2) continue;
      fresh.forEach((w) => taken.add(w));
      plan.push({ family, words: fresh });
    }
  }
  return plan;
}
