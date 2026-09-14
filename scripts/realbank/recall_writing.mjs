#!/usr/bin/env node
/**
 * 第一来源（截图卷）邮件 / 学术讨论补录账本 —— 生成 + 离线核对，零 token。
 *
 * 为什么有这一步、为什么不直接在 build_bank 里读 realExam2026：见 ./writing_recall.js 头注。
 * 一句话：内容在本机对着该卷 OCR 核过、结论写进 git（data/realBank/writing-recall.json），
 * build_bank 只认账本里 verdict=ok 的条目，云端重建不依赖 .codex-tmp 里的 OCR。
 *
 * 输入：
 *   data/realExam2026/writing/email.json               邮件（2026-05 校准时 OCR + DeepSeek 结构化）
 *   data/realExam2026/writing/academicDiscussion.json  讨论：课程 / 教授名 / 提问句 / 学生帖
 *   scripts/research/ad_eval/prof_posts_real.json      教授整段原话（逐字转写，按提问句认领到卷）
 *   --transcripts <json>（可给多次）                   对着原卷截图的转写 / 核对结果（覆盖上面两份；格式见 mergeTranscripts）
 *   .codex-tmp/ocr/<卷名>__*.txt                        核对用 OCR（有「写作」的只用写作那份）
 *
 * 产物：data/realBank/writing-recall.json
 *   email[卷名] / discussion[卷名] = { content, provenance, ocr, verdict: ok|review|reject, problems }
 *   · ok      过了结构闸 + OCR 覆盖率闸，build_bank 会收；
 *   · review  本机没有这卷的 OCR / 转写置信度低，要人看过再改成 ok；
 *   · reject  过不了闸（problems 里写着为什么）。
 *   人工改过的条目加 "locked": true，重跑时内容原样保留、只重算核对结论。
 *
 * 用法：
 *   node scripts/realbank/recall_writing.mjs --dry                       # 只报数
 *   node scripts/realbank/recall_writing.mjs --transcripts <results.json>
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const W = require("./writing_recall.js");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "realBank", "writing-recall.json");
const OCR_DIR = path.join(ROOT, ".codex-tmp", "ocr");

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

function ocrGluedFor(setname, listing) {
  const mine = listing.filter((n) => n.startsWith(`${setname}__`));
  const writing = mine.filter((n) => n.includes("写作"));
  const use = writing.length ? writing : mine;
  if (!use.length) return null;
  return W.glue(use.map((n) => fs.readFileSync(path.join(OCR_DIR, n), "utf8")).join("\n"));
}

/** prof_posts_real 按日期记、同一道题在不同日期只记一次 —— 所以按「提问句包含在原话里」认领，不按日期。 */
function postFor(question, posts) {
  const q = W.glue(question);
  if (q.length < 20) return null;
  return posts.find((p) => W.glue(p.text).includes(q.slice(0, Math.min(q.length, 80)))) || null;
}

/**
 * 对着原卷截图的转写 / 核对结果并进来（可以给多份，后给的覆盖先给的）。认两种形状：
 *   转写：{ set, kind: "discussion"|"email", present_in_source, confidence,
 *           discussion?: { course_line, professor:{name,text}, students:[{name,text}×2] },
 *           email?: { direction?, to, subject, scenario, goals[] } }
 *   核对：{ set, kind: "discussion"|"email"|"email_direction", confidence, verdict,
 *           verified: { discussion? | email? | email_direction?: { direction, to } } }
 * 归一成 `${kind}|${set}` → { email?, discussion?, direction?, confidence, pdf, pages }。
 * 置信度 low（比如只有 OCR 没有原图）一律 review，不自动放行。
 */
function mergeTranscripts(files) {
  const byKey = new Map();
  for (const file of files) {
    for (const t of file?.items || []) {
      if (!t || !t.set || t.present_in_source === false) continue;
      const v = t.verified || {};
      const pages = t.pages || (t.page != null ? [t.page] : []);
      const base = { confidence: t.confidence || "", pdf: t.pdf || "", pages };
      if (t.kind === "email_direction") {
        const d = v.email_direction || {};
        if (d.direction) byKey.set(`direction|${t.set}`, { ...base, direction: String(d.direction).trim() });
        continue;
      }
      const email = v.email || t.email;
      const discussion = v.discussion || t.discussion;
      // ocr_waiver：该卷 OCR 本身太差（手机斜拍、模糊）导致覆盖率闸误杀、而人已对着原图逐字核过 —— 必须写理由
      const waiver = String(t.ocr_waiver || "").trim();
      if (waiver) base.ocr_waiver = waiver;
      if (t.kind === "email" && email) byKey.set(`email|${t.set}`, { ...base, email });
      if (t.kind === "discussion" && discussion) byKey.set(`discussion|${t.set}`, { ...base, discussion });
    }
  }
  return byKey;
}

