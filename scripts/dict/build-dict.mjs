#!/usr/bin/env node
/**
 * 从 ECDICT 裁出本项目专用的划词词典分片。
 *
 *   node scripts/dict/build-dict.mjs --src <ecdict.csv> [--out public/dict] [--stats]
 *
 * 为什么要裁：ECDICT 全量 77 万词条 / 66MB，直接丢进 public 前端扛不住。
 * 本项目真正会被查的词就两类——题库文本里出现过的，以及学生自己上传/未来新生成的题
 * 大概率会用到的通用考试词。所以收录规则是：
 *   ① 词形在 data/ 各题库里出现过（含它的屈折变形）；或
 *   ② ECDICT 标了考试词表标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre）；或
 *   ③ BNC 或当代词频排名进前 FRQ_TOP。
 *
 * 产物：public/dict/<a-z>.json + _.json，每片是扁平表
 *   { [词形]: { p, t, g } | "同片内另一个词形（别名）" }
 * 屈折变形在这里就并好了（studies → study），所以前端不需要词形还原表；
 * 跨首字母的不规则变形（went → go）直接内联一份完整词条，避免前端二次 fetch。
 */
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const STATS_ONLY = args.includes("--stats");
const SRC = getArg("src", "");
const OUT = getArg("out", "public/dict");
const FRQ_TOP = Number(getArg("frq-top", 20000));
const MAX_SENSES = 3;
const MAX_SENSE_LEN = 60;

if (!SRC || !fs.existsSync(SRC)) {
  console.error("用法: node scripts/dict/build-dict.mjs --src <ecdict.csv> [--out public/dict] [--stats]");
  process.exit(1);
}

// ── 1. 题库词形 ──────────────────────────────────────────────────────────────
const BANK_ROOTS = [
  "data/reading/bank",
  "data/listening/bank",
  "data/speaking/bank",
  "data/realBank",
  "data/realExam2026",
  "data/academicWriting",
  "data/emailWriting",
  "data/buildSentence",
  "data/vocabulary",
];

function collectBankForms() {
  const set = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "staging") continue; // 未合库的暂存区不算
        walk(p);
      } else if (e.name.endsWith(".json")) {
        const text = fs.readFileSync(p, "utf8").toLowerCase();
        for (const m of text.matchAll(/[a-z][a-z'-]*/g)) {
          const w = m[0];
          if (w.length > 1 && w.length <= 30) set.add(w);
        }
      }
    }
  };
  BANK_ROOTS.forEach(walk);
  return set;
}

