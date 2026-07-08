"use strict";
/**
 * deployGate.js — 部署期「与夜间管线同判」的写作三库(bs/disc/email)把关（零副作用 CJS）
 *
 * 背景（QUESTION-PIPELINE-REVIEW-2026-07-07 §2.3 / §7 P0-4）：
 *   admin 后台「部署到正式题库」按钮 (app/api/admin/staging/[runId]/deploy) 曾直接重编号
 *   写回 live 库，NOT import 任何 validator / 难度门 / 去重 —— 同一批题走夜间管线会被拒、
 *   走这个按钮无条件入库（「同题不同判」）。本模块把夜间管线里「部署期可复算」的把关集中
 *   到一处，供 deploy route 调用，使按钮 ≥ 夜间管线的严格度。
 *
 * 复刻基线（对照 scripts/mergeClaude.mjs 的 mergeBS/mergeDisc/mergeEmail）：
 *   BS   — 逐题 validateQuestion(fatal/format→拒) → 内容去重(answer, bs 0.75, 对现有 bank+批内)
 *          → 重编 set_id/题号 → 逐 set validateAllSets(strict)（含 ETS 风格/难度配比硬门 +
 *          hardFail + runtime 校验）。
 *   Disc — normalizeDiscItem(schema) → professor.text 精确去重 → 模糊+批内去重(discussion 0.8)。
 *   Email— normalizeEmailItem(schema) → scenario 精确去重 → 模糊+批内去重(email 0.8)。
 *
 * 差距（有意未复刻，见文件末 NOTE 与最终报告）：
 *   夜间 BS 链路还跑 scripts/bs-difficulty-scorer.mjs --gate —— 一个「整库统计级」抗退化门
 *   (execSync 子进程 + 读冻结标准文件)。Vercel serverless 不能 spawn node、也不宜把冻结打分器
 *   复制进 lib（会 fork 一把冻结标尺、反而制造本任务要消灭的「同判」分叉），故 route 不复刻该层。
 *
 * Vercel serverless 约束：本模块及其依赖全部为纯 CJS，运行时 **不读 fs**（validateQuestion /
 *   validateQuestionSet / contentDedup 纯函数；scripts/validate-bank.js 顶层只 require、
 *   readFileSync 只在 require.main 守卫的 main() 里）。故可被 Next 静态打包、无缺文件风险。
 */

const { validateQuestion } = require("../questionBank/buildSentenceSchema");
const { validateAllSets } = require("../../scripts/validate-bank");
const { createDedupIndex, checkDuplicate, addToIndex } = require("./contentDedup");

// ── Disc/Email schema normalizers（唯一出处；scripts/mergeClaude.mjs require 本模块复用） ──
function normalizeDiscItem(q) {
  if (!q || typeof q !== "object") return null;
  const professorText = String(q?.professor?.text || "").trim();
  const students = Array.isArray(q.students) ? q.students.filter((s) => s && s.name && s.text) : [];
  if (!professorText || students.length < 2) return null;
  const course = String(q.course || "").trim();
  if (!course) return null;
  return {
    course,
    professor: { name: String(q.professor.name || "Professor").trim(), text: professorText },
    students: students.slice(0, 2).map((s) => ({ name: String(s.name).trim(), text: String(s.text).trim() })),
  };
}

const EMAIL_TOPIC_NORM = {
  "職場工作": "职场工作",
  "社區生活": "社区生活",
  "消費售後": "消费售后",
};
function normalizeEmailItem(q) {
  if (!q || typeof q !== "object") return null;
  const scenario = String(q.scenario || "").trim();
  const direction = String(q.direction || "").trim();
  const goals = Array.isArray(q.goals)
    ? q.goals.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!scenario || !direction || goals.length !== 3) return null;
  const to = String(q.to || "").trim();
  const subject = String(q.subject || "").trim();
  const topic = String(q.topic || "").trim();
  if (!to || !subject || !topic) return null;
  return {
    topic: EMAIL_TOPIC_NORM[topic] || topic,
    scenario,
    direction,
    goals,
    to,
    subject,
  };
}

/**
 * vetBSDeploy(existingSets, newSets)
 *   existingSets: 现有 live bank 的 question_sets（[{ set_id, questions:[...] }]）
 *   newSets:      staging 待部署的 question_sets（[{ questions:[...] }]，set_id 会重编）
 * → { deploySets, addedQuestions, newSetIds, rejected, acceptedCount, warnings }
 *   deploySets: 通过全部把关、已重编 id 的 set（可直接 append 进 bank）
 *   rejected:   [{ set, id?, reason }] 逐条拒绝原因（题级/集级）
 *   warnings:   strict 非阻断警告（难度配比漂移等）— 透出给 admin 复核，
 *               部分弥补部署期跑不了冻结难度门的盲区（见文件顶注「差距」）
 */
