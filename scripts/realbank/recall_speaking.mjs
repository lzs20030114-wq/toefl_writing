#!/usr/bin/env node
/**
 * 口语补录：把真题 ground truth（data/realExam2026/speaking/）里库里没有的那些卷收进来。
 *
 * 为什么有料可补：库里 32 套面试、30 套复述**全部来自 rf* / rp* 第二来源**，
 * 1–5 月的数字卷（1.21A/B/C、1.27A/B、1.28A/B、2.1A/B/C、2.2、2.10、2.28、3.14）一套面试都没有；
 * 而 GT 里按卷逐题转写着 14 套面试 + 13 套复述。与邮件 / 讨论走的是同一条路
 * （data/realBank/writing-recall.json，scripts/realbank/writing_recall.js）。
 *
 * ── 复述：零 token ──
 * GT 的 sentences 本来就是逐句列表，形状与库里一致，直接映射。
 *
 * ── 面试：要一次语义判断，但**模型碰不到一个字** ──
 * GT 的 questions 是 ASR 逐句，主问与追问被拆成了两条：
 *     "First, how often do you listen to music?" / "Do you listen daily, weekly or less often?"
 * 而真题面试是 4 题（validator：<3 报错，3 以上只 warn）。所以要把逐句合回 3~4 题。
 * 两两合并不成立 —— 实测每套 3/5/6/7/8/9 条不等，1.27A 的第 2 条就不是第 1 条的追问。
 * 于是：**模型只输出分组边界（下标），题面文本由代码按边界拼接原句**，再过一道机械校验：
 *   · 分组必须覆盖 1..N 每条恰好一次、不重叠、保持原序；
 *   · 组数 3~4；
 *   · 拼出来的每一题必须逐字等于原句按序用空格连起来（代码自己拼的，等于是同义反复 ——
 *     真正的作用是把「模型返回的下标」以外的一切可能性堵死：它没有任何产出文本的口子）。
 * 校验不过的整套记 verdict=review，不进库，等人看原卷。
 *
 * 用法：
 *   node scripts/realbank/recall_speaking.mjs --dry        # 报将调用几次 / 预计费用，不调 API
 *   node scripts/realbank/recall_speaking.mjs --repeat-only # 只做复述（零 token）
 *   node scripts/realbank/recall_speaking.mjs              # 全做，落 data/realBank/speaking-recall.json
 *
 * 产物给 build_bank 读（只收 verdict=ok 的），本脚本不碰 data/realBank/speaking/*.json。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../../lib/ai/deepseekHttp");

const ROOT = process.cwd();
const GT_DIR = path.join(ROOT, "data", "realExam2026", "speaking");
const BANK_DIR = path.join(ROOT, "data", "realBank", "speaking");
const OUT = path.join(ROOT, "data", "realBank", "speaking-recall.json");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const REPEAT_ONLY = argv.includes("--repeat-only");
const MODEL = "deepseek-chat";

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const gtItems = (f) => { const j = readJson(path.join(GT_DIR, f), []); return Array.isArray(j) ? j : (j.items || []); };
const bankSources = (f) => new Set((readJson(path.join(BANK_DIR, f), { items: [] }).items || [])
  .map((x) => String(x.source || "").trim()).filter(Boolean));

const SPLIT_PROMPT = `你在整理托福口语「面试题」的录音逐字稿。

输入是一场面试里考官说的**逐句**（ASR 切句），其中一道题常被切成「主问 + 追问」两句甚至更多。
真实考试这一题型是 4 道题（偶尔 3 道）。请把这些句子**按原顺序**合并回 3~4 道题。

只输出 JSON，形如：{"groups": [[1,2],[3],[4,5],[6,7]]}
· 数字是输入句子的序号（从 1 开始）；
· 必须覆盖每一句恰好一次，不许重排、不许跳过、不许拆句；
· 组数只能是 3 或 4；
· 不要输出任何题面文本 —— 你只决定边界。`;

/** 分组的机械校验：覆盖全、不重叠、保原序、组数 3~4。不过就整套作废。 */
function checkGroups(groups, n) {
  if (!Array.isArray(groups) || groups.length < 3 || groups.length > 4) return `组数 ${groups?.length} 不在 3~4`;
  const flat = groups.flat();
  if (flat.length !== n) return `覆盖 ${flat.length} 条，应为 ${n} 条`;
  for (let i = 0; i < n; i += 1) if (flat[i] !== i + 1) return `第 ${i + 1} 位是 ${flat[i]}，顺序/覆盖不对`;
  if (groups.some((g) => !Array.isArray(g) || g.length === 0)) return "有空组";
  return null;
}

async function splitInterview(qs) {
  const raw = await callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 90000,
    payload: {
      model: MODEL, temperature: 0, max_tokens: 500, stream: false,
      messages: [
        { role: "system", content: SPLIT_PROMPT },
        { role: "user", content: qs.map((q, i) => `${i + 1}. ${q}`).join("\n") },
      ],
    },
  });
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return { groups: null, why: "模型没给出 JSON" };
  try {
    const groups = (JSON.parse(m[0]).groups || []).map((g) => (Array.isArray(g) ? g.map(Number) : []));
    const why = checkGroups(groups, qs.length);
    return why ? { groups: null, why } : { groups, why: null };
  } catch (e) {
    return { groups: null, why: `JSON 解析失败：${String(e.message || e).slice(0, 60)}` };
  }
}

