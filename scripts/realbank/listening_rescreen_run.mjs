#!/usr/bin/env node
/**
 * 听力「补抽」驱动（默认 --dry-run，只打表 + 报调用数与估价）。
 *
 * 判据与硬护栏见 scripts/realbank/listening_rescreen.js 的头注。这里只负责 IO 与那一次 DeepSeek 调用：
 * 每一屏单独发一次，system 提示词写死「只恢复空格、不许改词」，回来的东西过 transcriptionFaithful 机械验收。
 *
 *   node scripts/realbank/listening_rescreen_run.mjs "3.10新托福真题"            # dry：列屏 + 估价
 *   node scripts/realbank/listening_rescreen_run.mjs "3.10新托福真题" --write    # 真跑并写回 structured
 *   node scripts/realbank/listening_rescreen_run.mjs --all                        # 全库 dry 盘点
 *
 * 写盘前备份 `<卷>.structured.prev.json`。写完必须跟一句：
 *   node scripts/realbank/audit_answers.mjs "<卷>" --section=listening --only-missing
 * 补出来的题不免盲审 —— 不一致照旧不收。
 *
 * 退出码：0 正常；2 用法/输入缺失；3 系统性 API 失败。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../lib/ai/deepseekHttp");
const RS = require("./listening_rescreen.js");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const MODEL = "deepseek-v4-flash";
const CONCURRENCY = 4;
const EXIT_SYSTEMIC = 3;
// 估价：一屏进去 ~700 token、出来 ~200 token，按 ¥5.24/M 混合单价（同 CLAUDE.md 的成本护栏口径）。
const EST_PER_SCREEN = 900 * 5.24 / 1e6;

const PROMPT = `你在整理一张 TOEFL 听力选择题截图的 OCR 文本。OCR 把很多空格吃掉了。

只做两件事：
1. 把被吃掉的空格放回去、把被换行截断的词接上；
2. 分出「题干」和从上到下的 4 个选项。

严禁：改词、补词、删词、调换选项顺序、翻译、纠正拼写、加标点。
逐字保留原文，只动空格与换行。

只输出 JSON：{"stem":"...","options":["...","...","...","..."]}
这一屏若不是一道完整的四选一题（选项不足 4 个 / 只是材料），输出 {"ok":false}。`;

function loadEnv() {
  for (const p of [".env.local", ".env"]) {
    try {
      fs.readFileSync(path.join(process.cwd(), p), "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 靠进程环境变量 */ }
  }
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

/** 与 audit_answers.classifySystemicFailure 同一份判据（两个 CLI 互不 import，各留一份）。 */
function classifySystemic(err) {
  const text = String((err && err.message) || err || "");
  const m = text.match(/DeepSeek\s+(\d{3})\b/);
  const code = m ? Number(m[1]) : null;
  if (code && [401, 402, 403, 407, 429].includes(code)) return `HTTP ${code}`;
  if (/Missing DEEPSEEK_API_KEY/i.test(text)) return "没有 API key";
  if (/Insufficient Balance|Authentication Fails|invalid[_ ]api[_ ]key/i.test(text)) return "余额或鉴权";
  if (/timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(text)) return "连接错误/超时";
  return null;
}

let systemic = null;

async function transcribe(cand) {
  if (process.env.REALBANK_FAKE_RESCREEN) return JSON.parse(process.env.REALBANK_FAKE_RESCREEN);
  const raw = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 90000,
    payload: {
      // max_tokens 给足：deepseek-v4-flash 的推理 token 计进这个上限，给 1500 时实测
      // 6 屏里 3 屏被推理吃光、正文返回空串（同 memory: deepseek-reasoning-token-budget）。
      // 计费按实际输出，调高不多花钱。
      model: MODEL, temperature: 0, max_tokens: 8000, stream: false,
      messages: [{ role: "system", content: PROMPT }, { role: "user", content: cand.clean }],
    },
  });
  const text = String(raw || "");
  const body = (text.match(/\{[\s\S]*\}/) || [])[0];
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

