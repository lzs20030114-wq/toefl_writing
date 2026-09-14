// examword 页面的考试日期解析（纯函数，无副作用 —— 可被脚本和测试安全引用）。
//
// 当初抓 examword 时日期是从列表页手抄成一张写死表（只覆盖最新 20 条），
// 导致 recalled_supplement.json 里 24 条回忆版没有日期，真题卡片上看着像随机漏标。
// 这里把「从页面里解析日期」做成唯一口径，写死表退成兜底。

// 只认年月日俱全的写法；光有年份（版权行的 2026）不算日期。
const DATE_PATTERNS = [
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
  /(\d{4})-(\d{1,2})-(\d{1,2})/g,
  /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
  /(\d{4})\.(\d{1,2})\.(\d{1,2})/g,
];

// 合理的考试日期区间：2026 考季前后。超出的（备案年份、无关旧闻）直接丢。
const MIN_ISO = "2025-01-01";
const MAX_ISO = "2027-12-31";

function toIso(y, m, d) {
  const mo = Number(m);
  const day = Number(d);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso >= MIN_ISO && iso <= MAX_ISO ? iso : null;
}

export function stripTags(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * 列出一张页面里所有像考试日期的候选，带上下文与打分。
 * 打分（高者优先）：标题里的 > 「考试/真题/机经/日期」等关键词附近的 > 正文里靠前的。
 * 靠后的多半是「相关推荐」里别篇的日期，按位置扣分压下去。
 */
export function dateCandidates(html) {
  const titleRaw = (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1];
  const found = [];

  const scan = (hay, inTitle) => {
    for (const re of DATE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay)) !== null) {
        const iso = toIso(m[1], m[2], m[3]);
        if (!iso) continue;
        // 关键词只看日期**前面**的引导语（「考试日期：2026-05-18」这种），不看后面 ——
        // 看后面会让紧挨着的两个日期都沾上同一个词，谁在前谁赢，判错。
        const lead = hay.slice(Math.max(0, m.index - 24), m.index);
        const ctx = hay.slice(Math.max(0, m.index - 24), m.index + m[0].length + 16).trim();
        const keyworded = /考试|真题|机经|日期|写作|场次/.test(lead);
        const positionPenalty = Math.min(3, Math.floor(m.index / 1500));
        found.push({
          iso,
          ctx,
          inTitle,
          index: m.index,
          score: (inTitle ? 100 : 0) + (keyworded ? 20 : 0) - positionPenalty,
        });
      }
    }
  };
  scan(stripTags(titleRaw), true);
  scan(stripTags(html), false);

  // 同一个日期只留分最高的一条
  const best = new Map();
  for (const c of found) {
    const prev = best.get(c.iso);
    if (!prev || c.score > prev.score) best.set(c.iso, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.index - b.index);
}

/** 选定一张页面的考试日期；没有可信候选就返回 null（不猜）。 */
export function extractExamDate(html) {
  const c = dateCandidates(html);
  return c.length ? c[0].iso : null;
}

/** 列表页兜底：抓 `p=数字` 的链接 + 紧随其后的日期，返回 Map<p, iso>。 */
export function parseListing(html) {
  const pairs = new Map();
  const re = /discussion-example\?p=(\d+)([\s\S]{0,400}?)(?=discussion-example\?p=|$)/g;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const p = Number(m[1]);
    const c = dateCandidates(m[2]);
    if (c.length && !pairs.has(p)) pairs.set(p, c[0].iso);
  }
  return pairs;
}
