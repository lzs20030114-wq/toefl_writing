// CSS 自定义高亮（CSS.highlights）按名字全局只有一份：页面上每块原文各自报自己的 ranges，这里合起来一起画。
// 不支持 Highlight API 的浏览器什么都不做（标记只是锦上添花）。

const registry = new Map(); // name → Map(key → ranges)

function paint(name) {
  try {
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
    const all = [...(registry.get(name)?.values() || [])].flat();
    if (all.length) CSS.highlights.set(name, new Highlight(...all));
    else CSS.highlights.delete(name);
  } catch { /* 不支持就不画 */ }
}

export function setHighlightRanges(name, key, ranges) {
  if (!registry.has(name)) registry.set(name, new Map());
  const byKey = registry.get(name);
  if (ranges && ranges.length) byKey.set(key, ranges);
  else byKey.delete(key);
  paint(name);
}

export function clearHighlightRanges(name, key) {
  setHighlightRanges(name, key, null);
}
