#!/usr/bin/env node
/**
 * 对照实验：听力盲审的低一致率，是数据错，还是我把材料稀释了？
 *
 * 上一轮盲审给听力题的材料是**整段** ASR 转写（5000+ 字，全套卷的音频拼在一起）。
 * 这么做是为了绕开"哪段音频属于哪道题"这个未验证的假设，但代价是模型要在一大堆
 * 无关内容里自己找依据——找不到就等于瞎猜，一致率自然低。
 *
 * 所以「听力 40%」可能有两个完全不同的原因：
 *   H1 数据真的错了（选项串栏、答案错位）        → 听力不能上线
 *   H2 只是我的审法把材料稀释了                  → 听力其实没问题，是我的工具在冤枉它
 *
 * 本脚本用同一批题跑 A/B：
 *   A 全文语境 —— 整段转写（复刻上一轮）
 *   B 定位语境 —— 只给最相关的**一个**音频片段
 *              LCR 按顺序绑（第 i 道 LCR ↔ 第 i 个 lcr 片段）
 *              其余按 stem+options 与片段正文的词面重合度选最高的
 *
 * 若 B 显著高于 A → H2 成立，上一轮的结论要推翻。
 * 若 B 与 A 相当  → H1 成立，听力确实有问题。
 *
 * 用法: node scripts/realbank/audit_context_ablation.mjs "3.10新托福真题"
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../lib/ai/deepseekHttp");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const MODEL = "deepseek-v4-flash";
const CONCURRENCY = 4;
const LETTERS = "ABCDEFGH";

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(process.cwd(), p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 环境变量兜底 */ }
  }
}

const SOLVE_PROMPT = `你是 TOEFL 考生。读材料、答题、选一个最佳选项。
只输出 JSON：{"answer":"A"}（字母之一），不要解释、不要 markdown。
材料里没有依据就选你认为最可能的那个，不要拒答。`;

async function solve(material, item) {
  const opts = item.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n");
  const user = [`【听力材料】\n${material}`, `【题目】\n${item.stem}`, `【选项】\n${opts}`].join("\n\n");
  const raw = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY, proxyUrl: resolveProxyUrl(), timeoutMs: 90000,
    payload: {
      model: MODEL, temperature: 0, max_tokens: 8000, stream: false,
      messages: [{ role: "system", content: SOLVE_PROMPT }, { role: "user", content: user }],
    },
  });
  const m = String(raw || "").match(/"answer"\s*:\s*"([A-H])"/i) || String(raw || "").match(/\b([A-H])\b/);
  return m ? m[1].toUpperCase() : null;
}

const words = (s) => new Set(String(s || "").toLowerCase().match(/[a-z']{3,}/g) || []);
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size);
}

async function runPool(items, worker, concurrency, label) {
  const out = new Array(items.length);
  let cursor = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await worker(items[i]); } catch { out[i] = null; }
      done += 1;
      process.stdout.write(`\r  ${label} ${done}/${items.length}   `);
    }
  }));
  process.stdout.write("\n");
  return out;
}

