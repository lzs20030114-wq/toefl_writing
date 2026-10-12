import { splitSentences } from "../tts/wavTools";
import { questionTypeLabel } from "../reading/questionTypeLabels";
import { isSentenceSelection, sentenceOptionText } from "../reading/sentenceSelection";
import { restoreParagraphBreaks } from "../reading/passageLayout";
import { shortHash } from "../mistakes/extract";

// 练习答疑窗口（题内有据问答）的纯函数层。设计见 docs/rag-design.md，实施步骤见
// docs/rag-qa-implementation-plan.md。
//
// 不是向量检索：用户打开的是哪道题本来就知道，整道题的「证据包」直接交给模型；
// 真正的「检索」只有两处：本地错题池里同题型的历史错题、本地 ECDICT 词条。纪律三条：
//   先引用原文句子再下结论（[S3]）、不许改判标准答案、材料里没有就说没有。
// 引用由前端校验（parseAnswer），核不上的出处与引文降级显示，不当成依据。

export const QA_MAX_TURNS = 6;
// 证据包永远不丢；历史问答从最早的开始丢，直到总长落在这条线内（/api/ai message ≤ 40000）。
export const QA_MAX_MESSAGE_CHARS = 24000;
const MAX_PASSAGE_CHARS = 4000;
const MAX_RELATED = 3;

export const QA_SYSTEM =
  "你是一位 TOEFL 阅读辅导老师，正在回答学生对「这一道题」的追问。只能依据下面给出的材料作答：" +
  "原文（已按句编号 S1、S2…）、题目、选项、标准答案、学生作答、词典词条，以及学生以前的同类错题。" +
  "规则：" +
  "1）每个结论都要标出处：引用原文时在句末写 [S编号]（例如 [S3]），依据标准答案写 [答案]，依据词典词条写 [词典]，" +
  "提到学生以前的错题写 [错题1] 这样的编号；引用原文原话时用英文双引号括起来、紧跟着写出处，且必须与该句原文一字不差。" +
  "2）标准答案是权威，不得改判；如果你认为答案与原文可能有出入，只能说「这题答案与原文可能有出入，建议上报核对」。" +
  "3）对原文句子做语法、词汇、句意分析，属于本题范围，直接讲，不用任何标注。" +
  "只有原文里没有的事实信息（例如别的题、考试政策、作者是谁、文章出处）才算超出材料：这时先说「这道题的材料里没有这个信息」，" +
  "如需补一句通用常识，必须在那句前写「（非本题材料）」。" +
  "4）解析长难句时：先给主干（主谓宾），再逐个说明从句、插入语、非谓语各修饰什么，最后给一句通顺的中文意思。" +
  "5）学生说明自己当时的思路时：先指出这条思路在哪一步和原文对不上（引用那句原文并标 [S编号]），再给出正确的推理路径。" +
  "6）讲陷阱时用这些类型名：偷换概念、过度推断、范围扩大或缩小、原文未提、张冠李戴、答非所问、因果倒置。" +
  "7）如果学生以前在同类题上错过，且与本题错因相同，可以点一句「你上次在[错题N]也是…」；不相关就不要提。" +
  "插入句题里原文的插入位置写作 [■1]、[■2]… 或 [A]、[B]…，提到位置时照写。" +
  "用中文回答，简洁具体，一般不超过 8 句。直接输出纯文本，不要使用 markdown 的 ** 加粗、# 标题或列表符号。";

/**
 * 预设问题（往第一轮讲解没讲到的深处走；定位与陷阱类型第一轮已经讲过，不再重复花额度）。
 *   parse-key   拆解答案句：有选区拆选区那句；没有就让 AI 先写出答案依据句再拆（手机上不用先选句）
 *   my-thinking 我是这么想的…：不直接发，只把「我当时选 X，是因为」预填进输入框；只在作答过的题上出现
 *   simpler     讲简单点：把上一轮用更简单的话再讲一遍
 */
export const QA_PRESETS = [
  { id: "parse-key", label: "拆解答案句" },
  { id: "my-thinking", label: "我是这么想的…", prefill: true, needsAnswer: true },
  { id: "simpler", label: "讲简单点" },
];

