#!/usr/bin/env node
/**
 * 真题录入 —— 盲审（第二票）。
 *
 * 回答的是这个问题：**盖上去的答案，真的挂在对的题上吗？**
 *
 * 结构化阶段的校验器只查得了「结构对不对」（选项数、有没有重复、有没有混中文），
 * 查不了「答案有没有错位」——模型如果把选项顺序重排了，答案 key 指的第 3 个选项
 * 就不是原来那个，所有结构校验照样全绿。
 *
 * 唯一能查的办法是让另一个模型**不看答案**自己做一遍，再跟盖上的答案比。
 * 选项顺序若被改过，它必然选到别处去。这跟 scripts/audit/run-l1.mjs 对生成题库
 * 做的事是同一个套路，只是对象换成真题。
 *
 * 一致 ≠ 正确（模型也会做错题），但**不一致必须人看**。所以产出是一份复核清单，
 * 不是一个通过/不通过的判决。
 *
 * 材料来源两种：阅读题的材料在屏幕上，直接用；听力题的材料在音频里，用该科**整段**
 * ASR 转写顶上。两者都没有的才计入 skipped——不许拿审不了的题充数。
 *
 * 用法: node scripts/realbank/audit_answers.mjs "3.10新托福真题"
 *
 * 退出码：0 正常（含「无可审题目」）；2 用法/输入缺失；3 系统性 API 失败（run_pipeline 见 3 即整批停）。
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
// 专用退出码：3 = 系统性 API 失败。与 2（用法/输入缺失）区分，run_pipeline 见 3 就整批停下。
const EXIT_SYSTEMIC = 3;
// 没有可审题目时打印的固定文案：run_pipeline 靠它把「审了但一致率低」和「压根没审成」分开。
const NO_RESULT_TAG = "盲审无结果";

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

/**
 * 系统性 API 失败识别（与 structure_set.mjs 里的同一份判据，两个脚本互不 import 故各留一份）。
 *
 * 「继续跑下去只会得到同样的失败」的那几类：HTTP 401/402/403/407/429、缺 key、代理配置错误、
 * 连接错误与超时。单块 5xx 不算（deepseekHttp 内部已重试一次，零星 5xx 更像抖动）。
 * 返回 null = 普通失败，照旧记进 nulls 继续。
 */
function classifySystemicFailure(err) {
  const text = String(err?.message || err || "");
  const blob = `${text} ${String(err?.code || "")}`;
  const m = text.match(/DeepSeek\s+(\d{3})\b/) || text.match(/proxy CONNECT failed:\s*(\d{3})/i);
  const httpStatus = m ? Number(m[1]) : null;
  const apiMessage = (text.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || "";
  const hit = (reason) => ({ httpStatus, apiMessage, reason, text });
  if (httpStatus && [401, 402, 403, 407, 429].includes(httpStatus)) return hit("鉴权/余额/权限/限流");
  if (/Missing DEEPSEEK_API_KEY/i.test(text)) return hit("没有 API key");
  if (/Insufficient Balance|insufficient[_ ]quota|Authentication Fails|invalid[_ ]api[_ ]key/i.test(text)) return hit("余额或鉴权");
  if (/timeout/i.test(text)) return hit("请求超时");
  if (/socket hang up|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ECONNABORTED|ENETUNREACH/i.test(blob)) return hit("连接错误");
  if (/SOCKS proxy is not supported|Unsupported proxy schema|not a valid HTTP proxy/i.test(text)) return hit("代理配置错误");
  return null;
}

let systemicFailure = null;

/** 有系统性失败就打印原因并中止：不写 .audit.json，免得空结果盖掉上一次的复核清单。 */
function abortIfSystemic() {
  if (!systemicFailure) return;
  const { httpStatus, apiMessage, reason, text } = systemicFailure;
  console.error(`\n[中止] 系统性 API 失败（${reason}）：`
    + `${httpStatus ? `HTTP ${httpStatus}` : "无状态码"}`
    + `${apiMessage ? ` · API 返回「${apiMessage}」` : ""}`);
  console.error(`  原始错误：${text.slice(0, 300)}`);
  console.error(`  已中止本卷盲审，**未写出** .audit.json —— 避免用空结果覆盖上一次的复核清单。`);
  process.exit(EXIT_SYSTEMIC);
}

const SOLVE_PROMPT = `你是 TOEFL 考生。读材料、答题、选一个最佳选项。
只输出 JSON：{"answer":"A"}（字母之一），不要解释、不要 markdown。
材料里没有依据就选你认为最可能的那个，不要拒答。`;

async function solve(rec) {
  // 测试钩子，只用于验证守卫：REALBANK_FAKE_API_ERROR=402 让每次调用都抛该状态码的 API 错误。
  if (process.env.REALBANK_FAKE_API_ERROR) {
    throw new Error(`DeepSeek ${process.env.REALBANK_FAKE_API_ERROR}: `
      + `{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}`);
  }
  // 测试钩子：REALBANK_FAKE_AUDIT_PICK=A 让每题都返回该字母、不发网络请求（验证一代备份）。
  if (process.env.REALBANK_FAKE_AUDIT_PICK) return String(process.env.REALBANK_FAKE_AUDIT_PICK).toUpperCase();
  const item = rec.item;
  const opts = item.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n");
  const material = String(rec.material || "").trim();
  const label = rec.materialSource === "音频转写"
    ? "【听力材料（整段音频转写，题目只涉及其中一部分，自己找）】"
    : (rec.materialSource === "音频转写(逐题)"
      ? "【听力材料（这道题所属那条音频的转写）】"
      : "【材料】");
  const user = [
    material ? `${label}\n${material}` : "",
    `【题目】\n${item.stem}`,
    `【选项】\n${opts}`,
  ].filter(Boolean).join("\n\n");
  const raw = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 90000,
    payload: {
      model: MODEL, temperature: 0, max_tokens: 8000, stream: false,
      messages: [{ role: "system", content: SOLVE_PROMPT }, { role: "user", content: user }],
    },
  });
  const m = String(raw || "").match(/"answer"\s*:\s*"([A-H])"/i) || String(raw || "").match(/\b([A-H])\b/);
  return m ? m[1].toUpperCase() : null;
}

