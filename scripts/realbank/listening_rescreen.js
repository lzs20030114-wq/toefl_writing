/**
 * 听力「补抽」—— 屏上有整道题、结构化却没抽出来的那些屏（纯函数，无 IO，可单测）。
 *
 * ── 盘子 ──────────────────────────────────────────────────────────────────
 * 题面 PDF 的每一屏（"00:00:27 Hide Time" 开头）就是卷面上的一道题：题干 + 4 个选项。
 * 结构化阶段（DeepSeek 读 OCR 汤）时不时整屏漏掉、或抽成空题 / 只剩两三个选项。
 * 这些屏的原文一直躺在 `<卷>.json` 的 blocks 里，答案页上也有这道题的字母 —— 白丢。
 *
 * ── 为什么不重跑 structure_set ────────────────────────────────────────────
 * 2026-09-16 实测：structure_set 的「合并邻块重切」修复轮会**串题** —— 相邻题的题干挪错位，
 * 盲审只拦得住大部分（题干配错材料时模型等于瞎选，1/4 概率蒙对答案页而漏网）。
 * 本脚本反过来：**一屏一屏地看**，屏与题号的对应由 `listening_renumber` 那套「页眉顺序」判据给出，
 * 不动任何已经抽出来的题，只往题组里补这一道。
 *
 * ── 模型只许做一件事：把 OCR 吃掉的空格放回去 ─────────────────────────────
 * 屏幕原文长这样（空格被 OCR 吃了，直接上线就是乱码）：
 *   `Whydoesthewoman mentionthreenewstaff members?`
 *   `Tocorrect theman'smisunderstanding`
 * 所以 DeepSeek 的活儿只有「恢复空格 + 分出题干与从上到下的 4 个选项」，不许改词、不许补词。
 * 这一点由 `transcriptionFaithful` 机械验收：把模型输出归一（只留小写字母数字）之后，
 * 每一段都必须是**屏幕原文归一串的子串**，而且出现位置逐段递增。改一个词、漏一个词、
 * 把两个选项对调，都过不了这道闸 —— 于是「模型幻觉」这条路被彻底堵死，剩下的只有 OCR 本身的错。
 *
 * ── 硬护栏（任一不过就不收这一屏）────────────────────────────────────────
 *   G1 这一屏没被任何 structured 题认领（认领判据与 listening_renumber 同一套屏幕表）
 *   G2 屏幕归一文本 ≥ MIN_SCREEN_CHARS（太短的是横幅碎片，不是一道题）
 *   G3 题号落在某个 status=ok、没有 dup_of、**有材料**（transcript_final）的听力题组的题号带内
 *      —— 跨卷重复组补了也不上线；没材料的组盲审时没东西可读
 *   G4 答案页上有这道题的字母
 *   G5 模型输出忠实（transcriptionFaithful）
 *   G6 vision_mcq.verifyMcq：恰好 4 个选项、不重复、无中文、无水印；stampAnswer 盖得上答案
 *   G7 题干与同组既有题**逐字不同**（同一屏被抽过两遍的老病，不能再补一份）
 * 过了闸也**不免盲审**：补出来的题照样进 audit_answers 的 `--only-missing`，不一致不收。
 */
const R = require("./listening_renumber.js");
const { stampAnswer, verifyMcq } = require("./vision_mcq.js");

/** 屏幕归一文本至少这么长才当一道题看（与 listening_renumber_run 的 UNCLAIMED_MIN_CHARS 同值）。 */
const MIN_SCREEN_CHARS = 200;

/** 从题组抄到补出来的题上的材料字段（合流器给同组其它题挂的就是这几个）。 */
const MATERIAL_FIELDS = ["transcript_final", "turns", "framing", "asr_similarity"];

/** 页码横幅 / 翻页残尾 / 水印：确定性清掉，免得混进题干。 */
const JUNK_LINE = [
  /^=+\s*PAGE\s*\d+\s*=+$/i,
  /^\s*$/,
  /^(Listening|Reading|Speaking|Writing)\s*$/i,
  /^Listen(ing)?\s*(to|and)?\s*(a|an|some)?\s*$/i,
  /^唯一|闲鱼|盗卖|满分小屋|甜茶/,
  /^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/,
];

/**
 * 与 listening_renumber.buildScreenMap 同一套切法（「连续 k-1 个空 block + 1 个有正文 block」= 一页 k 屏），
 * 但**保留原文**：补抽要拿原文去让模型恢复空格，归一串只用来做验收。
 */
function rawScreenMap(moduleBlocks) {
  const screens = new Map();
  let pending = [];
  for (const b of moduleBlocks || []) {
    const parts = R.splitScreens(b && b.body);
    if (!parts.length) { pending.push(b.start); continue; }
    const nums = pending.concat([b.start]);
    pending = [];
    if (parts.length !== nums.length) continue;       // fail-closed，与 buildScreenMap 同
    nums.forEach((n, i) => screens.set(n, parts[i]));
  }
  return screens;
}

/** 确定性清洗：去掉计时器那一行与页码横幅一类的垃圾行。 */
function cleanScreenText(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    let l = lines[i];
    if (i === 0) l = l.replace(R.TIMER_RE, "").trim();  // 第一行开头的 "00:00:27 Hide Time"
    if (JUNK_LINE.some((re) => re.test(l.trim()))) continue;
    if (l.trim()) out.push(l.trim());
  }
  return out.join("\n");
}

/** 答案页：module → { 题号 → 字母 }。 */
function answerMap(scan) {
  const out = {};
  for (const m of ((scan && scan.alignment && scan.alignment.listening && scan.alignment.listening.modules) || [])) {
    out[m.module] = {};
    for (const x of m.matched || []) out[m.module][x.n] = String(x.answer || "").toLowerCase();
  }
  return out;
}

