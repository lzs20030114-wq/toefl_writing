/**
 * 拼盘面试大集 → 4 问一套（纯函数，无 IO）。
 *
 * 国内线下拼盘卷（rp*）的 Speaking 材料把几场不同话题的面试首尾相接成一条 11~19 问的 item。
 * 机械按 4 问切会把两场缝在一起（rp0704 第 5 问开头就是 "I'd like to discuss your views on
 * renewable energy"），所以切分表是人工逐题读出来的：data/realBank/speaking/interview-splits.json。
 *
 * 这里只做「按表拆」：表里有的 item 拆成若干 4 问子集（id 加 _cN 后缀，问题 id 不变，音频跟着问题 id 走），
 * 凑不齐 4 问的尾巴（leftover）不进库；表里没有的 item 原样通过。幂等：拆过的 item id 已带 _cN，
 * 不会再匹配到表键。
 */

export const INTERVIEW_SET_SIZE = 4;

/**
 * @param {Array<object>} items   interview.json 的 items
 * @param {object} manifest       interview-splits.json 的内容（{ splits: { [itemId]: [{chunk, topic, intro, question_ids}] }, leftover })
 * @returns {{ items: Array<object>, stats: { split: number, chunks: number, dropped_questions: number, skipped: Array<{id:string, chunk:number, why:string}> } }}
 */
export function expandInterviewSplits(items, manifest) {
  const splits = (manifest && manifest.splits) || {};
  const out = [];
  const stats = { split: 0, chunks: 0, dropped_questions: 0, skipped: [] };
  for (const item of Array.isArray(items) ? items : []) {
    const plan = splits[item.id];
    if (!Array.isArray(plan) || plan.length === 0) { out.push(item); continue; }
    const byId = new Map((item.questions || []).map((q) => [q.id, q]));
    const used = new Set();
    let emitted = 0;
    for (const c of plan) {
      const ids = Array.isArray(c.question_ids) ? c.question_ids : [];
      const missing = ids.filter((id) => !byId.has(id));
      if (ids.length !== INTERVIEW_SET_SIZE || missing.length) {
        stats.skipped.push({ id: item.id, chunk: c.chunk, why: missing.length ? `问题不在库里（可能已被复核清单下架）：${missing.join(",")}` : `需要 ${INTERVIEW_SET_SIZE} 问，表里给了 ${ids.length}` });
        continue;
      }
      const questions = ids.map((id, i) => ({ ...byId.get(id), position: `Q${i + 1}` }));
      ids.forEach((id) => used.add(id));
      out.push({
        ...item,
        id: `${item.id}_c${c.chunk}`,
        topic: String(c.topic || item.topic || "").trim(),
        intro: String(c.intro || item.intro || "").trim(),
        questions,
        split_from: item.id,
      });
      emitted += 1;
    }
    if (emitted === 0) { out.push(item); continue; } // 一份都没拆成 → 原样保留，别把题弄丢
    stats.split += 1;
    stats.chunks += emitted;
    stats.dropped_questions += (item.questions || []).filter((q) => !used.has(q.id)).length;
  }
  return { items: out, stats };
}
