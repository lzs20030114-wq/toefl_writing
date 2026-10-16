import { listeningQaDetail, ctwQaDetail } from "./qaKinds";

// 错题本的一题一卡（lib/mistakes/extract 的 card + 篇级快照 items）→ 答疑窗口要的 detail。
// 形状与各科练习记录传给 AI 讲解的 detail 一致，所以同一道题在错题本和练习记录里追问的是同一份存档
//（存档键 lib/qa/questionQa conversationKey 只看题号、题干、作答、答案和原文）。
// 篇级快照不在（老错题、被上限挤掉）时返回 null：没有原文就追问不了。
// 不带 audioUrl：错题卡上没有逐句播放器，点听力出处时把原句贴在回答下面，不提示「播放」。

const keyed = (options) => (options && typeof options === "object" && Object.keys(options).length ? options : null);

export function qaDetailForCard(card, items) {
  const it = card?.itemKey ? items?.[card.itemKey] : null;
  const brief = card?.brief || {};
  if (!it) return null;

  if (card.subject === "reading") {
    if (!String(it.passage || "").trim()) return null;
    if (card.subtype === "ctw") {
      const blanks = Array.isArray(it.blanks) ? it.blanks : [];
      const m = String(card.key || "").match(/#b(\d+)$/);
      const position = m ? Number(m[1]) : null;
      const blank = blanks.find((b) => b?.position === position) || blanks[card.index] || {};
      const user = String(brief.userAnswer || "");
      return ctwQaDetail({
        itemId: it.itemId || "",
        position: Number.isFinite(blank.position) ? blank.position : position,
        displayed_fragment: blank.displayed_fragment || "",
        original_word: blank.original_word || brief.correctAnswer || "",
        fullWord: user,
        userAnswer: user,
        passage: it.passage,
        blankIndex: card.index,
        blankTotal: blanks.length || undefined,
        isCorrect: false,
      });
    }
    const question = Array.isArray(it.questions) ? it.questions[card.index] || null : null;
    return {
      qid: question?.qid || question?.id || `${it.itemId || card.itemKey}-q${card.index}`,
      stem: brief.stem || question?.stem || "",
      question,
      options: keyed(brief.options) || question?.options || null,
      selected: brief.selected || null,
      correct: brief.correctKey || question?.correct_answer || null,
      passage: it.passage,
      subtype: card.subtype,
      isCorrect: false,
    };
  }

  if (card.subject === "listening") {
    if (card.subtype === "lcr") {
      if (!String(it.speaker || "").trim()) return null;
      return listeningQaDetail({
        subtype: "lcr",
        qid: it.itemId || card.itemKey,
        speaker: it.speaker,
        pragmaticFunction: it.pragmatic_function || "",
        options: keyed(it.options) || keyed(brief.options),
        selected: brief.selected || null,
        correct: brief.correctKey || it.answer || null,
        isCorrect: false,
      });
    }
    const question = Array.isArray(it.questions) ? it.questions[card.index] || null : null;
    const d = listeningQaDetail({
      subtype: card.subtype,
      qid: question?.qid || `${it.itemId || card.itemKey}-q${card.index}`,
      stem: brief.stem || question?.stem || "",
      contextText: it.transcript || "",
      conversation: it.conversation || null,
      options: keyed(brief.options) || question?.options || null,
      selected: brief.selected || null,
      correct: brief.correctKey || question?.answer || null,
      isCorrect: false,
    });
    return String(d.passage || "").trim() ? d : null;
  }
  return null;
}