/** 预设问题的发送文本。my-thinking 返回的是预填进输入框的半句话。 */
export function presetText(id, { selection = null, selectedLabel = "" } = {}) {
  if (id === "parse-key") {
    return selection?.text
      ? "请拆解我选中的这句：先给主干，再说明各修饰成分修饰什么，最后给一句中文意思。"
      : "请先指出本题的答案依据句是原文哪一句（标 [S编号]），再拆解这句：先给主干，再说明各修饰成分修饰什么，最后给一句中文意思。";
  }
  if (id === "my-thinking") return `我当时选 ${selectedLabel || "这个选项"}，是因为`;
  if (id === "simpler") return "请用更简单的话把上一轮的讲解再讲一遍，可以配一个中文的例子。";
  return "";
}

/**
 * 只有问错因或说自己的思路时才附上同类历史错题；拆句、讲简单点这类问题附了会诱导模型硬去联系。
 */
export function wantsMistakeContext(question, presetId) {
  if (presetId === "my-thinking") return true;
  if (presetId) return false;
  return /错|不选|陷阱|思路|为什么.{0,6}选/.test(String(question || ""));
}

/** 兜底去掉 markdown：模型偶尔不听「纯文本」的要求。 */
export function plainText(answer) {
  return String(answer || "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .trim();
}

/** 原文按段、按句编号。返回 [{ id: "S1", n: 1, para: 1, k: 1, text }]，k = 段内第几句（界面出处标签用）。 */
export function numberSentences(passage) {
  const text = String(passage || "").slice(0, MAX_PASSAGE_CHARS);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  paras.forEach((p, pi) => {
    let k = 0;
    for (const s of splitSentences(p.replace(/\s*\n\s*/g, " "))) {
      const n = out.length + 1;
      k += 1;
      out.push({ id: `S${n}`, n, para: pi + 1, k, text: s });
    }
  });
  return out;
}

/** 界面上的出处标签：「第 2 段第 3 句」；全文只有一段时写「第 3 句」。 */
export function sentenceLabel(sentence, sentences) {
  if (!sentence) return "";
  const multi = (sentences || []).some((s) => s.para > 1);
  return multi ? `第 ${sentence.para} 段第 ${sentence.k} 句` : `第 ${sentence.k} 句`;
}

// 插入句题的位置标记（生成库 [■n]、真题 [A]–[D]）不参与引文比对：模型引原文时带不带它都算对。
const INSERT_MARK_RE = /\[(?:■\d*|[A-D])\]/g;

function norm(s) {
  return String(s || "").replace(INSERT_MARK_RE, " ").toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** 找出一段文字落在原文哪一句（选区提问、选句题选项对回原文句号都用它）。 */
export function locateSentence(sentences, text) {
  const t = norm(text);
  if (!t) return null;
  const hit = (sentences || []).find((s) => norm(s.text).includes(t));
  return hit ? hit.id : null;
}

/**
 * 本题在答疑窗口里的存档键：qid + 题干签名 + 作答 + 答案 + 原文签名。
 * 原文签名不能省：真题没有 qid，同一个题干（"What is the main topic of the article?"）
 * 出现在好几篇文章里，作答相同时只靠前几项会串到别篇的对话。
 */
export function conversationKey(detail) {
  const qid = detail?.qid || "";
  const stemSig = String(detail?.stem || "").slice(0, 80);
  const passageSig = shortHash(String(detail?.passage || "").slice(0, 400));
  return `${qid}|${stemSig}|||${detail?.selected || ""}|||${detail?.correct || ""}|||${passageSig}`;
}

/**
 * 本题正确答案的原文签名，口径与错题卡 brief.correctAnswer 一致（lib/readingMistakes.js）：
 * 选择题是「键. 选项原文」，选句题是句子原文。认「本题」要题干和它同时相同——
 * 真题 RDL 有 12 个题干被 32 道题共用，只比题干会把别篇的题认成本题。
 */
export function answerSignature(detail) {
  const question = detail?.question || null;
  const options = detail?.options || question?.options || null;
  const key = detail?.correct || question?.correct_answer || question?.answer || null;
  const qtype = question?.question_type || detail?.questionType || "";
  if (isSentenceSelection(question) || isSentenceSelection({ question_type: qtype, options })) {
    return sentenceOptionText({ options }, key);
  }
  return key && options ? `${key}. ${options[key] || ""}` : (key || "");
}

/**
 * 从错题池卡片里挑同题型的历史错题。只读 brief，不碰题库。
 * cards: activeCards(pool) 的结果；subtype（rdl / ap）给了就同时按它分桶。
 * 返回 { total, items, sameQuestionWrongCount }：本题自己在错题本里的累计错次单独给，
 * 不混进「同类错题」。题干相同且正确答案原文（answerSignature）相同才算本题；
 * 没给 correctAnswer 时退回只比题干。
 */
export function pickRelatedMistakes(cards, { questionType, subtype, stem, correctAnswer } = {}) {
  const own = String(stem || "").trim();
  const ownAnswer = String(correctAnswer || "").trim();
  let sameQuestionWrongCount = 0;
  const same = [];
  for (const c of cards || []) {
    if (!c || c.subject !== "reading") continue;
    if (subtype && c.subtype && c.subtype !== subtype) continue;
    if (own && String(c.brief?.stem || "").trim() === own
      && (!ownAnswer || String(c.brief?.correctAnswer || "").trim() === ownAnswer)) {
      sameQuestionWrongCount = Math.max(sameQuestionWrongCount, c.wrongCount || 1);
      continue;
    }
    if (questionType && c.brief?.type === questionType) same.push(c);
  }
  same.sort((a, b) => String(b.lastWrongAt || "").localeCompare(String(a.lastWrongAt || "")));
  return {
    total: same.length,
    sameQuestionWrongCount,
    items: same.slice(0, MAX_RELATED).map((c) => ({
      stem: String(c.brief?.stem || "").slice(0, 200),
      userAnswer: String(c.brief?.userAnswer || "").slice(0, 200),
      correctAnswer: String(c.brief?.correctAnswer || "").slice(0, 200),
      wrongCount: c.wrongCount || 1,
      date: String(c.lastWrongAt || "").slice(0, 10),
    })),
  };
}

// 生成库插入句题的选项 "Slot 2 [■]" 写成 "Slot 2 [■2]"，与原文里的标号对上。
const slotLabel = (v) => String(v ?? "").replace(/Slot\s*(\d)\s*\[■\]/gi, (m, n) => `Slot ${n} [■${n}]`);

/**
 * 证据包：交给模型的全部材料。detail 与 useReadingAiExplain 的 detail 同形
 * （qid / stem / question / options / selected / correct / passage / isCorrect，可选 subtype、paragraphs）。
 * 老练习记录里的 AP 正文可能是单空格拼成的一坨；给了 paragraphs 就先补回段间空行
 *（lib/reading/passageLayout，段内一字不动），否则「第 N 段」会全标成第 1 段。
 * 返回 { text, sentences, materials }：materials 是校验引文时额外认的字符串（题干、选项）。
 */
export function buildEvidence(detail, related = null) {
  let passage = Array.isArray(detail?.paragraphs) && detail.paragraphs.length
    ? restoreParagraphBreaks(String(detail?.passage || ""), detail.paragraphs)
    : String(detail?.passage || "");
  // 生成库插入句题的 4 个位置都写成 [■]，选项是 "Slot 1 [■]"…——给它们标上号，模型不用自己数。
  let slot = 0;
  passage = passage.replace(/\[■\]/g, () => `[■${++slot}]`);
  const sentences = numberSentences(passage);
  const question = detail?.question || null;
  const options = detail?.options || question?.options || null;
  const lines = [];
  if (sentences.length) {
    let para = 0;
    const body = [];
    for (const s of sentences) {
      if (s.para !== para) { para = s.para; body.push(`（第 ${para} 段）`); }
      body.push(`[${s.id}] ${s.text}`);
    }
    lines.push(`原文（按句编号）：\n${body.join("\n")}`);
  } else {
    lines.push("原文：（本题没有保存原文）");
  }
  const qtype = question?.question_type || detail?.questionType || "";
  if (qtype) lines.push(`题型：${questionTypeLabel(qtype)}（${qtype}）`);
  lines.push(`题目：${detail?.stem || ""}`);

  const materials = [String(detail?.stem || "")];
  const ss = isSentenceSelection(question) || isSentenceSelection({ question_type: qtype, options });
  if (ss) {
    // 选句题的选项键也叫 S1..Sn（该段第几句），和原文句号同名——绝不能把键原样给模型，
    // 一律换成句子原文，并对回原文句号。
    const q = { options };
    const show = (key) => {
      const t = sentenceOptionText(q, key);
      if (!t) return key || "";
      const at = locateSentence(sentences, t);
      return at ? `[${at}] ${t}` : t;
    };
    lines.push("题型说明：选句题——在指定段落的各句中挑出符合题干的那一句。");
    lines.push(`学生选的句子：${detail?.selected ? show(detail.selected) : "未作答"}`);
    lines.push(`正确句子：${show(detail?.correct)}`);
  } else {
    if (options) {
      lines.push(`选项：\n${Object.entries(options).map(([k, v]) => `  ${k}. ${slotLabel(v)}`).join("\n")}`);
      materials.push(...Object.values(options).map(String));
    }
    const optionLine = (key) => {
      const v = key && options ? slotLabel(options[key]) : "";
      return v ? `${key}. ${v}` : key || "";
    };
    lines.push(`学生作答：${detail?.selected ? optionLine(detail.selected) : "未作答"}`);
    lines.push(`标准答案：${optionLine(detail?.correct)}`);
  }

  const ref = String(question?.explanation || "").trim();
  if (ref) lines.push(`参考解析（题库自带，由 AI 生成，仅供参考，与原文冲突时以原文为准）：${ref}`);
  if (related?.sameQuestionWrongCount >= 2) {
    lines.push(`错题本记录：这道题学生累计错过 ${related.sameQuestionWrongCount} 次。`);
  }
  if (related?.total > 0) {
    const rows = related.items.map((m, i) =>
      `  [错题${i + 1}] ${m.date} 题目：${m.stem}｜学生选：${m.userAnswer || "未作答"}｜正确：${m.correctAnswer}｜错过 ${m.wrongCount} 次`);
    lines.push(`学生以前的同类错题（同题型共 ${related.total} 道，列最近 ${related.items.length} 道）：\n${rows.join("\n")}`);
  }
  return { text: lines.join("\n"), sentences, materials };
}

/**
 * 自由提问里只提到一个英文词或短语、且它在原文里出现过 → 返回它，拿去查词典。
 * 提到多个英文片段（多半在问句子）或原文里没有，返回 null。
 */
export function askedEnglishTerm(question, sentences) {
  const hits = String(question || "").match(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,2}/g) || [];
  if (hits.length !== 1) return null;
  const term = hits[0].trim();
  const t = ` ${norm(term)} `;
  return (sentences || []).some((s) => ` ${norm(s.text)} `.includes(t)) ? term : null;
}

/**
 * 拼本轮 message。history: [{ q, a }]（不含本轮），firstExplain: 第一轮讲解文本。
 * selection: { kind: "sentence" | "word", text, sentenceId? }；dict: lookupWord 的返回值。
 */
export function buildQaMessage({ evidence, firstExplain = "", history = [], question, selection = null, dict = null }) {
  const head = [`【材料】\n${evidence}`];
  if (dict?.word && dict?.t) {
    head.push(`【词典】（ECDICT）${dict.word}${dict.p ? ` /${dict.p}/` : ""}：${String(dict.t).replace(/\n/g, "；")}`);
  }
  if (firstExplain) head.push(`【本题已给出的讲解】\n${firstExplain}`);
  let ask = String(question || "").trim();
  if (selection?.text) {
    const where = selection.sentenceId ? `（原文 ${selection.sentenceId}）` : "";
    ask = `${selection.kind === "word" ? "学生选中的词" : "学生选中的句子"}${where}："${selection.text}"\n${ask}`;
  }
  const tail = `【学生本轮的问题】\n${ask}`;
  const turns = history.map((t) => `学生：${t.q}\n老师：${t.a}`);
  // 从最早的问答开始丢，直到放得下
  let kept = turns.slice();
  const size = () => head.join("\n\n").length + tail.length + kept.join("\n\n").length + 40;
  while (kept.length && size() > QA_MAX_MESSAGE_CHARS) kept = kept.slice(1);
  const parts = [...head];
  if (kept.length) parts.push(`【之前的追问】\n${kept.join("\n\n")}`);
  parts.push(tail);
  return parts.join("\n\n");
}

const TAG_RE = /[[【](S\d+(?:\s*[,，、\-–]\s*S?\d+)*|答案|词典|错题\d+)[\]】]/g;
const QUOTE_RE = /["“]([^"“”]{2,})["”]/g;
// 引文紧挨着出处（中间最多 3 个空白或标点）才算「这句引文出自这条出处」。
const BOUND_QUOTE_RE = /["“]([^"“”]{2,})["”][\s，。,.、:：;；)）]{0,3}$/;

function expandIds(tag) {
  const ids = [];
  for (const part of tag.split(/\s*[,，、]\s*/)) {
    const r = part.match(/^S?(\d+)\s*[-–]\s*S?(\d+)$/);
    if (r) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      for (let i = a; i <= b && i - a < 10; i++) ids.push(`S${i}`);
    } else {
      const n = part.match(/(\d+)/);
      if (n) ids.push(`S${n[1]}`);
    }
  }
  return ids;
}

