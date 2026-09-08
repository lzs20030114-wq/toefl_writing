/**
 * 造句真题的「前端能不能渲染」闸。
 *
 * lib/realBank.js 的 groupBsBatches 对适配失败的题是**静默丢弃**（console.warn 后跳过）——
 * 那是运行时的正确姿态（一题坏不许整页崩），但代价是库里可以躺着永远出不来的题，
 * 而题量统计、批次卡上的「N 题」全按库里的条数算，于是前端显示的题数和实际能做的题数对不上。
 *
 * 闸门放在落库这一侧：build_bank 收题前，用**真的 runtimeModel** 跑一遍
 * （与听力/口语落库前跑真的 validator 同一套哲学），过不了的整条不收。
 *
 * 这里的 deriveBsPrefilled 是 lib/realBank.js 同名函数的移植而不是复用：lib/realBank.js
 * 用的是打包器语法（`import x from "*.json"`），普通 Node 脚本 import 不进来。两边一旦
 * 分叉，__tests__/real-bank-data.test.js 那条「回忆版造句每题都能被 runtime 消费」会先红。
 */
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const runtimeModel = require(path.join(process.cwd(), "lib", "questionBank", "runtimeModel.js"));

const normWord = (s) => String(s || "").toLowerCase().replace(/[.,!?;:]/g, "").trim();
const stripEdge = (w) => String(w || "").replace(/^[^\w'’]+/, "").replace(/[^\w'’]+$/, "");

function parseBlanks(blanks) {
  const segments = String(blanks || "").split(/_{2,}/);
  const tokens = [];
  segments.forEach((seg, i) => {
    const words = seg.split(/\s+/).map(stripEdge).filter(Boolean);
    if (words.length) tokens.push({ type: "literal", words });
    if (i < segments.length - 1) tokens.push({ type: "blank" });
  });
  return tokens;
}

function deriveBsPrefilled(answer, blanks) {
  const tokens = parseBlanks(blanks);
  const aw = String(answer || "").trim().split(/\s+/).map(normWord).filter(Boolean);
  const prefilled = [];
  const positions = {};
  let lower = 0;
  let pending = 0;
  for (const tok of tokens) {
    if (tok.type === "blank") { pending += 1; continue; }
    const target = tok.words.map(normWord);
    let found = -1;
    for (let i = lower + pending; i + target.length <= aw.length; i += 1) {
      let ok = true;
      for (let j = 0; j < target.length; j += 1) if (aw[i + j] !== target[j]) { ok = false; break; }
      if (ok) { found = i; break; }
    }
    const key = tok.words.join(" ");
    if (found < 0) throw new Error(`固定词「${key}」对不齐 answer`);
    if (key in positions) throw new Error(`固定词「${key}」在模板中重复`);
    prefilled.push(key);
    positions[key] = found;
    lower = found + target.length;
    pending = 0;
  }
  return { prefilled, positions };
}

/** 过闸返回 null，不过闸返回原因字符串。 */
export function bsRuntimeReject(raw) {
  try {
    const ds = (Array.isArray(raw?.distractors) ? raw.distractors : [])
      .map((d) => String(d || "").trim()).filter(Boolean);
    const dropped = new Set(ds.slice(1));
    const chunks = (Array.isArray(raw?.chunks) ? raw.chunks : [])
      .map((c) => String(c || "").trim()).filter((c) => c && !dropped.has(c));
    if (new Set(chunks).size !== chunks.length) return "词块重复";
    const { prefilled, positions } = deriveBsPrefilled(raw.answer, raw.blanks);
    const q = runtimeModel.normalizeRuntimeQuestion({
      ...raw, chunks, prefilled, prefilled_positions: positions, distractor: ds[0] || null,
    });
    if (runtimeModel.normalizeWord(runtimeModel.renderCorrectSentence(q))
      !== runtimeModel.normalizeWord(raw.answer)) return "词块拼不回 answer";
    return null;
  } catch (e) {
    return String(e?.message || e);
  }
}
