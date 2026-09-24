/**
 * 阅读「插入句题」（question_type: "insert_text"）题干的纯函数层。
 *
 * 题库里插入句题的 stem 是 ETS 指令 + 待插入的句子 + 提问三样揉在一段里：
 *   "There are four locations [■] in the passage that indicate where the following sentence
 *    could be added. <待插入句> Where would the sentence best fit? Select a location …"
 * 待插入句才是这道题的题面，指令是每道题都一样的套话；三样同字号同粗细堆成一坨，
 * 用户得在一段黑体里自己找哪一句是要插的。渲染层要把句子单独拎成一段，就得先拆开。
 *
 * 题干长什么样由来源决定（真题库 = 考场截图 OCR、生成库 = 校准 prompt、个人题库 = Qwen 抽题），
 * 实测有这几种（data/realBank/reading/ap.json + data/reading/bank/ap.json 全量扫过）：
 *   A. 指令 + 句子 + 提问（主流；指令里的方块写法有 [■] / [ ] / [] / ■ / [A]-[D] / 没有）；
 *      生成库会把句子包成 **'…'** 或 '…'；
 *   B. "There are four locations [A]-[D] in the passage. Where would the following sentence best fit?"
 *      + 句子（句子在最后，问号后可能没空格）；
 *   C. 句子 + 提问（OCR 丢了前面的指令）；
 *   D. 只剩句子（指令和提问都丢了）。
 * 缺掉的指令 / 提问用 ETS 标准套话补齐（filled=true），用户看到的题面才完整；
 * 反过来题干只剩套话没有句子（数据缺陷）返回 null，渲染层照旧整段原样显示，不出空白块。
 *
 * 纯函数、无 React、不碰题库 JSON —— 做题页 / 模考 / 历史复盘 / 错题本共用同一份拆法。
 */

export const INSERT_TEXT_TYPE = "insert_text";

export const DEFAULT_INSERT_LEAD =
  "There are four locations in the passage that indicate where the following sentence could be added.";
export const DEFAULT_INSERT_TAIL =
  "Where would the sentence best fit? Select a location to add the sentence to the passage.";

// 变体 A 的指令：以「following sentence … could/can/… be added/inserted」收尾。
const LEAD_ADDED_RE =
  /^(.*?\bfollowing sentence\b[^.?:]*?\b(?:could|can|might|may|should)\s+be\s+(?:added|inserted|placed)\b[^.?:]*[.:]?)\s*(.*)$/i;
// 变体 B 的指令：整句提问在前、句子在后，问号后允许没有空格。
const LEAD_ASK_RE =
  /^(.*?\bWhere\s+(?:would|does|could|should|might)\s+(?:the|this)\s+following\s+sentence\s+best\s+fit\?)\s*(.*)$/i;
// 提问：从「Where would the sentence best fit」到末尾（B 里的 "the following sentence" 不会误中）。
const TAIL_RE =
  /\s*(\bWhere\s+(?:would|does|could|should|might)\s+(?:the|this)\s+sentence\s+best\s+fit\b.*)$/i;
// 拆完剩下的正文只是一堆方块 / 括号（如 "[■]"）时，等于没句子。
const NO_LETTERS_RE = /^[^A-Za-z]*$/;

function normalize(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** 去掉生成库包在句子外面的 ** 和引号（只剥两端，句内引号原样留）。 */
export function unwrapInsertSentence(text) {
  let s = normalize(text);
  let prev;
  do {
    prev = s;
    s = s.replace(/^\*\*\s*(.*?)\s*\*\*$/, "$1");
    s = s.replace(/^[‘’'"“”]\s*(.*?)\s*[‘’'"“”]$/, "$1");
    s = s.trim();
  } while (s !== prev);
  return s;
}

/**
 * @param {string} stem 插入句题的 stem 原文
 * @returns {{ lead: string, sentence: string, tail: string, filled: boolean } | null}
 *   lead = 指令（永远非空，缺了补标准套话）；sentence = 待插入句（非空）；
 *   tail = 提问（lead 里已经问过「best fit」时为空串）；filled = 有没有补过套话。
 *   拆不出句子返回 null。
 */
export function splitInsertStem(stem) {
  const s = normalize(stem);
  if (!s) return null;

  let lead = "";
  let body = s;
  let m = s.match(LEAD_ADDED_RE);
  if (m) {
    lead = m[1].trim();
    body = m[2];
  } else if ((m = s.match(LEAD_ASK_RE))) {
    lead = m[1].trim();
    body = m[2];
  }

  let tail = "";
  const t = body.match(TAIL_RE);
  if (t) {
    tail = t[1].trim();
    body = body.slice(0, t.index);
  }

  const sentence = unwrapInsertSentence(body);
  if (!sentence || NO_LETTERS_RE.test(sentence)) return null;
  // 变体 D（指令、提问都没有）只认陈述句：以问号收尾的多半是被错标成插入题的普通题干，
  // 硬套「following sentence could be added」会把一道选择题渲染成插入题。
  if (!lead && !tail && /\?$/.test(sentence)) return null;

  const leadAsks = /\bbest fit\b/i.test(lead);
  return {
    lead: lead || DEFAULT_INSERT_LEAD,
    sentence,
    tail: tail || (leadAsks ? "" : DEFAULT_INSERT_TAIL),
    filled: !lead || (!tail && !leadAsks),
  };
}

/** 是插入句题且题干拆得出待插入句 → 返回拆分结果；否则 null（渲染层据此回落到整段原样）。 */
export function insertStemParts(question) {
  if (String(question?.question_type || "").trim() !== INSERT_TEXT_TYPE) return null;
  return splitInsertStem(question?.stem);
}
