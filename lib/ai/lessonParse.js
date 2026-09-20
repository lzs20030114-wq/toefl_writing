import { extractSections } from "./parse";

// 讲评(lesson)输出的解析层。与评分报告的 parseReport 分开：讲评是**第二次**独立调用，
// 失败必须静默降级（报告照常显示，只是没有讲评区块），所以这里任何异常都只返回
// ok:false，绝不抛错。

const EMPTY = () => ({
  ok: false,
  verdict: { goal: "", now: "", next: "" },
  focus: { strategy: "", evidence: "", missing: "", rewrite: "", transfer: "" },
  language: [],
  compare: [],
  next: { task: "", checks: [] },
  raw: "",
});

function isNoneLine(text) {
  const v = String(text || "").trim();
  return !v || /^(无|none|n\/a|-{1,3})[。.]?$/i.test(v);
}

function stripQuotes(text) {
  let v = String(text || "").trim();
  // 模型常把引用包成 "..."、“...”、「...」或 [...]；统一剥一层。
  const pairs = [['"', '"'], ["“", "”"], ["「", "」"], ["『", "』"], ["[", "]"], ["'", "'"], ["‘", "’"]];
  for (const [open, close] of pairs) {
    if (v.length >= 2 && v.startsWith(open) && v.endsWith(close)) {
      v = v.slice(open.length, v.length - close.length).trim();
      break;
    }
  }
  return v;
}

// 把一段按「已知标签 + 冒号」切成 { 标签: 值 }。值可以跨行——一直吃到下一个已知标签
// 或段尾为止（示范改写常写成 2-3 行英文）。中英文冒号都认。
function parseLabeledBlock(text, labels) {
  const out = {};
  const src = String(text || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const labelOf = (line) => {
    const trimmed = line.replace(/^[\s\-–—•*]+/, "");
    for (const label of labels) {
      const re = new RegExp(`^${label}\\s*[:：]\\s*`);
      if (re.test(trimmed)) return { label, value: trimmed.replace(re, "") };
    }
    return null;
  };
  let current = null;
  lines.forEach((line) => {
    const hit = labelOf(line);
    if (hit) {
      current = hit.label;
      out[current] = hit.value.trim();
      return;
    }
    if (current && line.trim()) {
      out[current] = `${out[current]} ${line.trim()}`.trim();
    }
  });
  Object.keys(out).forEach((k) => {
    out[k] = stripQuotes(out[k]);
  });
  return out;
}

// 一行里按 | 切段；模型漏写 | 时退化成「整行里按标签抓」——所以取值必须在下一个
// 已知标签处停住，否则「原句」会把后面的「类型/改法」一起吞掉。
const ROW_LABELS = ["原句", "类型", "改法", "你的", "范文", "差在"];
const ROW_TERMINATOR = `(?=\\s*(?:\\||${ROW_LABELS.map((l) => `${l}\\s*[:：]`).join("|")})|$)`;

function fieldFromRow(row, label) {
  const re = new RegExp(`${label}\\s*[:：]\\s*(.*?)${ROW_TERMINATOR}`);
  const m = String(row || "").match(re);
  return m ? stripQuotes(m[1]) : "";
}

function parseLanguageSection(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (isNoneLine(src)) return [];
  const rows = src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isNoneLine(l));
  const out = [];
  rows.forEach((rawRow) => {
    const row = rawRow.replace(/^[-–—•*]+\s*/, "").trim();
    if (!row) return;
    const quote = fieldFromRow(row, "原句");
    const kindRaw = fieldFromRow(row, "类型");
    const fix = fieldFromRow(row, "改法");
    // 三个标签一个都没有：这行不是条目（可能是模型加的说明），跳过。
    if (!quote && !kindRaw && !fix) return;
    // 「不可治」里含「可治」——必须先判不可治。模型把格式说明里的「可治 或 不可治」
    // 原样照抄（两个词同时出现）时，类型视为未知，不能让「不可治」优先规则误判。
    let kind = "";
    // 用整行判：照抄成「可治|不可治」时竖线会被当成字段分隔符，kindRaw 里只剩「可治」。
    const bothCopied = /类型\s*[:：]\s*(?:可治\s*[|｜/或]\s*不可治|不可治\s*[|｜/或]\s*可治)/.test(row);
    if (bothCopied) kind = "";
    else if (kindRaw.includes("不可治") || /untreatable/i.test(kindRaw)) kind = "untreatable";
    else if (kindRaw.includes("可治") || /treatable/i.test(kindRaw)) kind = "treatable";
    out.push({ quote, kind, fix });
  });
  return out;
}

