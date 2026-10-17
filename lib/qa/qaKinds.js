import { splitSentences } from "../tts/wavTools";

// 答疑窗口按题型分的那一层：阅读选择题（reading，最早做的那套，默认）、阅读填词（ctw）、
// 听力选择题（listening：对话 / 通知 / 讲座）、听力应答（lcr）、拖拽造句（bs）。
// 引擎（证据包 → 一条 message 走 /api/ai → 前端核对出处）四种题型共用；这里只放各题型不同的部分：
// 材料怎么编号、证据包怎么写、预设按钮。系统提示词在 lib/qa/questionQa（qaSystemFor）。
//
// 听力原文的切句和配音是同一个函数（lib/tts/wavTools 的 splitSentences，renderListening 逐句配音用它），
// 对话按轮切、通知讲座整段切，与 sentence_timings 的切法一致，所以 [S3] 就是逐句点播的第 3 句。

export const QA_KINDS = ["reading", "ctw", "listening", "lcr", "bs"];

export function qaKindOf(detail) {
  const k = detail?.qaKind;
  return QA_KINDS.includes(k) ? k : "reading";
}

const MAX_TEXT_CHARS = 4000;

/** 对话 turns → [{ speaker, text }]（缺说话人时按奇偶补 Speaker A / B，和对话气泡一致）。 */
function normTurns(conversation) {
  if (!Array.isArray(conversation)) return [];
  return conversation
    .map((t, i) => ({ speaker: String(t?.speaker || t?.name || (i % 2 === 0 ? "Speaker A" : "Speaker B")), text: String(t?.text || t?.content || "").trim() }))
    .filter((t) => t.text);
}

/**
 * 听力题（含应答）在答疑窗口里的 detail。输入是听力 AI 讲解的 detail
 *（components/listening/useListeningAiExplain：subtype / qid / stem / contextText / speaker / options / selected / correct / isCorrect），
 * 对话题再给 conversation（[{ speaker, text }]）才能按轮编号、标说话人。
 * passage 是拼平的原文：存档键签名、页面原文高亮都靠它。
 */
export function listeningQaDetail(d) {
  const lcr = String(d?.subtype || "").toLowerCase() === "lcr";
  const turns = normTurns(d?.conversation);
  const transcript = String(d?.transcript || d?.contextText || "");
  const passage = lcr ? String(d?.speaker || "") : turns.length ? turns.map((t) => t.text).join(" ") : transcript;
  return {
    ...d,
    qaKind: lcr ? "lcr" : "listening",
    stem: lcr ? "" : String(d?.stem || ""),
    turns: lcr ? [] : turns,
    transcript: lcr ? "" : transcript,
    passage,
  };
}

/**
 * 填词（C-test）某个空在答疑窗口里的 detail。输入是填词 AI 讲解的 detail
 *（components/reading/useCtwAiExplain：itemId / position / displayed_fragment / original_word / fullWord / userAnswer / passage / blankIndex / blankTotal / isCorrect）。
 */
export function ctwQaDetail(d) {
  const answered = String(d?.userAnswer ?? "").trim() !== "";
  const n = Number(d?.blankIndex);
  return {
    ...d,
    qaKind: "ctw",
    qid: `${d?.itemId || ""}#${d?.position ?? ""}`,
    stem: `填词第 ${Number.isFinite(n) ? n + 1 : "?"} 空：${d?.displayed_fragment || ""}`,
    passage: String(d?.passage || ""),
    selected: answered ? String(d?.fullWord || d?.userAnswer || "") : "",
    correct: String(d?.original_word || ""),
  };
}

/**
 * 拖拽造句一道题在答疑窗口里的 detail。输入是造句 AI 讲解的 detail
 *（components/buildSentence/useBsAiExplain：prompt / userAnswer / correctAnswer / grammar_points / isCorrect，练习记录里可能还有 qid）。
 * 练习记录只存了拼出的句子、没存词块，所以材料是：对方那句话、正确句子、学生拼出的句子、语法点。
 * passage 是「题目 + 正确句子」：存档键签名靠它（不同题可能同一个 prompt）。
 */
