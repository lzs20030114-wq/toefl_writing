/**
 * 真题材料「断句体检」—— 找出源料被截掉半句的材料文本。
 *
 * 为什么单独一道闸：回忆版真题是从截图 / 重排版 docx 里抽出来的，抽取窗口截断时
 * 材料会在半句处断掉（"…while having fun. Whether you're a" 后面直接跳到下一段），
 * 用户看到的就是「丢字」。2026-09-07 那轮复核只按**字段末尾**扫，
 * 断在中间段落的那一类（后面还跟着一行正常收尾的文字）整批漏网。
 *
 * 两条判据，都只对「成句材料字段」生效（题干 / 选项 / 表单行 / 标题天然就是片段，不算）：
 *   A 段中断句：某行以不可能收尾的功能词结束（a / the / to / as / whether …），
 *     且下一行另起（大写或项目符号开头）—— 硬换行的续行是小写开头，据此排除；
 *   B 结尾断句：字段最后一行是散文却没有句末标点（且不是网址 / 邮箱结尾）。
 *
 * 两条都先过「字段级门」：该字段的散文行里 ≥60% 正常收尾，才认为它是「一行一段」的排版，
 * 否则就是整段硬换行 / 表格 / 表单，行尾没标点属正常。单行字段（scenario 这类指令语）直接按 B 判。
 *
 * 修法不在这里：结论写进 data/realBank/review-holds.json 的 patches（trim_tail / replace），
 * 由 apply_review.mjs 幂等重放 —— 源料在 .codex-tmp 不进 git，build_bank 重跑会把截断原样再产一遍。
 *
 * 用法: node scripts/realbank/truncation_scan.js
 */

// 成句材料字段：这些字段里出现半句 = 材料被截。其余字段（stem/options/topic/…）片段合法。
const MATERIAL_KEYS = new Set([
  "text", "passage", "transcript", "scenario", "announcement", "intro", "situation", "context",
]);

const TERMINAL = /[.!?…"”’)\]]\s*$/;
// 网址 / 邮箱结尾不带句号是正常排版（"RSVP at www.example.edu"）
const URL_TAIL = /(?:https?:\/\/|www\.)\S+$|[\w.+-]+@[\w-]+\.[a-z]{2,}$/i;
// 时间（"9:00 AM"）不算断句 —— 与下面的 am 无关，先挡掉更稳
const TIME_TAIL = /\d\s*(?:[ap]\.?m\.?)$/i;

// 英文句子不可能以这些词收尾；命中 = 后面还有字被截掉了。
// 刻意不收 am（"9:00 AM"）与 i'm（口语句尾合法）。
const DANGLING = new RegExp(
  "\\b(?:a|an|the|and|or|but|of|to|in|on|at|for|with|from|by|as|that|which|who|whose|" +
  "is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|" +
  "shall|should|may|might|must|into|onto|upon|about|over|under|between|among|through|" +
  "during|before|after|while|because|although|though|if|when|where|than|then|so|such|" +
  "their|its|his|her|our|your|my|this|these|those|not|more|most|very|also|both|" +
  "either|neither|each|every|some|any|many|much|few|several|other|another|" +
  "it's|you're|they're|we're|he's|she's|there's|whether|per|via|without|within)\\s*$",
  "i",
);

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
/** 散文行：够长、不是全大写标题、不是项目符号/表单/表格行。标签行的行尾没标点属正常。 */
function isProse(line) {
  const w = words(line);
  if (w.length < 7) return false;
  if (line === line.toUpperCase()) return false;
  if (/^[•\-*☐☑☒|]/.test(line.trim())) return false;
  if (/[☐☑☒]/.test(line)) return false;      // 勾选框 = 表单
  if (/\|/.test(line)) return false;                        // 竖线 = 表格
  // 「标签: 取值」且整行不含句末标点 = 表单行（"Device Type: Laptop Tablet Smartphone Other"）
  if (/^[^:]{1,30}:/.test(line.trim()) && !/[.!?]/.test(line)) return false;
  return true;
}
const closed = (line) => TERMINAL.test(line) || URL_TAIL.test(line.trim()) || TIME_TAIL.test(line.trim());

/** 一个材料字段的断句体检。返回命中数组（可能多条）。 */
function scanField(value) {
  const lines = String(value || "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const prose = lines.filter((l) => l.trim() && isProse(l));
  if (!prose.length) return [];
  const ratio = prose.filter(closed).length / prose.length;
  const singleLine = prose.length === 1;
  const hits = [];
  // A 段中断句：整段硬换行的材料（续行本来就断在半句）不适用，用字段级完整率挡掉
  if (!singleLine && ratio >= 0.6) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim() || closed(line) || !isProse(line) || words(line).length < 5) continue;
      if (!DANGLING.test(line)) continue;
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && !/^[A-Z0-9•\-*•]/.test(next.trim())) continue;  // 小写续行 = 硬换行
      hits.push({ kind: "dangling", line: i + 1, text: line });
    }
  }
  // B 结尾断句：整块都是「标签 取值」的表格/清单（没有任何一行正常收尾）不适用，
  // 但单行字段（scenario 这类指令语）就该按一句话判。
  const proseLooksLikeTable = !singleLine && prose.filter(closed).length === 0;
  const last = [...lines].reverse().find((l) => l.trim());
  if (!proseLooksLikeTable && last && isProse(last) && !closed(last) && !hits.some((h) => h.text === last)) {
    hits.push({ kind: "unterminated_tail", line: lines.length, text: last });
  }
  return hits;
}

/** 遍历一个成品条目的所有材料字段。 */
function scanItem(item, path = "", out = []) {
  if (Array.isArray(item)) {
    item.forEach((v, i) => scanItem(v, `${path}.${i}`, out));
    return out;
  }
  if (!item || typeof item !== "object") return out;
  for (const [k, v] of Object.entries(item)) {
    const p = path ? `${path}.${k}` : k;
    if (p.startsWith("paragraphs")) continue;               // AP 的 paragraphs 是 passage 的派生
    if (typeof v === "string") {
      if (MATERIAL_KEYS.has(k) && v.length > 40) {
        for (const h of scanField(v)) out.push({ path: p, ...h });
      }
    } else scanItem(v, p, out);
  }
  return out;
}

module.exports = { scanField, scanItem, MATERIAL_KEYS };

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(process.cwd(), "data", "realBank");
  let total = 0;
  for (const sub of fs.readdirSync(dir)) {
    const d = path.join(dir, sub);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
      if (/counts|aliases|sets/.test(f)) continue;
      const items = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")).items || [];
      for (const it of items) {
        for (const h of scanItem(it)) {
          total += 1;
          console.log(`${sub}/${f.replace(/\.json$/, "")}  ${it.id}  .${h.path}  [${h.kind}] 第${h.line}行`);
          console.log(`    …${h.text.slice(-110)}`);
        }
      }
    }
  }
  console.log(total ? `\n断句体检：命中 ${total} 处` : "断句体检：干净");
}