function vetBSDeploy(existingSets, newSets) {
  const existing = Array.isArray(existingSets) ? existingSets : [];
  const incoming = Array.isArray(newSets) ? newSets : [];
  const rejected = [];
  const deploySets = [];
  const newSetIds = [];
  const warnings = [];

  const maxSetId = existing.reduce((m, s) => Math.max(m, Number(s.set_id) || 0), 0);

  // 内容去重索引：以现有 bank 的全部答案为种子，逐条 accept 后 addToIndex → 也拦批内近重复。
  const existingAnswers = existing.flatMap((s) => (Array.isArray(s.questions) ? s.questions : []));
  const dedupIndex = createDedupIndex(existingAnswers, "bs");

  incoming.forEach((set, i) => {
    const rawQs = Array.isArray(set.questions) ? set.questions : [];
    const setLabel = `set#${i + 1}`;
    const newSetId = maxSetId + deploySets.length + 1; // 只对已接受的 set 递增，保证 id 连续无洞

    // 1) 逐题结构校验 + 2) 内容去重（answer, bs 阈值 0.75）
    const survived = [];
    for (const q of rawQs) {
      const v = validateQuestion(q);
      if (v.fatal.length > 0 || v.format.length > 0) {
        rejected.push({ set: setLabel, id: q && q.id, reason: `item invalid: ${[...v.fatal, ...v.format].join("; ")}` });
        continue;
      }
      const dup = checkDuplicate(dedupIndex, q, "bs");
      if (dup.dup) {
        rejected.push({ set: setLabel, id: q && q.id, reason: `content-dup answer ~= ${dup.matchId} (${dup.reason})` });
        continue;
      }
      addToIndex(dedupIndex, q, "bs");
      survived.push(q);
    }

    // 3) 重编 id → 4) 集级把关（validateAllSets strict 同时覆盖 validateQuestionSet 的 ETS 配比硬门 +
    //    strict hardFail + runtime 校验）。任一 FAIL → 整 set 拒绝（含「去重后不足 10 题致配比失衡」）。
    const candidateSet = {
      set_id: newSetId,
      questions: survived.map((q, qi) => ({ ...q, id: `ets_s${newSetId}_q${qi + 1}` })),
    };
    const check = validateAllSets({ question_sets: [candidateSet] }, { strict: true });
    if (!check.ok) {
      const reasons = [
        ...check.failures,
        ...check.strictHardFails.map((x) => `${x.label}: ${x.reasons.join("; ")}`),
      ];
      rejected.push({ set: setLabel, reason: `set gate FAIL: ${reasons.join(" | ")}` });
      return;
    }

    if (check.strictWarnings.length > 0) {
      warnings.push(...check.strictWarnings.map((x) => `set_id ${newSetId} ← ${x.label}: ${x.reasons.join("; ")}`));
    }

    deploySets.push(candidateSet);
    newSetIds.push(newSetId);
  });

  const addedQuestions = deploySets.reduce((n, s) => n + s.questions.length, 0);
  // 警告可能很多（逐题质量提示），截断防止响应体膨胀；完整复核请走夜间管线口径。
  const cappedWarnings = warnings.length > 30 ? [...warnings.slice(0, 30), `…(+${warnings.length - 30} more)`] : warnings;
  return { deploySets, addedQuestions, newSetIds, rejected, acceptedCount: deploySets.length, warnings: cappedWarnings };
}

/**
 * vetFlatDeploy(taskType, existing, newQuestions)
 *   taskType: "disc" | "email"
 *   existing: 现有扁平数组 bank
 *   newQuestions: staging 待部署条目
 * → { accepted, rejected, acceptedCount }
 *   accepted: 通过 schema + 精确去重 + 模糊/批内去重、已铸 id 的条目（可直接 append）
 *   rejected: [{ index, reason, matchId? }]
 */
function vetFlatDeploy(taskType, existing, newQuestions) {
  const prod = Array.isArray(existing) ? existing : [];
  const incoming = Array.isArray(newQuestions) ? newQuestions : [];
  const prefix = taskType === "disc" ? "ad" : "em";
  const type = taskType === "disc" ? "discussion" : "email";
  const normalize = taskType === "disc" ? normalizeDiscItem : normalizeEmailItem;
  // 精确去重字段：disc=professor.text，email=scenario（对照 mergeClaude 的 .find(prod) 精确匹配）。
  const exactFieldOf = taskType === "disc"
    ? (p) => String(p?.professor?.text || "").trim()
    : (p) => String(p?.scenario || "").trim();
  const exactKeyOf = taskType === "disc"
    ? (norm) => norm.professor.text
    : (norm) => norm.scenario;

  let counter = prod.length > 0
    ? Math.max(...prod.map((q) => Number(String(q.id || "").replace(new RegExp(`^${prefix}`), "")) || 0)) + 1
    : 1;

  const dedupIndex = createDedupIndex(prod, type);
  const accepted = [];
  const rejected = [];

  incoming.forEach((q, i) => {
    const norm = normalize(q);
    if (!norm) {
      rejected.push({ index: i, reason: "schema_invalid" });
      return;
    }
    const exactKey = exactKeyOf(norm);
    const exactDup = prod.find((p) => exactFieldOf(p) === exactKey);
    if (exactDup) {
      rejected.push({ index: i, reason: taskType === "disc" ? "duplicate_professor_text" : "duplicate_scenario", matchId: exactDup.id });
      return;
    }
    const cdup = checkDuplicate(dedupIndex, norm, type);
    if (cdup.dup) {
      rejected.push({ index: i, reason: `content_dup_${cdup.reason}`, matchId: cdup.matchId });
      return;
    }
    const accItem = { id: `${prefix}${counter}`, ...norm };
    addToIndex(dedupIndex, accItem, type);
    accepted.push(accItem);
    counter += 1;
  });

  return { accepted, rejected, acceptedCount: accepted.length };
}

module.exports = {
  vetBSDeploy,
  vetFlatDeploy,
  // exported for tests / potential reuse
  normalizeDiscItem,
  normalizeEmailItem,
  EMAIL_TOPIC_NORM,
};