function parseCompareSection(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (isNoneLine(src)) return [];
  const rows = src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isNoneLine(l));
  const out = [];
  rows.forEach((rawRow) => {
    const row = rawRow.replace(/^[-–—•*]+\s*/, "").trim();
    if (!row) return;
    const idxMatch = row.match(/^(\d+)\s*[.、)）]\s*/);
    const body = idxMatch ? row.slice(idxMatch[0].length) : row;
    const yours = fieldFromRow(body, "你的");
    const model = fieldFromRow(body, "范文");
    const gap = fieldFromRow(body, "差在");
    // 维度名 = 第一个 | 或第一个已知标签之前的那段（模型漏写 | 时同样成立）。
    const headMatch = body.match(new RegExp(`^(.*?)${ROW_TERMINATOR}`));
    const dim = stripQuotes(headMatch ? headMatch[1] : "");
    if (!dim && !yours && !model && !gap) return;
    out.push({
      index: idxMatch ? Number(idxMatch[1]) : out.length + 1,
      dim,
      yours,
      model,
      gap,
    });
  });
  return out;
}

function parseNextSection(text) {
  const parsed = parseLabeledBlock(text, ["任务", "自查1", "自查2", "自查3", "自查"]);
  const checks = ["自查1", "自查2", "自查3"]
    .map((k) => String(parsed[k] || "").trim())
    .filter(Boolean);
  if (checks.length === 0 && parsed["自查"]) checks.push(String(parsed["自查"]).trim());
  return { task: String(parsed["任务"] || "").trim(), checks };
}

export function parseLesson(raw) {
  const base = EMPTY();
  base.raw = String(raw || "");
  try {
    const cleaned = base.raw.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "").trim();
    if (!cleaned) return base;
    const sections = extractSections(cleaned);
    if (!sections || Object.keys(sections).length === 0) return base;

    const verdictRaw = parseLabeledBlock(sections.VERDICT || "", ["目标", "现状", "下一步"]);
    const focusRaw = parseLabeledBlock(sections.FOCUS || "", [
      "策略名",
      "证据",
      "缺的是",
      "示范改写",
      "迁移",
    ]);

    const verdict = {
      goal: String(verdictRaw["目标"] || "").trim(),
      now: String(verdictRaw["现状"] || "").trim(),
      next: String(verdictRaw["下一步"] || "").trim(),
    };
    const focus = {
      strategy: String(focusRaw["策略名"] || "").trim(),
      evidence: String(focusRaw["证据"] || "").trim(),
      missing: String(focusRaw["缺的是"] || "").trim(),
      rewrite: String(focusRaw["示范改写"] || "").trim(),
      transfer: String(focusRaw["迁移"] || "").trim(),
    };

    const language = parseLanguageSection(sections.LANGUAGE || "");
    const compare = parseCompareSection(sections.COMPARE || "");
    const next = parseNextSection(sections.NEXT || "");

    // 判 ok 的下限：没有「现状」就无从指着原句说话，没有「策略名 + 示范改写」这节课
    // 就没有可迁移的抓手和动手样例 —— 缺任一条都按讲评失败处理（静默降级）。
    const ok = Boolean(verdict.now && focus.strategy && focus.rewrite);

    return { ok, verdict, focus, language, compare, next, raw: base.raw };
  } catch {
    return base;
  }
}
