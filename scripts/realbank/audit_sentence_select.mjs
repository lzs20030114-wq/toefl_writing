#!/usr/bin/env node
/**
 * 真题「点选句子」题盲审 —— 上线前的最后一票。
 *
 * 回答的问题：**答案页给的开头词，在用户实际看到的那段文字里，真的指向题干要的那一句吗？**
 * 做法与 audit_answers.mjs 同口径（不改那个脚本）：另一个模型不看答案，读文章、看题干，从第 N 段的
 * 逐句清单里自己挑一句；挑的与答案页定的是同一句 = 一致。第一票 deepseek-v4-flash，不一致再用
 * deepseek-v4-pro 补第二票；第一票一致，或第二票一致，才算通过（hold_policy.auditPassed 同口径）。
 *
 * 结论只对「题干 + 该段文字」有效：记录带着 sentence_select.auditHash(题干, 段落原文)，写回
 * data/realBank/reading/sentence-select.json 的 audits。build_bank 落盘后按哈希核：文字变了（重新 OCR、
 * 复核 patch、跨卷合并换了代表）哈希就对不上，这道题先摘下来，等本脚本重审。
 *
 * 审的是**最终成品**（data/realBank/reading/ap.json + id-aliases.json）：先在成品里找宿主 ——
 * 同卷同 module 同学术题号带的 AP 条目；原条目被跨卷合并掉了就顺着 id 别名账本找到代表那份 ——
 * 再按账本在宿主第 N 段上组题，对着这段文字审。默认只审「哈希没有通过记录」的（--force 全审）。
 *
 * 流程：建库（选句题会因为没审过被摘下）→ 本脚本 → 再建库（哈希对上，上线）。
 *
 * 成本护栏：--dry-run 打印「将调用 N 次 / 预计 ¥X」；--max-calls 默认 40，超了须 --yes。
 * 调用走 lib/ai/deepseekHttp，自动记 .ops/deepseek-usage.jsonl。
 *
 * 审哪些：默认读建库留下的 data/realBank/reading/sentence-select.pending.json（落盘闸摘下的 + 跨卷合并时
 * 代表那段没审过、没搬过来的），只审其中哈希没有通过记录的 —— 那就是建库真正要放题的位置。
 * 没有这份清单（或加 --resolve）时，才按账本在成品里自己找宿主（同卷同 module 同题号带 / 顺着别名账本）。
 *
 * 用法:
 *   node scripts/realbank/audit_sentence_select.mjs --dry-run
 *   node scripts/realbank/audit_sentence_select.mjs [--env-file D:/toefl_writing/.env.local] [--force] [--resolve]
 *
 * 退出码：0 正常；2 用法/输入缺失；3 系统性 API 失败（鉴权/余额/网络，不写账本）。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../lib/ai/deepseekHttp");
const { cnyPerMtok } = require("../../lib/ai/usageLedger");
const SS = require("./sentence_select.js");

const ROOT = process.cwd();
const BANK = path.join(ROOT, "data", "realBank", "reading");
const LEDGER = path.join(BANK, "sentence-select.json");
const FIRST_MODEL = "deepseek-v4-flash";
const SECOND_MODEL = "deepseek-v4-pro";
const EXIT_SYSTEMIC = 3;

const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const argVal = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };

function loadEnv(file) {
  for (const p of [file, path.join(ROOT, ".env.local"), path.join(ROOT, ".env")].filter(Boolean)) {
    try {
      fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch { /* 靠进程环境变量 */ }
  }
}

/**
 * 成品里的宿主：先按同卷同 module 同题号带找原条目；找不到（被合并掉了）就顺着别名账本
 * 找「from 是这一卷这一带的 AP」且 to 活着的那条。候选不唯一就不猜。
 */
function resolveHost(apItems, aliases, entry) {
  const own = SS.findHost(apItems, entry);
  if (own.host) return { host: own.host, via: "own" };
  const band = SS.apBandOf(entry.module, entry.q_number);
  if (!band) return { error: "not_ap_band" };
  const byId = new Map(apItems.map((it) => [String(it.id), it]));
  const targets = new Set();
  for (const a of (aliases && aliases.aliases) || []) {
    if (!a || !a.to || a.to_type !== "ap") continue;
    const m = /^real_ap_(.+)_(\d+)_(\d+)$/.exec(String(a.from));
    if (!m || m[1] !== String(entry.slug) || Number(m[2]) !== Number(entry.module)) continue;
    const q = SS.normalizeQ(Number(m[3]), Number(m[2]));
    if (q == null || q < band[0] || q > band[1]) continue;
    if (byId.has(String(a.to))) targets.add(String(a.to));
  }
  if (targets.size === 1) return { host: byId.get([...targets][0]), via: "alias" };
  return { error: targets.size ? "host_ambiguous" : own.error };
}

