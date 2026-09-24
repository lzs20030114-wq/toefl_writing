// 词根查询的输入与 AI 输出边界。不要把 AI 的“常见”当作官方词频结论。
export function normalizeRoot(raw) {
  const root = String(raw || "").trim().toLowerCase();
  return /^[a-z]{2,20}$/.test(root) ? root : "";
}

export function buildRootPrompts(root) {
  return {
    system: `你是严谨的英语词汇教师。任务是帮助中国托福备考者按词根记忆词族。
只选在学术阅读或写作中有实际价值、且确实与指定词根有构词或词源关系的英语单词。不要仅因为字母串碰巧相同就收录，也不要宣称 ETS 官方高频、出现次数或考试概率。不要编造词源。若输入更像完整单词而非传统词根，可解释它作为词族核心的用法。
只返回一个 JSON 对象，不要 Markdown。格式：{"rootMeaning":"词根/词族核心的中文含义","memoryTip":"一句简短的记忆提示","words":[{"word":"小写英语单词","partOfSpeech":"n./v./adj./adv. 等","meaning":"核心中文意思","formation":"简短构词说明","difference":"与同族词相比的用法或含义区别"}]}。
列 6–12 个有辨析价值的词；不够时少列。各字段简洁准确，difference 必须说出具体区别，不要重复释义。`,
    message: `请整理词根或词族核心 "${root}"。只收录拼写中含有 "${root}" 且词源关系成立的词。优先基础词及常用于学术语境的派生词，避免仅有复数、时态变化的重复条目。`,
  };
}

function shortText(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseRootResult(raw, root) {
  const normalizedRoot = normalizeRoot(root);
  if (!normalizedRoot) throw new Error("词根格式无效");
  const source = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data;
  try { data = JSON.parse(source); }
  catch { throw new Error("AI 返回格式有误，请重试"); }
  if (!data || typeof data !== "object" || !Array.isArray(data.words)) {
    throw new Error("AI 返回格式有误，请重试");
  }
  const seen = new Set();
  const words = data.words.slice(0, 20).map((item) => {
    const word = shortText(item?.word, 40).toLowerCase();
    if (!/^[a-z][a-z-]{1,39}$/.test(word) || !word.includes(normalizedRoot) || seen.has(word)) return null;
    const partOfSpeech = shortText(item?.partOfSpeech, 40);
    const meaning = shortText(item?.meaning);
    const formation = shortText(item?.formation);
    const difference = shortText(item?.difference, 220);
    if (!partOfSpeech || !meaning || !formation || !difference) return null;
    seen.add(word);
    return { word, partOfSpeech, meaning, formation, difference };
  }).filter(Boolean).slice(0, 12);
  if (!words.length) throw new Error("没有得到可用的同词根词汇，请换个词根试试");
  return {
    root: normalizedRoot,
    rootMeaning: shortText(data.rootMeaning),
    memoryTip: shortText(data.memoryTip, 220),
    words,
  };
}
