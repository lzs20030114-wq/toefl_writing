/**
 * 真题题块的类型路由（确定性，看 OCR 正文里的官方指令语）—— 纯函数，无 IO。
 * structure_set.mjs 与 __tests__/realbank-route-type.test.js 共用（structure_set 是 CLI，import 即跑 main，测不了）。
 *
 * 真题每道题上方都有 ETS 的固定指令句，比任何启发式都可靠。两处 2026-09-14 补的口子：
 *
 *  1. **填词块至少跨 CTW_MIN_BLOCK_QUESTIONS 道题**。模块 1 最后一题（Q35）那一屏的 OCR 常把下一屏（模块 2 开头的
 *     填词屏）的「Fill in the missing letters」带进来，于是一道学术阅读 / 插入句题被当成填词块：
 *     CTW 提示词对着一道选择题转写，输出不是 JSON（或 0 个空 ≠ 1 个答案），每次重扫都照样失败 ——
 *     第一来源 11 套卷的 M1 Q35 全是这样丢的（1.21B / 1.27A / 1.28A / 1.28B / 2.1C / 2.2 …）。
 *     真填词块恒 10 空（一块 = 题号 1-10 / 11-20），只有 1 道题的块不可能是填词。
 *  2. **指令语容忍 OCR 吃掉一个 l**：5.6_v2 M2 的填词屏 OCR 成「Fil in the missing letters」，
 *     被当成日常阅读 → 选择题提示词 → 选项 0 个 → flagged，重扫同样治不了。
 */
const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/** 真填词块恒 10 空；少于这个题数的块不走填词路由（与 structure_set 的 CTW_MIN_ANSWERS 同值）。 */
const CTW_MIN_BLOCK_QUESTIONS = 5;

const ROUTES = [
  [/fil+\s*in\s*the\s*missing\s*letters/i, "ctw"],
  [/listen\s*and\s*repeat/i, "repeat"],
  [/choose\s*the\s*best\s*response/i, "lcr"],
  [/listen\s*to\s*a\s*conversation/i, "lc"],
  [/listen\s*to\s*an?\s*announcement/i, "la"],
  [/listen\s*to\s*an?\s*(academic\s*)?(talk|lecture|discussion)/i, "lat"],
];

/** 这一块覆盖几道题（没有题号范围的老调用方 → null，不据此拦）。 */
function blockQuestionCount(block) {
  const s = Number(block && block.start);
  const e = Number(block && block.end);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? e - s + 1 : null;
}

/**
 * @param {{body?: string, section?: string, start?: number, end?: number}} block alignment 里的题块
 * @returns {string} ctw | repeat | lcr | lc | la | lat | build | listening_mcq | rdl | ap | interview | unknown
 */
function routeType(block) {
  const body = (block && block.body) || "";
  const span = blockQuestionCount(block);
  for (const [re, type] of ROUTES) {
    if (!re.test(body)) continue;
    if (type === "ctw" && span != null && span < CTW_MIN_BLOCK_QUESTIONS) continue;   // 串进来的下一屏指令语
    return type;
  }
  const section = block && block.section;
  if (section === "writing") return "build";
  if (section === "listening") return "listening_mcq"; // 归属段落在音频里，稍后按音频分段并回
  if (section === "reading") {
    // 学术短文 vs 日常阅读：真题里日常阅读的材料是海报/说明/网页，普遍短且带
    // "Read a poster / Read some instructions" 这类指令；学术短文明显更长。
    if (/read\s+(a|an|some)\s+(poster|instructions?|notice|advertisement|web\s*page|page\s*from|email|menu|schedule|flyer|message)/i.test(body)) return "rdl";
    return countWords(body) >= 160 ? "ap" : "rdl";
  }
  if (section === "speaking") return "interview"; // 题干在音频里
  return "unknown";
}

module.exports = { ROUTES, routeType, blockQuestionCount, CTW_MIN_BLOCK_QUESTIONS };
