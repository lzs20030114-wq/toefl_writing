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

// 听力原文的出处：除了高亮，还要播放录音里的这一句。听力复盘页的逐句点播（useSentencePlayback）监听这个事件，
// 在自己的 sentence_timings 里找这句，找到就放；页面上没有可点播的录音时返回 false。
export const SENTENCE_PLAY_EVENT = "passage-play-sentence";

/**
 * 广播一次「播放这一句」；有录音接住并开始播放就返回 true。
 * audioUrl 必填：只有放这段录音的播放器才接（同一页多段录音里可能有一模一样的句子，例如两道应答题原话相同）。
 * whole：整段录音就是这一句（应答题）——这段录音没有逐句时间戳时就从头放整段。
 */
export function playPassageSentence(text, { audioUrl = null, whole = false } = {}) {
  if (typeof window === "undefined" || !text || !audioUrl) return false;
  const detail = { text: String(text), audioUrl: String(audioUrl), whole: !!whole, handled: false };
  window.dispatchEvent(new CustomEvent(SENTENCE_PLAY_EVENT, { detail }));
  return detail.handled;
}

/** 比对句子用的归一化：大小写、引号、标点、空白都不算差别。 */
export function sentenceMatchKey(text) {
  return String(text || "").toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
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