export function bsQaDetail(d) {
  const prompt = String(d?.prompt || "").trim();
  const correct = String(d?.correctAnswer || "").trim();
  const user = String(d?.userAnswer || "").trim();
  return {
    ...d,
    qaKind: "bs",
    qid: String(d?.qid || ""),
    stem: prompt,
    passage: [prompt, correct].filter(Boolean).join("\n"),
    selected: user,
    correct,
  };
}

/** 造句的材料编号：题目（对方的话）按句切，正确句子整句一条。label 是界面上的出处标签。 */
export function numberBs(detail) {
  const out = [];
  const prompt = splitSentences(String(detail?.stem || detail?.prompt || "").slice(0, MAX_TEXT_CHARS));
  prompt.forEach((t, i) => out.push({ id: `S${out.length + 1}`, n: out.length + 1, para: 1, k: out.length + 1, text: t, label: prompt.length > 1 ? `题目第 ${i + 1} 句` : "题目" }));
  const correct = String(detail?.correct || detail?.correctAnswer || "").trim();
  if (correct) out.push({ id: `S${out.length + 1}`, n: out.length + 1, para: 2, k: out.length + 1, text: correct, label: "正确句子" });
  return out;
}

/**
 * 听力原文编号：[{ id, n, para: 1, k, text, speaker?, label }]。label 是界面上的出处标签：
 * 通知 / 讲座「第 3 句」，对话「第 3 句（Woman）」，应答题只有一句时叫「原话」。
 */
export function numberListening(detail) {
  const out = [];
  const push = (text, speaker = "") => {
    const n = out.length + 1;
    out.push({ id: `S${n}`, n, para: 1, k: n, text, speaker });
  };
  if (detail?.qaKind === "lcr") {
    for (const s of splitSentences(String(detail?.speaker || "").slice(0, MAX_TEXT_CHARS))) push(s);
    out.forEach((s) => { s.label = out.length === 1 ? "原话" : `原话第 ${s.n} 句`; });
    return out;
  }
  const turns = Array.isArray(detail?.turns) ? detail.turns : [];
  if (turns.length) {
    let used = 0;
    for (const t of turns) {
      if (used > MAX_TEXT_CHARS) break;
      used += t.text.length;
      for (const s of splitSentences(t.text)) push(s, t.speaker);
    }
  } else {
    for (const s of splitSentences(String(detail?.transcript || detail?.passage || "").slice(0, MAX_TEXT_CHARS))) push(s);
  }
  out.forEach((s) => { s.label = s.speaker ? `第 ${s.n} 句（${s.speaker}）` : `第 ${s.n} 句`; });
  return out;
}

/** 填词这个空落在第几句：按词位置（passage.split(/\s+/) 的下标，与填词复盘页同一切法）数过去。 */
export function blankSentenceId(passage, sentences, position) {
  const words = String(passage || "").split(/\s+/);
  let pos = Number(position);
  if (!Number.isInteger(pos) || pos < 0 || pos >= words.length) return null;
  if (words[0] === "") pos -= 1; // 原文开头有空白时 split 出一个空串
  let acc = 0;
  for (const s of sentences || []) {
    acc += s.text.split(/\s+/).filter(Boolean).length;
    if (pos < acc) return s.id;
  }
  return null;
}

const optionLines = (options) => Object.entries(options || {}).map(([k, v]) => `  ${k}. ${v}`).join("\n");
const optionLine = (options, key) => {
  const v = key && options ? options[key] : "";
  return v ? `${key}. ${v}` : key || "";
};

const LISTENING_TYPE = { lc: "对话", la: "通知", lat: "学术讲座" };

/**
 * 非阅读选择题的证据包。sentences 由调用方编好号传进来（阅读填词用 numberSentences，听力用 numberListening）。
 * 返回 { lines, materials }：materials 是核对引文时除原文外也认的字符串（题干、选项）。
 */
