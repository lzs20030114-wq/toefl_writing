// 一键提问回答的版式：把 parseAnswer（+ tidyCites / tidyNoteSegments）切好的段落排成「小标题 + 内容」的块。
//
//   主干：Scientists found differences          → 块 { label: "主干", lines: [[…]] }
//   修饰：                                      → 块 { label: "修饰", lines: [[…], […]] }（多行显示成分条）
//   "which …" → 修饰 differences
//   [题1] 做错：…                                → 块 { label: <[题1] 出处段>, verdict: "做错", lines: [[…]] }
//
// 小标题 = 行首四个汉字以内加冒号。一个小标题都没有时 structured=false，界面照原来的整段文字显示
// （旧回答、自由提问、模型没照格式写，都走这条兜底）。

const HEADING_RE = /^\s*([一-龥]{1,4})[：:]\s*/;
const BULLET_RE = /^\s*(?:[-*•·・]|\d{1,2}[.)、](?!\d)|[①②③④⑤⑥⑦⑧⑨])\s*/;
const VERDICT_RE = /^\s*(做对|做错|未作答)\s*[：:，,]?\s*/;

/** 段落按换行切成行：{ heading, segs, blank }，blank = 这一行前面隔着空行。 */
export function answerLines(segments) {
  const lines = [];
  let cur = { heading: null, segs: [], blank: false };
  let newlines = 0;
  const end = (n) => {
    lines.push(cur);
    newlines = n;
    cur = { heading: null, segs: [], blank: false };
  };
  const atStart = () => !cur.heading && cur.segs.length === 0;
  const pushText = (text) => {
    let t = text;
    if (atStart()) {
      if (newlines > 1) cur.blank = true;
      t = t.replace(BULLET_RE, "");
      const m = t.match(HEADING_RE);
      if (m) {
        cur.heading = m[1];
        t = t.slice(m[0].length);
      }
    }
    if (t) cur.segs.push({ type: "text", text: t });
  };
  for (const seg of segments || []) {
    if (seg.type === "break") {
      end(seg.blank ? 2 : 1);
      continue;
    }
    if (seg.type === "heading") {
      if (!atStart()) end(1);
      if (newlines > 1) cur.blank = true;
      cur.heading = seg.text;
      continue;
    }
    if (seg.type === "text") {
      const parts = seg.text.split(/(\n+)/);
      parts.forEach((p) => {
        if (/^\n+$/.test(p)) end(p.length);
        else if (p) {
          if (atStart() && !p.trim()) return; // 行首的空白不算内容
          pushText(atStart() ? p.replace(/^\s+/, "") : p);
        }
      });
      continue;
    }
    if (atStart() && newlines > 1) cur.blank = true;
    cur.segs.push(seg);
  }
  lines.push(cur);
  return lines.filter((l) => l.heading || l.segs.some((s) => s.type !== "text" || s.text.trim()));
}

/**
 * 行 → 块。有小标题的行开一个新块；紧跟其后（中间没空行）的普通行归进这个块，当作分条。
 * 以举一反三的 [题N] 开头的行自成一块，[题N] 当标签（还能点开），「做对 / 做错」单拿出来显示。
 */
export function answerBlocks(segments) {
  const blocks = [];
  for (const line of answerLines(segments)) {
    let { heading, segs } = line;
    let label = heading;
    let verdict = null;
    if (!label && segs[0]?.type === "cite" && segs[0].kind === "past") {
      label = segs[0];
      segs = segs.slice(1);
      if (segs[0]?.type === "text") {
        const m = segs[0].text.match(VERDICT_RE);
        if (m) {
          verdict = m[1];
          const rest = segs[0].text.slice(m[0].length);
          segs = rest ? [{ ...segs[0], text: rest }, ...segs.slice(1)] : segs.slice(1);
        }
      }
    }
    // 行尾的空白不要（分条里每行单独一块，尾巴的空格会顶出空行）
    const last = segs[segs.length - 1];
    if (last?.type === "text") segs = [...segs.slice(0, -1), { ...last, text: last.text.replace(/\s+$/, "") }].filter((s) => s.type !== "text" || s.text);
    const prev = blocks[blocks.length - 1];
    if (label) blocks.push({ label, verdict, lines: segs.length ? [segs] : [] });
    else if (prev && prev.label && !line.blank && typeof prev.label === "string") prev.lines.push(segs);
    else if (prev && !prev.label && !line.blank) prev.lines.push(segs);
    else blocks.push({ label: null, verdict: null, lines: [segs] });
  }
  return { structured: blocks.some((b) => b.label), blocks };
}
