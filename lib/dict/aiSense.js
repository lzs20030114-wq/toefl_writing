import { hasUsableSense } from "./core";

export const CONTEXT_SENSE_SYSTEM =
  "你是一位 TOEFL 辅导老师。学生在复盘时查了一个词。只返回一个 JSON 对象，包含 sense 和 explanation 两个字符串。" +
  "sense 是这个词在所给原句中的短释义，保留词性，例如 a. 非自愿的；被迫的，不超过300字。" +
  "不要把否定、对比或整段讲解放进 sense，不要罗列其他语境的意思。" +
  "explanation 用中文2-4句说明这个意思及常见搭配、词根线索或易混词。不要翻译整句，不要空话。";

export function usableContextSense(value) {
  return typeof value === "string" && !!value.trim() && value.trim().length <= 300 && hasUsableSense(value.trim());
}

/** 只接受显式短释义；旧自由文本仅作为讲解，绝不从否定或对比段落猜义项。 */
export function parseContextSense(value) {
  let parsed = value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return { sense: "", text: "" };
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { parsed = JSON.parse(json); }
    catch { return { sense: "", text: /^(?:[\[{]|```)/.test(raw) ? "" : raw }; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { sense: "", text: "" };
  const text = typeof parsed.explanation === "string" ? parsed.explanation.trim()
    : typeof parsed.text === "string" ? parsed.text.trim() : "";
  return { sense: usableContextSense(parsed.sense) ? parsed.sense.trim() : "", text };
}