const screenshotProvenance = (t) =>
  `screenshot 2026-09-14 (${t.confidence || "?"}) ${t.pdf || ""} p${(t.pages || []).join("+") || "?"}`.replace(/\s+/g, " ").trim();

function verdictOf(problems, ocr, { lowConfidence, waiver } = {}) {
  if (problems.length) return "reject";
  if (!ocr) return "review";
  if (!ocr.ok && !waiver) return "reject";
  if (lowConfidence) return "review";
  return "ok";
}

/** 核对结论里的 OCR 那一段：豁免了就把理由挂在问题后面，谁看账本都知道这条是人工核过才放的。 */
function ocrProblems(ocr, waiver) {
  if (!ocr) return ["本机没有这卷的 OCR，未核对"];
  if (!ocr.ok && waiver) return ocr.problems.map((p) => `${p}（已豁免：${waiver}）`);
  return ocr.problems;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const transcriptFiles = [];
  args.forEach((a, i) => {
    if (a !== "--transcripts") return;
    const j = readJson(path.resolve(args[i + 1] || ""), null);
    if (!j) { console.error(`读不到转写文件：${args[i + 1]}`); process.exit(2); }
    transcriptFiles.push(j);
  });

  const gtEmail = readJson(path.join(ROOT, "data/realExam2026/writing/email.json"), { items: [] }).items;
  const gtDisc = readJson(path.join(ROOT, "data/realExam2026/writing/academicDiscussion.json"), { items: [] }).items;
  const posts = readJson(path.join(ROOT, "scripts/research/ad_eval/prof_posts_real.json"), { posts: [] }).posts;
  const prev = readJson(OUT, { email: {}, discussion: {} });
  const listing = fs.existsSync(OCR_DIR) ? fs.readdirSync(OCR_DIR) : [];
  const tByKey = mergeTranscripts(transcriptFiles);
  const ocrCache = new Map();
  const ocrOf = (set) => { if (!ocrCache.has(set)) ocrCache.set(set, ocrGluedFor(set, listing)); return ocrCache.get(set); };

  const email = {};
  const setsOfKind = (kind) => [...tByKey.keys()].filter((k) => k.startsWith(`${kind}|`)).map((k) => k.slice(kind.length + 1));
  const emailSets = new Set([...gtEmail.map((x) => x.source), ...setsOfKind("email")]);
  for (const set of [...emailSets].sort()) {
    const locked = prev.email?.[set]?.locked ? prev.email[set] : null;
    const t = tByKey.get(`email|${set}`);
    const gt = gtEmail.find((x) => x.source === set);
    let content, provenance, lowConfidence = false;
    if (locked) { content = locked.content; provenance = locked.provenance; }
    else if (t?.email) {
      content = W.emailFromGt(t.email);
      provenance = screenshotProvenance(t);
      lowConfidence = t.confidence === "low";
    } else if (gt) {
      content = W.emailFromGt(gt);
      provenance = `data/realExam2026/writing/email.json#${gt.id}`;
    } else continue;
    // 单独核过的指令句（原卷整句，常带收件人身份）盖在上面 —— 转写 / 旧抽取都可能没收这一句
    const dir = locked ? null : tByKey.get(`direction|${set}`);
    if (dir && !(t?.email && String(t.email.direction || "").trim())) {
      content = { ...content, direction: W.emailFromGt({ ...content, direction: dir.direction }).direction };
      provenance += ` + direction ${screenshotProvenance(dir)}`;
      lowConfidence = lowConfidence || dir.confidence === "low";
    }
    const problems = W.emailProblems(content);
    const waiver = locked ? String(locked.ocr_waiver || "") : String(t?.ocr_waiver || "");
    const og = ocrOf(set);
    const ocr = og ? W.ocrVerdict(W.emailFields(content), og) : null;
    email[set] = {
      ...(locked ? { locked: true } : {}),
      content, provenance,
      ocr: ocr ? { trigram: ocr.ratio, per_field: ocr.perField } : null,
      ...(waiver ? { ocr_waiver: waiver } : {}),
      verdict: verdictOf(problems, ocr, { lowConfidence, waiver }),
      problems: [...problems, ...ocrProblems(ocr, waiver), ...(lowConfidence ? ["转写置信度 low"] : [])],
    };
  }

  const discussion = {};
  const discSets = new Set([...gtDisc.map((x) => x.source), ...setsOfKind("discussion")]);
  for (const set of [...discSets].sort()) {
    const locked = prev.discussion?.[set]?.locked ? prev.discussion[set] : null;
    const t = tByKey.get(`discussion|${set}`);
    const gt = gtDisc.find((x) => x.source === set);
    const question = gt ? gt.professor_question : "";
    let content, provenance, lowConfidence = false;
    if (locked) { content = locked.content; provenance = locked.provenance; }
    else if (t?.discussion) {
      const td = t.discussion;
      const tStudents = (td.students || []).filter((s) => s && s.name && s.text);
      // 转写给了课程句就只认它（认不出 / 写着 [?] = 原卷看不到 → 空课程名，被结构闸拦下）；
      // 不许退回旧抽取的课程名 —— 那常是按话题推出来的（2.10 旧数据 education，原卷 educational psychology）。
      const hasCourseLine = td.course_line != null && String(td.course_line).trim() !== "";
      content = W.discussionShape({
        course: hasCourseLine ? W.courseFromLine(td.course_line) : (gt?.course || ""),
        professor: { name: td.professor?.name || gt?.professor || "", text: td.professor?.text || "" },
        students: tStudents.length >= 2 ? tStudents : (gt?.students || []),
      });
      provenance = screenshotProvenance(t);
      lowConfidence = t.confidence === "low";
    } else if (gt) {
      const post = postFor(question, posts);
      content = W.discussionShape({
        course: gt.course,
        professor: { name: gt.professor || post?.prof || "", text: post ? post.text : question },
        students: gt.students,
      });
      provenance = post
        ? `academicDiscussion.json#${gt.id} + prof_posts_real.json[${post.date}]`
        : `academicDiscussion.json#${gt.id}（无整段原话）`;
    } else continue;
    const problems = W.discussionProblems(content, question);
    const waiver = locked ? String(locked.ocr_waiver || "") : String(t?.ocr_waiver || "");
    const og = ocrOf(set);
    const ocr = og ? W.ocrVerdict(W.discussionFields(content), og) : null;
    discussion[set] = {
      ...(locked ? { locked: true } : {}),
      content, question, provenance,
      ocr: ocr ? { trigram: ocr.ratio, per_field: ocr.perField } : null,
      ...(waiver ? { ocr_waiver: waiver } : {}),
      verdict: verdictOf(problems, ocr, { lowConfidence, waiver }),
      problems: [...problems, ...ocrProblems(ocr, waiver), ...(lowConfidence ? ["转写置信度 low"] : [])],
    };
  }

  const tally = (obj) => Object.values(obj).reduce((m, e) => { m[e.verdict] = (m[e.verdict] || 0) + 1; return m; }, {});
  console.log(`邮件 ${Object.keys(email).length} 套：${JSON.stringify(tally(email))}`);
  console.log(`讨论 ${Object.keys(discussion).length} 套：${JSON.stringify(tally(discussion))}`);
  for (const [kind, obj] of [["邮件", email], ["讨论", discussion]]) {
    for (const [set, e] of Object.entries(obj)) {
      if (e.verdict !== "ok") console.log(`  ${kind} ${set} → ${e.verdict}：${e.problems.join("；")}`);
    }
  }
  if (dry) { console.log("（--dry，未写盘）"); return; }

  const payload = {
    _purpose: "第一来源（截图卷）邮件 / 学术讨论补录账本。build_bank.mjs 只收 verdict=ok 的条目；"
      + "内容来自 realExam2026 校准抽取 + 教授原话逐字转写 + 原卷截图转写，逐条对该卷 OCR 核过。",
    _generated_by: "scripts/realbank/recall_writing.mjs",
    _how_to_edit: "改了内容就加 \"locked\": true（重跑只重算核对结论、不覆盖内容）；"
      + "verdict=review 的条目人看过原卷再改成 ok。判据见 scripts/realbank/writing_recall.js。",
    _ocr_trigram_min: W.OCR_TRIGRAM_MIN,
    email,
    discussion,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`账本 → ${path.relative(ROOT, OUT)}`);
}

main();