export function kindEvidenceLines(detail, sentences) {
  const kind = qaKindOf(detail);
  const lines = [];
  const materials = [];
  const options = detail?.options || null;
  if (options) materials.push(...Object.values(options).map(String));

  if (kind === "ctw") {
    lines.push(sentences.length ? `原文（按句编号）：\n${sentences.map((s) => `[${s.id}] ${s.text}`).join("\n")}` : "原文：（本题没有保存原文）");
    lines.push("题型：阅读填词（C-test）——每个空给出单词的前几个字母，补全整个单词。原文里这个空已经还原成了正确的词。");
    const at = blankSentenceId(detail?.passage, sentences, detail?.position);
    const n = Number(detail?.blankIndex);
    const total = Number(detail?.blankTotal);
    const where = Number.isFinite(n) ? `第 ${n + 1} 个空${Number.isFinite(total) ? `（共 ${total} 个）` : ""}` : "这个空";
    lines.push(`本题：${where}${at ? `，在 [${at}]` : ""}`);
    lines.push(`已给出的字母：${detail?.displayed_fragment || ""}`);
    lines.push(`学生填写：${detail?.selected || "未作答"}`);
    lines.push(`正确答案：${detail?.correct || ""}`);
    materials.push(String(detail?.displayed_fragment || ""));
    return { lines, materials };
  }

  if (kind === "bs") {
    const prompt = sentences.filter((x) => x.para === 1);
    const correct = sentences.find((x) => x.para === 2);
    lines.push(prompt.length ? `题目（对方说的话，按句编号）：\n${prompt.map((x) => `[${x.id}] ${x.text}`).join("\n")}` : "题目：（本题没有保存）");
    lines.push("题型：拖拽造句（Build a Sentence）——把打乱的词块排成一句通顺、合语法的回应；练习记录里没有保存词块，只有拼好的句子。");
    lines.push(correct ? `正确句子：\n[${correct.id}] ${correct.text}` : "正确句子：（本题没有保存）");
    lines.push(`学生拼出的句子：${detail?.selected ? `"${detail.selected}"` : "未作答"}`);
    if (detail?.selected) materials.push(String(detail.selected));
    const gp = Array.isArray(detail?.grammar_points) ? detail.grammar_points.filter(Boolean) : [];
    if (gp.length) lines.push(`涉及语法点（题库标注）：${gp.join(", ")}`);
    return { lines, materials };
  }

  if (kind === "lcr") {
    lines.push(sentences.length ? `说话人原话（录音文字稿，按句编号）：\n${sentences.map((s) => `[${s.id}] ${s.text}`).join("\n")}` : "说话人原话：（本题没有保存）");
    lines.push("题型：听力应答（Listen and Respond）——听一句话，选最自然的回应。");
    if (detail?.situation) lines.push(`场景：${detail.situation}`);
    if (detail?.pragmaticFunction) lines.push(`该句的语用功能（题库标注）：${detail.pragmaticFunction}`);
    if (options) lines.push(`可选回应：\n${optionLines(options)}`);
    lines.push(`学生选的回应：${detail?.selected ? optionLine(options, detail.selected) : "未作答"}`);
    lines.push(`正确回应：${optionLine(options, detail?.correct)}`);
    return { lines, materials };
  }

  // 听力选择题
  if (sentences.length) {
    lines.push(`听力原文（录音文字稿，按句编号）：\n${sentences.map((s) => `[${s.id}] ${s.speaker ? `（${s.speaker}）` : ""}${s.text}`).join("\n")}`);
  } else {
    lines.push("听力原文：（本题没有保存原文）");
  }
  const sub = String(detail?.subtype || "").toLowerCase();
  lines.push(`题型：听力${LISTENING_TYPE[sub] ? `·${LISTENING_TYPE[sub]}` : ""}选择题——学生是听录音作答的，答题时看不到文字稿。`);
  lines.push(`题目：${detail?.stem || ""}`);
  materials.push(String(detail?.stem || ""));
  if (options) lines.push(`选项：\n${optionLines(options)}`);
  lines.push(`学生作答：${detail?.selected ? optionLine(options, detail.selected) : "未作答"}`);
  lines.push(`标准答案：${optionLine(options, detail?.correct)}`);
  return { lines, materials };
}

