// 点讲解 / 追问里的出处标签时，把页面上原文里的那句高亮出来并滚到眼前。
// 讲解组件只发事件（flashPassageSentence），原文组件（NotedPassage）监听并在自己的 DOM 里找这句；
// 页面上没有能高亮的原文（原文收起了、这一页不是带批注的原文）时返回 false，调用方退回原来的「原句贴在下面」。

export const PASSAGE_FLASH_EVENT = "passage-flash-sentence";
export const FLASH_HIGHLIGHT = "cite-flash";
export const FLASH_MS = 4000;

/** 广播一次；有原文接住并高亮了就返回 true。 */
export function flashPassageSentence(text) {
  if (typeof window === "undefined" || !text) return false;
  const detail = { text: String(text), handled: false };
  window.dispatchEvent(new CustomEvent(PASSAGE_FLASH_EVENT, { detail }));
  return detail.handled;
}

const SKIP_SELECTOR = "[data-note-card], [data-testid='note-badge'], [data-no-flash], style, script";

/**
 * 在 root 里找 text 这句（空白按一个空格比），返回覆盖它的 Range；找不到返回 null。
 * 笔记卡、序号角标里的文字跳过（它们插在原文中间，会把句子切断）。
 */
export function findSentenceRange(root, text) {
  if (!root || !text || typeof document === "undefined") return null;
  const target = String(text).replace(/\s+/g, " ").trim();
  if (!target) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let flat = "";
  const map = []; // flat 里每个字符对应的 [node, offset]
  let lastSpace = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const v = node.nodeValue || "";
    for (let i = 0; i < v.length; i++) {
      const ch = /\s/.test(v[i]) ? " " : v[i];
      if (ch === " " && lastSpace) continue;
      lastSpace = ch === " ";
      flat += ch;
      map.push([node, i]);
    }
  }
  const at = flat.indexOf(target);
  if (at < 0) return null;
  const [startNode, startOff] = map[at];
  const [endNode, endOff] = map[at + target.length - 1];
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff + 1);
  return range;
}