/**
 * 这一卷值得补抽的屏（G1~G4）。
 * @returns {Array<{module, q, type, groupKey, answer, raw, clean, group}>}
 */
function candidateScreens({ scan, structured, minChars }) {
  const min = Number.isFinite(minChars) ? minChars : MIN_SCREEN_CHARS;
  const groups = ((structured && structured.results) || []).filter((r) => r.section === "listening");
  const claimed = new Set();
  for (const g of groups) for (const it of g.items || []) claimed.add(`${g.module}#${it.q_number}`);
  const answers = answerMap(scan);
  const out = [];
  for (const [module, blocks] of R.blocksByModule((scan && scan.blocks) || [])) {
    for (const [q, raw] of rawScreenMap(blocks)) {
      if (claimed.has(`${module}#${q}`)) continue;                                  // G1
      if (R.normText(raw).length < min) continue;                                   // G2
      const g = groups.find((r) => Number(r.module) === Number(module)
        && r.status === "ok" && !r.dup_of
        && q >= Number(r.q_start) && q <= Number(r.q_end)
        && String(r.transcript_final || "").trim());                                // G3
      if (!g) continue;
      const answer = answers[module] && answers[module][q];                         // G4
      if (!/^[a-d]$/.test(String(answer || ""))) continue;
      out.push({ module: Number(module), q, type: g.type, groupKey: g.key, answer, raw, clean: cleanScreenText(raw), group: g });
    }
  }
  return out.sort((a, b) => a.module - b.module || a.q - b.q);
}

/**
 * G5 反幻觉闸：模型只许把空格放回去。
 *
 * 归一（只留小写字母数字）之后，题干与 4 个选项必须各自是屏幕原文归一串的**子串**，
 * 且出现位置逐段递增（题干在前、选项按 A→D 顺序在后）。
 * @returns {{ok: boolean, why?: string}}
 */
function transcriptionFaithful(screenText, stem, options) {
  const hay = R.normText(screenText);
  const parts = [String(stem || ""), ...(Array.isArray(options) ? options : [])];
  let at = -1;
  for (let i = 0; i < parts.length; i += 1) {
    const needle = R.normText(parts[i]);
    const label = i === 0 ? "题干" : `选项 ${"ABCD"[i - 1] || i}`;
    if (!needle) return { ok: false, why: `${label}为空` };
    const pos = hay.indexOf(needle, at + 1);
    if (pos < 0) return { ok: false, why: `${label}不是屏幕原文的子串（模型改了词或补了词）` };
    at = pos;
  }
  return { ok: true };
}

/**
 * 一屏 + 模型转写 → 待插入的 item（G5~G7 全过才返回 item）。
 * @param {{q, answer, module, group}} cand candidateScreens 的一条
 * @param {{stem: string, options: string[]}} tx 模型转写
 * @returns {{ok: boolean, item?: Object, why?: string}}
 */
function buildRescreenItem(cand, tx) {
  const stem = String((tx && tx.stem) || "").replace(/\s+/g, " ").trim();
  const options = (Array.isArray(tx && tx.options) ? tx.options : []).map((o) => String(o || "").replace(/\s+/g, " ").trim());
  if (options.length !== 4) return { ok: false, why: `选项 ${options.length} 个（真题恒 4 个）` };
  const faithful = transcriptionFaithful(cand.raw, stem, options);
  if (!faithful.ok) return { ok: false, why: faithful.why };
  const item = { q_number: cand.q, stem, options };
  const problems = [...verifyMcq(item), ...stampAnswer(item, cand.answer)];
  if (problems.length) return { ok: false, why: problems.join("；") };
  const mine = R.normText(stem);
  const dup = (cand.group.items || []).find((it) => R.normText(it.stem) === mine);       // G7
  if (dup) return { ok: false, why: `题干与同组 Q${dup.q_number} 逐字相同` };
  item.answer_key = String(cand.answer).toLowerCase();
  // 材料挂所在题组的定稿转写 —— 与合流器给同组其它题挂的是同一份。
  // 不挂的话 audit_answers 找不到材料，这道题会落进 skipped（「仍审不了」），补了等于没补。
  for (const f of MATERIAL_FIELDS) {
    if (cand.group && cand.group[f] != null) item[f] = cand.group[f];
  }
  item.rescreened = true;
  return { ok: true, item };
}

/** 把补出来的 item 插进题组（就地改），并在 problems 上留痕。返回插了几条。 */
function applyRescreen(structured, results) {
  let added = 0;
  for (const r of results) {
    if (!r.ok || !r.item) continue;
    const g = ((structured && structured.results) || []).find((x) => x.section === "listening" && x.key === r.groupKey);
    if (!g) continue;
    if ((g.items || []).some((it) => it.q_number === r.item.q_number)) continue;
    g.items = Array.isArray(g.items) ? g.items : [];
    g.items.push(r.item);
    g.items.sort((a, b) => (a.q_number || 0) - (b.q_number || 0));
    g.problems = Array.isArray(g.problems) ? g.problems : [];
    g.problems.push(`listening_rescreen:Q${r.item.q_number} 屏上有题、结构化漏抽，按屏幕原文补抽（模型只恢复空格）`);
    added += 1;
  }
  return added;
}

module.exports = {
  MIN_SCREEN_CHARS, MATERIAL_FIELDS, JUNK_LINE,
  rawScreenMap, cleanScreenText, answerMap, candidateScreens,
  transcriptionFaithful, buildRescreenItem, applyRescreen,
};