// ── 2. CSV ──────────────────────────────────────────────────────────────────
// ECDICT 把释义里的换行写成字面量 \n，所以一行 = 一条记录，按行切是安全的。
function parseLine(line) {
  const out = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

const EXAM_TAGS = ["toefl", "gre", "ielts", "cet6", "cet4", "ky", "gk", "zk"];
const TAG_LABEL = {
  toefl: "TOEFL", gre: "GRE", ielts: "IELTS",
  cet6: "CET-6", cet4: "CET-4", ky: "考研", gk: "高考", zk: "中考",
};

function pickTag(tagField) {
  if (!tagField) return "";
  const tags = tagField.split(/\s+/);
  for (const t of EXAM_TAGS) if (tags.includes(t)) return TAG_LABEL[t];
  return "";
}

function trimTranslation(raw) {
  if (!raw) return "";
  const lines = raw
    .split(/\\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("[网络]"));
  const kept = (lines.length ? lines : raw.split(/\\n/).map((s) => s.trim()).filter(Boolean))
    .slice(0, MAX_SENSES)
    .map((s) => (s.length > MAX_SENSE_LEN ? `${s.slice(0, MAX_SENSE_LEN)}…` : s));
  return kept.join("\n");
}

// exchange 形如 "p:studied/d:studied/i:studying/3:studies/s:studies"
// 0 = 原形指针、1 = 该原形的其它变形，都不是「本词的变形」，跳过。
function parseExchange(ex) {
  if (!ex) return [];
  const forms = [];
  for (const part of ex.split("/")) {
    const [kind, val] = part.split(":");
    if (!val || kind === "0" || kind === "1") continue;
    for (const v of val.split(",")) {
      const w = v.trim().toLowerCase();
      if (w && /^[a-z][a-z'-]*$/.test(w)) forms.push(w);
    }
  }
  return forms;
}

// ── 3. 扫一遍，边扫边判收录 ──────────────────────────────────────────────────
const bankForms = collectBankForms();
console.log(`题库词形: ${bankForms.size}`);

const raw = fs.readFileSync(SRC, "utf8");
const lines = raw.split(/\r?\n/);
console.log(`ECDICT 行数: ${lines.length}`);

const entries = new Map(); // word -> { p, t, g, ex: [] }
const reason = { bank: 0, tag: 0, frq: 0 };

for (let li = 1; li < lines.length; li += 1) {
  const line = lines[li];
  if (!line) continue;
  const f = parseLine(line);
  const word = (f[0] || "").trim();
  if (!word || word.length > 40) continue;
  const lower = word.toLowerCase();
  // 只收纯英文词/词组，跳过带数字或奇怪符号的条目
  if (!/^[a-z][a-z' -]*$/.test(lower)) continue;

  const tag = f[7] || "";
  const bnc = Number(f[8]) || 0;
  const frq = Number(f[9]) || 0;
  const exForms = parseExchange(f[10] || "");

  const inBank = bankForms.has(lower) || exForms.some((x) => bankForms.has(x));
  const examTag = EXAM_TAGS.some((t) => tag.split(/\s+/).includes(t));
  const common = (bnc > 0 && bnc <= FRQ_TOP) || (frq > 0 && frq <= FRQ_TOP);
  if (!inBank && !examTag && !common) continue;

  if (inBank) reason.bank += 1;
  else if (examTag) reason.tag += 1;
  else reason.frq += 1;

  const t = trimTranslation(f[3] || "");
  if (!t) continue; // 没中文释义的条目对学生没用

  const prev = entries.get(lower);
  // 同词多条时保留释义更全的那条
  if (prev && prev.t.length >= t.length) continue;
  entries.set(lower, { p: (f[1] || "").trim(), t, g: pickTag(tag), ex: exForms });
}

console.log(`收录词条: ${entries.size}  (题库 ${reason.bank} / 考试标签 ${reason.tag} / 高频 ${reason.frq})`);

// ── 4. 并入屈折变形 ─────────────────────────────────────────────────────────
const shardOf = (w) => (w[0] >= "a" && w[0] <= "z" ? w[0] : "_");
const shards = {};
const put = (key, val) => {
  const s = shardOf(key);
  (shards[s] = shards[s] || {})[key] = val;
};

for (const [word, e] of entries) put(word, { p: e.p, t: e.t, g: e.g });

let alias = 0;
let inlined = 0;
for (const [word, e] of entries) {
  for (const form of e.ex) {
    if (entries.has(form)) continue; // 变形自己就是独立词条，别覆盖
    const s = shardOf(form);
    if (shards[s] && shards[s][form]) continue; // 已被别的词占了（先到先得）
    if (s === shardOf(word)) { put(form, word); alias += 1; }          // 同片：存指针
    else { put(form, { p: e.p, t: e.t, g: e.g, w: word }); inlined += 1; } // 跨片：内联
  }
}
console.log(`变形并入: 同片别名 ${alias} / 跨片内联 ${inlined}`);

// ── 5. 写出 ─────────────────────────────────────────────────────────────────
const sizes = Object.entries(shards)
  .map(([k, v]) => [k, Object.keys(v).length, JSON.stringify(v).length])
  .sort((a, b) => b[2] - a[2]);
const total = sizes.reduce((s, x) => s + x[2], 0);
console.log(`分片: ${sizes.length} 个，合计 ${(total / 1e6).toFixed(2)} MB`);
console.log(`最大三片: ${sizes.slice(0, 3).map(([k, n, b]) => `${k}=${(b / 1e3).toFixed(0)}KB/${n}词`).join("  ")}`);

if (STATS_ONLY) {
  console.log("（--stats：未写文件）");
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [letter, table] of Object.entries(shards)) {
  fs.writeFileSync(path.join(OUT, `${letter}.json`), JSON.stringify(table));
}
fs.writeFileSync(
  path.join(OUT, "META.json"),
  JSON.stringify({
    source: "ECDICT (github.com/skywind3000/ECDICT)",
    builtAt: new Date().toISOString().slice(0, 10),
    entries: entries.size,
    forms: sizes.reduce((s, x) => s + x[1], 0),
    frqTop: FRQ_TOP,
  }, null, 2)
);
console.log(`已写入 ${OUT}/`);