async function main() {
  loadEnv();
  const setname = process.argv[2];
  if (!setname) { console.error("用法: node scripts/realbank/audit_context_ablation.mjs <卷名>"); process.exit(2); }

  const st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${setname}.structured.json`), "utf8"));
  const man = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "audio", setname, "listening", "_manifest.json"), "utf8"));
  const units = man.units || [];
  const lcrUnits = units.filter((u) => u.kind === "lcr");
  const passageUnits = units.filter((u) => u.kind === "passage");
  const fullText = units.map((u, i) => `[音频片段 ${i + 1} · ${u.type}]\n${u.text}`).join("\n\n");

  // 收集听力题，按题号排序（LCR 顺序绑定要靠这个顺序）
  const items = [];
  for (const r of st.results) {
    if (r.section !== "listening" || r.status !== "ok") continue;
    for (const it of r.items || []) {
      if (!Array.isArray(it.options) || typeof it.answer_index !== "number") continue;
      items.push({ module: r.module, type: r.type, q: it.q_number ?? 9999, item: it });
    }
  }
  items.sort((a, b) => a.module - b.module || a.q - b.q);

  // B 组语境：LCR 按出现顺序绑，其余按词面重合度选一个片段
  let lcrSeen = 0;
  for (const rec of items) {
    const isLcr = rec.type === "lcr" || /choose the best response/i.test(rec.item.stem || "");
    if (isLcr && rec.module === 1 && lcrSeen < lcrUnits.length) {
      rec.focus = lcrUnits[lcrSeen].text;
      rec.focusHow = `按顺序绑第 ${lcrSeen + 1} 个 lcr 片段`;
      lcrSeen += 1;
      continue;
    }
    const probe = `${rec.item.stem} ${rec.item.options.join(" ")}`;
    let best = { score: -1, text: "", i: -1 };
    passageUnits.forEach((u, i) => {
      const s = overlap(probe, u.text);
      if (s > best.score) best = { score: s, text: u.text, i };
    });
    rec.focus = best.text;
    rec.focusHow = `词面重合最高的段落片段 #${best.i + 1}（重合 ${(best.score * 100).toFixed(0)}%）`;
  }

  console.log(`■ ${setname} 听力语境对照`);
  console.log(`听力题 ${items.length} 道；音频片段 ${units.length}（lcr ${lcrUnits.length}，成段 ${passageUnits.length}）`);
  console.log(`A 组材料 = 整段转写 ${fullText.length} 字；B 组材料 = 单个片段（平均 ${Math.round(items.reduce((n, r) => n + r.focus.length, 0) / items.length)} 字）\n`);

  const pickA = await runPool(items, (r) => solve(fullText, r.item), CONCURRENCY, "A 全文语境");
  const pickB = await runPool(items, (r) => solve(r.focus, r.item), CONCURRENCY, "B 定位语境");

  let a = 0, b = 0, flipped = [];
  items.forEach((rec, i) => {
    const want = LETTERS[rec.item.answer_index];
    const okA = pickA[i] === want, okB = pickB[i] === want;
    if (okA) a += 1;
    if (okB) b += 1;
    if (okA !== okB) flipped.push({ rec, want, A: pickA[i], B: pickB[i], gained: okB });
  });
  const pct = (n) => `${n}/${items.length} = ${(n / items.length * 100).toFixed(1)}%`;
  console.log(`\nA 全文语境  ${pct(a)}`);
  console.log(`B 定位语境  ${pct(b)}`);
  console.log(`\n判定: ${b - a >= 5 ? "B 显著高于 A → H2 成立，低一致率是我的审法造成的，上一轮结论要推翻"
    : b - a <= -5 ? "B 显著低于 A → 定位绑错了，绑定逻辑有问题"
      : "两者相当 → H1 成立，听力数据本身确实有问题"}`);
  if (flipped.length) {
    console.log(`\n-- 结论翻转的 ${flipped.length} 题 --`);
    for (const f of flipped.slice(0, 10)) {
      console.log(`  Q${f.rec.q}(m${f.rec.module},${f.rec.type}) 答案=${f.want} A选${f.A} B选${f.B} ` +
        `${f.gained ? "定位后答对✓" : "定位后答错✗"}  [${f.rec.focusHow}]`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `${setname}.ablation.json`), JSON.stringify({
    set: setname, total: items.length, agreeFull: a, agreeFocused: b,
    rows: items.map((rec, i) => ({
      q: rec.q, module: rec.module, type: rec.type, stem: rec.item.stem,
      answer: LETTERS[rec.item.answer_index], A: pickA[i], B: pickB[i], focusHow: rec.focusHow,
    })),
  }, null, 2), "utf8");
}

main().catch((e) => { console.error(e); process.exit(1); });