/**
 * 各题型的预设按钮（阅读选择题的在 lib/qa/questionQa QA_PRESETS）。
 * needsAnswer：只在作答过的题上出现；prefill：只预填输入框不直接发。
 */
export const KIND_PRESETS = {
  ctw: [
    { id: "parse-blank", label: "拆解这句" },
    { id: "why-form", label: "为什么是这个词形" },
    { id: "my-thinking", label: "我是这么想的…", prefill: true, needsAnswer: true },
    { id: "simpler", label: "讲简单点" },
  ],
  listening: [
    { id: "parse-key", label: "拆解答案句" },
    { id: "listen-cue", label: "听的时候抓什么" },
    { id: "my-thinking", label: "我是这么想的…", prefill: true, needsAnswer: true },
    { id: "simpler", label: "讲简单点" },
  ],
  lcr: [
    { id: "tone", label: "这句话什么语气" },
    { id: "my-thinking", label: "我是这么想的…", prefill: true, needsAnswer: true },
    { id: "other-replies", label: "还能怎么回" },
    { id: "simpler", label: "讲简单点" },
  ],
  bs: [
    { id: "parse-sentence", label: "拆解这句" },
    { id: "why-order", label: "为什么这个词放这里" },
    { id: "my-thinking", label: "我是这么排的…", prefill: true, needsAnswer: true },
    { id: "try-similar", label: "再出一道类似的" },
    { id: "simpler", label: "讲简单点" },
  ],
};

/** 预设的发送文本；my-thinking 返回预填进输入框的半句话。不是本题型的预设返回 null（交给阅读那套）。 */
export function kindPresetText(kind, id, { selectedLabel = "" } = {}) {
  if (kind === "reading") return null;
  if (kind === "bs") {
    if (id === "my-thinking") return "我当时这么排，是因为";
    if (id === "parse-sentence") return "请拆解正确句子：先给主干，再说明各修饰成分修饰什么，最后给一句中文意思，并指出这句最容易排错的位置。";
    if (id === "why-order") return "正确句子里的词序是怎么定的？请用语法规则说明关键的几个位置为什么这样排；如果我排错了，说说我那样排为什么不行。";
    if (id === "try-similar") return "按这道题考的语法点，再出一道类似的拖拽造句让我练：给一句对方的话和打乱的词块，答案放在最后。";
  }
  if (id === "my-thinking") return `我当时${kind === "ctw" ? "填" : "选"} ${selectedLabel || (kind === "ctw" ? "这个词" : "这个选项")}，是因为`;
  if (id === "parse-blank") return "请拆解这个空所在的句子：先给主干，再说明各修饰成分修饰什么，最后给一句中文意思，并说明空里的词在句中做什么成分。";
  if (id === "why-form") return "为什么这里要填这个词形？请从词性、时态或单复数、固定搭配和上下文里指出决定性的线索；如果我填了别的词，说说那个为什么不行。";
  if (id === "parse-key") return "请先指出本题的答案依据句是原文哪一句（标 [S编号]），再拆解这句：先给主干，再说明各修饰成分修饰什么，最后给一句中文意思。";
  if (id === "listen-cue") return "这题听的时候该抓什么？请指出能定位到答案句的信号词，以及下次听这类题要注意什么。";
  if (id === "tone") return "说话人这句话是什么意图、什么语气？请引原话说明是哪些词透露出来的。";
  if (id === "other-replies") return "除了正确答案，这句话还能怎么自然地回应？给两三个英文例子，再说一种不该这样回的。";
  if (id === "simpler") return "请用更简单的话把上一轮的讲解再讲一遍，可以配一个中文的例子。";
  return null;
}