const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/**
 * 本机跑要靠 .env.local 里的 DEEPSEEK_API_KEY —— 与 audit_answers / structure_set /
 * render_real_audio 同一份读法。少了它，面试那半边一开口就 "Missing DEEPSEEK_API_KEY"，
 * 而复述那半边（零 token）已经算完却还没落盘，等于整条命令白跑。
 */
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

async function main() {
  loadEnv();
  const prev = readJson(OUT, {});
  const out = { interview: { ...(prev.interview || {}) }, repeat: { ...(prev.repeat || {}) } };

  /* ── 复述（零 token）── */
  const haveRepeat = bankSources("repeat.json");
  const rNew = gtItems("repeat-from-audio.json").filter((x) => x.source && !haveRepeat.has(String(x.source).trim()));
  // GT 有 4 套没转写到情境说明（只有句子）。管线自己在 context 为空时就用这句通用说明兜底
  // （build_bank 里同一串字），所以缺 setting 不算缺陷 —— 照同一口径兜，别把好料判成 review。
  const REPEAT_FALLBACK_SCENARIO =
    "You will hear a series of short instructions. Listen carefully and repeat each sentence exactly as you hear it.";
  for (const x of rNew) {
    const sentences = (x.sentences || []).map((s) => String(s || "").trim()).filter(Boolean);
    const problems = [];
    if (sentences.length < 5) problems.push(`句数 ${sentences.length} < 5`);
    out.repeat[x.source] = {
      content: { scenario: String(x.setting || "").trim() || REPEAT_FALLBACK_SCENARIO, sentences },
      provenance: { gt_id: x.id, date: x.date, source_kind: x.source_kind || "" },
      verdict: problems.length ? "review" : "ok",
      problems,
    };
  }

  /* ── 面试（每套一次调用，只取分组边界）── */
  const haveInterview = bankSources("interview.json");
  const iNew = gtItems("interview.json").filter((x) => x.source && !haveInterview.has(String(x.source).trim()));
  const todo = REPEAT_ONLY ? [] : iNew.filter((x) => !(prev.interview?.[x.source]?.locked));

  console.log(`复述：GT ${gtItems("repeat-from-audio.json").length} 套，库里没有的 ${rNew.length} 套（零 token）`);
  console.log(`面试：GT ${gtItems("interview.json").length} 套，库里没有的 ${iNew.length} 套 → 待调用 ${todo.length} 次`
    + `（约 ¥${(todo.length * 0.004).toFixed(3)}，每次几百 token）`);
  if (DRY) { console.log("（--dry，未调 API、未写文件）"); return; }

  // 复述那半边是零 token 算完的，面试半边一旦系统性失败（缺 key / 401 / 代理坏了）就整条
  // 命令抛栈退出 —— 白算一遍还不落盘。改成：记下失败原因、停掉剩余调用，照样把已有结果写盘。
  let apiDown = null;
  for (const x of todo) {
    if (apiDown) break;
    const qs = (x.questions || []).map((q) => String(q || "").trim()).filter(Boolean);
    let entry;
    if (qs.length < 3) {
      entry = { verdict: "review", problems: [`GT 只有 ${qs.length} 句，合不出 3 题`] };
    } else {
      let groups = null;
      let why = "";
      try {
        ({ groups, why } = await splitInterview(qs));
      } catch (e) {
        apiDown = e && e.message ? e.message : String(e);
        break;
      }
      if (!groups) {
        entry = { verdict: "review", problems: [`分组不过机械校验：${why}`] };
      } else {
        // 题面由**代码**按边界拼原句，模型没有产出文本的口子
        const questions = groups.map((g, i) => {
          const text = g.map((n) => qs[n - 1]).join(" ");
          return { position: `Q${i + 1}`, question: text, difficulty: "personal", word_count: words(text) };
        });
        const problems = questions.filter((q) => !/\?/.test(q.question)).map((q) => `${q.position} 不含问号`);
        entry = {
          content: { intro: String(x.setting || "").trim(), topic: "", questions },
          verdict: problems.length ? "review" : "ok",
          problems,
        };
      }
    }
    out.interview[x.source] = { ...entry, provenance: { gt_id: x.id, date: x.date, source_kind: x.source_kind || "" } };
    console.log(`  ${x.source}: ${qs.length} 句 → ${out.interview[x.source].content?.questions?.length ?? "-"} 题 · ${out.interview[x.source].verdict}`
      + (out.interview[x.source].problems?.length ? ` （${out.interview[x.source].problems.join("；")}）` : ""));
  }

  fs.writeFileSync(OUT, JSON.stringify({
    _purpose: "口语补录账本：真题 GT（data/realExam2026/speaking/）里库里没有的那些卷。build_bank 只收 verdict=ok 的。",
    _generated_by: "scripts/realbank/recall_speaking.mjs",
    _how_to_edit: '改了内容就加 "locked": true（重跑不覆盖）；verdict=review 的条目人看过原卷再改成 ok。判据见脚本头注。',
    ...out,
  }, null, 2), "utf8");
  const okI = Object.values(out.interview).filter((v) => v.verdict === "ok").length;
  const okR = Object.values(out.repeat).filter((v) => v.verdict === "ok").length;
  console.log(`\n→ ${path.relative(ROOT, OUT)}：面试 ${okI}/${Object.keys(out.interview).length} 套 ok，复述 ${okR}/${Object.keys(out.repeat).length} 套 ok`);
  if (apiDown) {
    console.error(`\n⚠ 面试那半边没跑完：${apiDown}`);
    console.error("  复述的结果已经落盘（零 token，不用重跑）。把 DEEPSEEK_API_KEY 放进 .env.local 再跑一次，只补面试。");
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