async function runPool(items, worker) {
  const out = new Array(items.length);
  let cursor = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await worker(items[i]); } catch (e) {
        out[i] = null;
        const s = classifySystemic(e);
        if (s) { systemic = systemic || s; cursor = items.length; }
      }
      done += 1;
      process.stdout.write(`\r  进度 ${done}/${items.length}   `);
    }
  }));
  if (items.length) process.stdout.write("\n");
  return out;
}

function candidatesOf(setname) {
  const scan = readJson(path.join(OUT_DIR, `${setname}.json`));
  const structured = readJson(path.join(OUT_DIR, `${setname}.structured.json`));
  if (!scan || !structured) return null;
  return { scan, structured, cands: RS.candidateScreens({ scan, structured }) };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const all = args.includes("--all");
  const names = args.filter((a) => !a.startsWith("--"));
  let sets = names;
  if (all) {
    sets = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json"))
      .map((f) => f.replace(/\.structured\.json$/, "")).sort();
  }
  if (!sets.length) {
    console.error('用法: node scripts/realbank/listening_rescreen_run.mjs "<卷名>" [--write] | --all');
    process.exit(2);
  }
  if (all && write) { console.error("--all 只做 dry 盘点，不允许同时 --write"); process.exit(2); }

  let total = 0;
  const rows = [];
  for (const setname of sets) {
    const ctx = candidatesOf(setname);
    if (!ctx) { if (!all) { console.error(`缺少产物: ${setname}`); process.exit(2); } continue; }
    const { cands } = ctx;
    total += cands.length;
    if (all) { if (cands.length) rows.push({ set: setname, n: cands.length, types: cands.map((c) => c.type) }); continue; }

    console.log(`\n■ ${setname}：可补抽 ${cands.length} 屏`
      + (cands.length ? `（${cands.map((c) => `M${c.module}Q${c.q}/${c.type}`).join(" ")}）` : ""));
    if (!cands.length) continue;
    console.log(`  预估：DeepSeek 调用 ${cands.length} 次 · ≈¥${(cands.length * EST_PER_SCREEN).toFixed(3)}`);
    if (!write) { console.log("  （--dry-run：没有调用、没有写盘。加 --write 真跑）"); continue; }

    const txs = await runPool(cands, transcribe);
    if (systemic) {
      console.error(`\n[中止] 系统性 API 失败（${systemic}）—— 未写盘`);
      process.exit(EXIT_SYSTEMIC);
    }
    const results = cands.map((c, i) => {
      const tx = txs[i];
      if (!tx || tx.ok === false) return { ...c, ok: false, why: tx ? "模型判这一屏不是完整四选一题" : "模型没返回可解析的 JSON" };
      const built = RS.buildRescreenItem(c, tx);
      return { ...c, ...built };
    });
    for (const r of results) {
      console.log(`   M${r.module} Q${r.q} [${r.type}] ${r.ok ? `✔ ${String(r.item.stem).slice(0, 60)}  答案=${r.item.answer_key.toUpperCase()}` : `✗ ${r.why}`}`);
    }
    const okN = results.filter((r) => r.ok).length;
    const p = path.join(OUT_DIR, `${setname}.structured.json`);
    fs.copyFileSync(p, path.join(OUT_DIR, `${setname}.structured.prev.json`));
    const added = RS.applyRescreen(ctx.structured, results);
    fs.writeFileSync(p, JSON.stringify(ctx.structured, null, 2), "utf8");
    console.log(`  ✔ 解析成功 ${okN}/${cands.length}，写回 ${added} 条`);
    console.log(`    下一步：node scripts/realbank/audit_answers.mjs "${setname}" --section=listening --only-missing`);
  }

  if (all) {
    rows.sort((a, b) => b.n - a.n);
    console.log("\n卷 | 可补抽屏 | 题型");
    for (const r of rows) {
      const t = r.types.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});
      console.log(`${r.set} | ${r.n} | ${Object.entries(t).map(([k, v]) => `${k}${v}`).join(" ")}`);
    }
    console.log(`\n合计 ${total} 屏 / ${rows.length} 套 · 全铺预估 DeepSeek 调用 ${total} 次 · ≈¥${(total * EST_PER_SCREEN).toFixed(2)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