const SOLVE_PROMPT = `你是 TOEFL 考生。读文章和题目，从指定段落的逐句清单里选出最符合题目要求的**一句**。
只输出 JSON：{"answer":"S2"}（S 加句子序号），不要解释、不要 markdown。
没有十足把握也要选你认为最可能的那一句，不要拒答。`;

function solvePrompt(host, q) {
  const paras = host.paragraphs || [];
  // 与建库同一口径数正文段：paragraphs[0] 像标题才算标题（近半数条目的 paragraphs[0] 就是第 1 段）
  const hasTitle = SS.looksLikeTitle(paras[0]);
  const passage = [
    ...(hasTitle ? [`【标题】${paras[0]}`] : []),
    ...paras.slice(hasTitle ? 1 : 0).map((p, i) => `【第 ${i + 1} 段】\n${p}`),
  ].join("\n\n");
  const list = Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join("\n");
  return `${passage}\n\n【题目】\n${q.stem}\n\n【第 ${q.paragraph} 段逐句】\n${list}`;
}

async function vote(host, q, model) {
  const raw = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    meta: { script: "audit_sentence_select", label: model },
    payload: {
      model, temperature: 0, max_tokens: 8000, stream: false,
      messages: [{ role: "system", content: SOLVE_PROMPT }, { role: "user", content: solvePrompt(host, q) }],
    },
  });
  const m = String(raw || "").match(/"answer"\s*:\s*"(S\d+)"/i) || String(raw || "").match(/\b(S\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

const isSystemic = (e) => /DeepSeek\s+(401|402|403|407|429)\b|Missing DEEPSEEK_API_KEY|Insufficient Balance|Authentication Fails|timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT/i
  .test(String(e && e.message || e));

async function main() {
  const dry = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const maxCalls = Number(argVal("--max-calls") || 40);
  const ledger = readJ(LEDGER);
  const apDoc = readJ(path.join(BANK, "ap.json"));
  if (!ledger || !apDoc) { console.error(`缺 ${LEDGER} 或 ap.json（先建库）`); process.exit(2); }
  const aliases = readJ(path.join(BANK, "id-aliases.json"));

  const plan = [];
  const skipped = [];
  const passed = (e, hash, sentence) => (e.audits || []).some((a) => a.hash === hash && a.expected_sentence === sentence
    && (a.agree === true || (a.second_vote && a.second_vote.agree === true)));
  const pendingDoc = process.argv.includes("--resolve") ? null : readJ(path.join(BANK, "sentence-select.pending.json"));

  if (pendingDoc && Array.isArray(pendingDoc.pending)) {
    // 默认：审建库留下的待审清单 —— 落盘闸摘下的 + 跨卷合并时代表段落没审过、没搬过来的。
    // 这就是建库真正要放题的位置；自己去猜宿主会审到根本不会放题的地方（白花钱）。
    const byId = new Map((apDoc.items || []).map((it) => [String(it.id), it]));
    const seen = new Set();
    for (const p of pendingDoc.pending) {
      const q = p && p.question;
      const host = q && byId.get(String(p.host));
      const tag = `${p && p.host}#${p && p.q_number}`;
      if (!host) { skipped.push({ key: tag, why: "host_gone" }); continue; }
      const text = Array.isArray(host.paragraphs) ? host.paragraphs[q.paragraph_index] : undefined;
      let cursor = 0;
      const intact = typeof text === "string" && Object.values(q.options || {})
        .every((v) => { const at = text.indexOf(v, cursor); if (at < 0) return false; cursor = at + v.length; return true; });
      if (!intact) { skipped.push({ key: tag, why: "structure_broken" }); continue; }
      const hash = SS.auditHash(q.stem, text);
      const expectedSentence = SS.correctSentenceOf(q);
      // 同一道题（题干 + 题号）可能对应账本里不止一条（两场考试同一道题，4.28#35 / 5.6v2#35）：审一次，记到每一条上
      const entries = (ledger.entries || []).filter((e) => SS.cleanStem(e.stem) === q.stem && Number(e.q_number) === Number(q.q_number));
      if (!entries.length) { skipped.push({ key: tag, why: "no_ledger_entry" }); continue; }
      if (seen.has(`${hash}|${expectedSentence}`)) continue;
      seen.add(`${hash}|${expectedSentence}`);
      if (!force && entries.some((e) => passed(e, hash, expectedSentence))) { skipped.push({ key: entries[0].key, why: "already_passed", host: host.id }); continue; }
      plan.push({ entries, entry: entries[0], host, via: p.why || "pending", q, hash, expectedSentence });
    }
  } else {
    // 没有待审清单（没建过库 / --resolve）：按账本在成品里自己找宿主
    for (const e of ledger.entries || []) {
      const h = resolveHost(apDoc.items || [], aliases, e);
      if (h.error) { skipped.push({ key: e.key, why: h.error }); continue; }
      const built = SS.buildSentenceQuestion(e, h.host);
      if (built.error) { skipped.push({ key: e.key, why: `unplaceable:${built.error}`, host: h.host.id }); continue; }
      const expectedSentence = SS.correctSentenceOf(built.question);
      if (passed(e, built.hash, expectedSentence) && !force) { skipped.push({ key: e.key, why: "already_passed", host: h.host.id }); continue; }
      plan.push({ entries: [e], entry: e, host: h.host, via: h.via, q: built.question, hash: built.hash, expectedSentence });
    }
  }
  // 审计记录里的 paragraph_index 记下「审的是哪一段」，人工排查哈希失配时能直接对上成品

  const estTokens = plan.reduce((n, p) => n + Math.ceil(solvePrompt(p.host, p.q).length / 3.5) + 400, 0);
  console.log(`■ 点选句子题盲审：账本 ${(ledger.entries || []).length} 道；要审 ${plan.length} 道（第一票 ${plan.length} 次，`
    + `不一致再补第二票）；预计 ≈${estTokens} tokens ≈ ¥${((estTokens * cnyPerMtok()) / 1e6).toFixed(3)}（第二票另计）`);
  for (const s of skipped) console.log(`  · 跳过 ${s.key}：${s.why}${s.host ? `（宿主 ${s.host}）` : ""}`);
  for (const p of plan) console.log(`  · 待审 ${p.entry.key} → ${p.host.id}（${p.via}）第 ${p.q.paragraph} 段 ${Object.keys(p.q.options).length} 句，答案页 = ${p.q.correct_answer}`);
  if (dry) { console.log("（--dry-run，未发请求、未写账本）"); return; }
  if (plan.length > maxCalls && !process.argv.includes("--yes")) {
    console.error(`[停] 将调用 ${plan.length} 次超过 --max-calls ${maxCalls}；确认要跑请加 --yes`);
    process.exit(2);
  }
  loadEnv(argVal("--env-file"));

  const today = new Date().toISOString().slice(0, 10);
  let agreed = 0, secondVotes = 0;
  for (const p of plan) {
    let picked, second = null;
    try {
      picked = await vote(p.host, p.q, FIRST_MODEL);
      if (picked !== p.q.correct_answer) {
        secondVotes += 1;
        const s = await vote(p.host, p.q, SECOND_MODEL);
        second = { picked: s, agree: s === p.q.correct_answer, model: SECOND_MODEL };
      }
    } catch (err) {
      if (isSystemic(err)) {
        console.error(`\n[中止] 系统性 API 失败：${String(err.message || err).slice(0, 300)}\n  账本未写（避免半截结果覆盖）。`);
        process.exit(EXIT_SYSTEMIC);
      }
      console.warn(`  × ${p.entry.key}：${String(err.message || err).slice(0, 160)}`);
      continue;
    }
    const rec = {
      hash: p.hash, host_id: p.host.id, paragraph: p.q.paragraph, paragraph_index: p.q.paragraph_index,
      expected: p.q.correct_answer, expected_sentence: p.expectedSentence,
      picked, agree: picked === p.q.correct_answer, model: FIRST_MODEL,
      second_vote: second, at: today,
    };
    for (const e of p.entries || [p.entry]) e.audits = [...(e.audits || []).filter((a) => a.hash !== p.hash), rec];
    const pass = rec.agree || (second && second.agree);
    if (pass) agreed += 1;
    console.log(`  ${pass ? "✓" : "✗"} ${(p.entries || [p.entry]).map((e) => e.key).join(" / ")} → ${p.host.id}  答案页 ${rec.expected}，第一票 ${picked}${second ? `，第二票 ${second.picked}` : ""}`);
  }
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  console.log(`\n通过 ${agreed}/${plan.length}（其中补了第二票 ${secondVotes} 次）→ ${path.relative(ROOT, LEDGER)}`);
  console.log("下一步：重建题库（build_bank.mjs），哈希对上的选句题才会上线。");
}

main();