/** 文本段里再切出英文引文：{ type: "quote", text, valid }，valid = 在本题材料里找得到。 */
function splitQuotes(text, haystack) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(QUOTE_RE)) {
    if (!/[a-z]/i.test(m[1])) continue; // 中文引号内容（比如复述学生的问题）不校验
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "quote", text: m[0], valid: haystack.includes(norm(m[1])) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/**
 * 把回答切成段：
 *   { type: "text", text }
 *   { type: "quote", text, valid }               英文引文；valid = 能在原文 / 题干 / 选项里找到
 *   { type: "cite", kind, id, valid, sentence? }  kind: sentence | answer | dict | mistake
 * [Sx] 的 valid：句号存在；且如果它紧跟在一段英文引文后面，引文必须出自这几句。
 * extraMaterials：除原文外也认的字符串（buildEvidence 返回的 materials）。
 */
export function parseAnswer(text, sentences, extraMaterials = []) {
  const src = String(text || "");
  const byId = new Map((sentences || []).map((s) => [s.id, s]));
  const haystack = [...(sentences || []).map((s) => s.text), ...extraMaterials].map(norm).join(" | ");
  const out = [];
  let last = 0;
  for (const m of src.matchAll(TAG_RE)) {
    const before = src.slice(last, m.index);
    if (before) out.push(...splitQuotes(before, haystack));
    const tag = m[1];
    if (tag === "答案") out.push({ type: "cite", kind: "answer", id: tag, valid: true });
    else if (tag === "词典") out.push({ type: "cite", kind: "dict", id: tag, valid: true });
    else if (tag.startsWith("错题")) out.push({ type: "cite", kind: "mistake", id: tag, valid: true });
    else {
      const ids = expandIds(tag);
      const bound = before.match(BOUND_QUOTE_RE);
      const quote = bound && /[a-z]/i.test(bound[1]) ? norm(bound[1]) : null;
      const group = ids.map((x) => byId.get(x)).filter(Boolean).map((x) => norm(x.text)).join(" ");
      for (const id of ids) {
        const s = byId.get(id);
        out.push({ type: "cite", kind: "sentence", id, valid: !!s && (!quote || group.includes(quote)), sentence: s ? s.text : null });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(...splitQuotes(src.slice(last), haystack));
  return out;
}

/** 质量统计（埋点用）：出处总数 / 核不上的出处 / 核不上的引文。 */
export function citationStats(segments) {
  let cites = 0;
  let badCites = 0;
  let badQuotes = 0;
  for (const s of segments || []) {
    if (s.type === "cite") { cites++; if (!s.valid) badCites++; }
    if (s.type === "quote" && !s.valid) badQuotes++;
  }
  return { cites, badCites, badQuotes };
}