async function runPool(items, worker, concurrency) {
  const out = new Array(items.length);
  let cursor = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await worker(items[i]);
      } catch (e) {
        out[i] = { error: String(e?.message || e) };
        // 系统性失败（欠费/鉴权/断网…）：游标推到末尾不再派新活，在飞的等它自己结束。
        const sys = classifySystemicFailure(e);
        if (sys) { systemicFailure = systemicFailure || sys; cursor = items.length; }
      }
      done += 1;
      process.stdout.write(`\r  进度 ${done}/${items.length}   `);
    }
  }));
  process.stdout.write("\n");
  return out;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const setname = args.find((a) => !a.startsWith("--"));
  // --section=listening：只审这一科，其余科目沿用**上一次**的审计明细（不重跑、不覆盖）。
  // 听力是后补进来的（合流之后才有材料），阅读早就审完并已落库 —— 整卷重跑会让已上线的
  // 阅读题因为模型抖动被翻案，凭空产生一批 diff。所以按科增量审、结果合并。
  const onlySection = (args.find((a) => a.startsWith("--section=")) || "").split("=")[1] || null;
  if (!setname) { console.error("用法: node scripts/realbank/audit_answers.mjs <卷名> [--section=listening]"); process.exit(2); }
  const p = path.join(OUT_DIR, `${setname}.structured.json`);
  if (!fs.existsSync(p)) { console.error(`缺少结构化产物: ${p}`); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(p, "utf8"));

  // 听力题的材料在音频里 —— 把该科整段 ASR 转写当材料喂进去。
  //
  // 为什么给「整段」而不是「这道题对应的那一段」：那个对应关系（哪段音频属于哪道题）
  // 正是还没验证的东西，拿它当输入等于用未验证的假设去验证别的东西。给整段则不需要
  // 这个假设——模型自己在里面找依据。盲审和音频绑定就此解耦，先把答案正确性这个
  // 数字拿到手。代价只是上下文长一点。
  const transcripts = {};
  for (const sec of ["listening", "speaking"]) {
    const mp = path.join(OUT_DIR, "audio", setname, sec, "_manifest.json");
    if (!fs.existsSync(mp)) continue;
    const man = JSON.parse(fs.readFileSync(mp, "utf8"));
    transcripts[sec] = (man.units || [])
      .map((u, i) => `[音频片段 ${i + 1} · ${u.type}]\n${u.text}`)
      .join("\n\n");
  }
  for (const [sec, t] of Object.entries(transcripts)) {
    console.log(`已载入 ${sec} 音频转写 ${t.length} 字符（用作听力题的材料）`);
  }

  const auditable = [], skipped = [];
  for (const r of data.results) {
    if (r.status !== "ok") continue;
    if (onlySection && r.section !== onlySection) continue;
    for (const it of r.items || []) {
      if (!Array.isArray(it.options) || typeof it.answer_index !== "number") continue;
      const onScreen = String(it.material || "").trim();
      // 逐题转写优先：merge_vendor_asr.py 合流后，每道听力题上都带 transcript_final
      // （这道题对应的**那一条**音频的定稿文本）。它比整科整段转写短得多也准得多——
      // 模型不必在 3000 词里找依据，盲审信噪比高一截。没有它才退回整科整段。
      const perItem = String(it.transcript_final || "").trim();
      const fromAudio = (!perItem && onScreen.length < 40) ? (transcripts[r.section] || "") : "";
      const material = onScreen.length >= 40 ? onScreen : (perItem || fromAudio);
      const rec = {
        section: r.section, type: r.type, key: r.key, item: it,
        materialSource: onScreen.length >= 40 ? "屏幕"
          : (perItem ? "音频转写(逐题)" : (fromAudio ? "音频转写" : "无")),
        material,
      };
      if (!rec.material) skipped.push(rec); else auditable.push(rec);
    }
  }
  const bySrc = auditable.reduce((m, r) => { m[r.materialSource] = (m[r.materialSource] || 0) + 1; return m; }, {});
  console.log(`■ ${setname} 盲审`);
  console.log(`可审 ${auditable.length} 题（${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join("，")}）；`
    + `仍审不了 ${skipped.length} 题\n`);
  // 一道都审不了不是「审过且没问题」，是「没结果」——不写文件（写了就等于拿空清单
  // 盖掉上一次的复核清单），打一行固定文案让 run_pipeline 认出来。
  if (!auditable.length) {
    console.log(`${NO_RESULT_TAG}：没有可审题目（结构化产物里 status=ok 且带选项+答案下标的题为 0）`);
    return;
  }

  const picks = await runPool(auditable, (r) => solve(r), CONCURRENCY);
  abortIfSystemic();

  let agree = 0, disagree = [], nulls = 0;
  picks.forEach((pick, i) => {
    const r = auditable[i];
    const stamped = LETTERS[r.item.answer_index];
    if (!pick || typeof pick !== "string") { nulls += 1; return; }
    if (pick === stamped) agree += 1;
    else disagree.push({ ...r, model: pick, stamped });
  });
  const denom = auditable.length - nulls;
  // 一题都没审出结果（模型全没给答案 / 全部调用失败但没触发系统性判据）同样是「没结果」：
  // 不写文件，让 run_pipeline 记成 auditErr，而不是把 0/0 当成一次成功的盲审。
  if (denom === 0) {
    console.log(`${NO_RESULT_TAG}：${auditable.length} 题全部没拿到模型答案（调用失败或输出不可解析）`);
    return;
  }
  console.log(`\n一致 ${agree}/${denom} = ${denom ? (agree / denom * 100).toFixed(1) : 0}%  （模型没给出答案 ${nulls} 题）`);
  console.log("注：一致不等于正确，但**不一致的必须人看**。\n");
  if (disagree.length) {
    console.log(`-- 需人工复核 ${disagree.length} 题 --`);
    for (const d of disagree) {
      console.log(`\n[${d.section}/${d.type} Q${d.item.q_number}] 答案页=${d.stamped} 模型=${d.model} 材料来自${d.materialSource}`);
      console.log(`  ${String(d.item.stem).slice(0, 100)}`);
      d.item.options.forEach((o, i) => {
        const tag = [LETTERS[i] === d.stamped ? "答案页" : "", LETTERS[i] === d.model ? "模型" : ""].filter(Boolean).join("+");
        console.log(`    ${LETTERS[i]}. ${String(o).slice(0, 76)}${tag ? `   ←${tag}` : ""}`);
      });
    }
  }
  // `audited` 记录**每一道审过的题**（一致的也记），不只是不一致的那些。
  // 落库时的闸门需要区分「审过且一致」和「压根没审」——只给 disagree 列表的话，
  // 两者都表现为「不在列表里」，没审过的题会被当成通过悄悄放行。
  let audited = auditable.map((r, i) => ({
    section: r.section, type: r.type, q: r.item.q_number,
    stamped: LETTERS[r.item.answer_index], model: picks[i] || null,
    agree: picks[i] === LETTERS[r.item.answer_index],
    materialSource: r.materialSource,
  }));
  const outPath = path.join(OUT_DIR, `${setname}.audit.json`);
  const prevPath = path.join(OUT_DIR, `${setname}.audit.prev.json`);
  let carriedDisagree = [];
  if (onlySection && fs.existsSync(outPath)) {
    // 增量审：把**别的科目**上一次的明细原样带过来，只替换本科的。
    try {
      const old = JSON.parse(fs.readFileSync(outPath, "utf8"));
      const keep = (old.audited || []).filter((a) => a.section !== onlySection);
      carriedDisagree = (old.disagree || []).filter((d) => d.section !== onlySection);
      audited = keep.concat(audited);
      console.log(`增量审：沿用其他科目的旧明细 ${keep.length} 条`);
    } catch { /* 旧文件坏了就当没有 */ }
  }
  if (fs.existsSync(outPath)) {
    fs.copyFileSync(outPath, prevPath);   // 一代备份（只留一代，够回滚一次误跑）
    console.log(`已备份上一版 → ${prevPath}`);
  }
  fs.writeFileSync(outPath, JSON.stringify({
    set: setname, model: MODEL, auditable: auditable.length, skipped: skipped.length,
    agree, nulls, audited,
    disagree: carriedDisagree.concat(disagree.map((d) => ({
      section: d.section, type: d.type, q: d.item.q_number,
      stamped: d.stamped, model: d.model, stem: d.item.stem, options: d.item.options,
    }))),
  }, null, 2), "utf8");
  console.log(`\n复核清单 → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
