import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile, putRepoFile, deleteRepoFile } = require("../../../../../../lib/githubApi");
const { TASK_CONFIG } = require("../../../../../../lib/generateConfig");
// 部署期「与夜间管线同判」把关（validator + 难度/风格配比门 + 内容去重）。
// 见 lib/gen/deployGate.js 顶注 + QUESTION-PIPELINE-REVIEW-2026-07-07 §7 P0-4。
const { vetBSDeploy, vetFlatDeploy } = require("../../../../../../lib/gen/deployGate");

function jsonErr(status, msg, extra) {
  return Response.json({ error: msg, ...(extra || {}) }, { status });
}

// ── BS deploy ────────────────────────────────────────────────────────────────
async function deployBS(runId, staging) {
  const bankPath = TASK_CONFIG.bs.bankPath;
  const newSets = staging.content.question_sets || [];
  if (newSets.length === 0) return jsonErr(400, "临时库中没有题目");

  const bank = await getRepoFile(bankPath);
  if (!bank) return jsonErr(500, "正式题库文件不存在");

  const existing = bank.content;
  const existingSets = Array.isArray(existing.question_sets) ? existing.question_sets : [];

  // 与夜间 mergeClaude.mergeBS 同判：逐题 validateQuestion + 内容去重(bs 0.75) + 逐 set
  // validateAllSets(strict)（ETS 配比硬门 + hardFail + runtime）。不合格/重复被过滤。
  const { deploySets, addedQuestions, newSetIds, rejected, acceptedCount, warnings } = vetBSDeploy(existingSets, newSets);

  // 全部被拒 → 不动 live 库、不删 staging（留待复核），返回 400 带逐条原因。
  if (deploySets.length === 0) {
    return jsonErr(400, "所有题目均未通过校验/去重，未部署", { rejected, rejectedCount: rejected.length, acceptedCount: 0 });
  }

  const mergedSets = [...existingSets, ...deploySets];
  const updatedBank = { ...existing, generated_at: new Date().toISOString(), question_sets: mergedSets };

  await putRepoFile(bankPath, updatedBank, bank.sha, `feat: deploy ${deploySets.length} vetted BS sets from run ${runId}`);
  await deleteRepoFile(staging.path, staging.sha, `chore: remove deployed staging (run ${runId}) [skip ci]`);

  return Response.json({
    ok: true,
    addedSets: deploySets.length,
    addedQuestions,
    newSetIds,
    acceptedCount,
    rejectedCount: rejected.length,
    rejected,
    // 非阻断警告（难度配比漂移等）——冻结难度门只在夜间管线跑（见 lib/gen/deployGate.js 顶注），
    // 这里把 strict 警告透出，供管理员部署后自行复核。
    warnings,
  });
}

// ── Disc / Email deploy (flat array append) ──────────────────────────────────
async function deployFlat(taskType, runId, staging) {
  const config = TASK_CONFIG[taskType];
  const newQuestions = staging.content.questions || [];
  if (newQuestions.length === 0) return jsonErr(400, "临时库中没有题目");

  const bank = await getRepoFile(config.bankPath);
  if (!bank) return jsonErr(500, "正式题库文件不存在");

  const existing = Array.isArray(bank.content) ? bank.content : [];

  // 与夜间 mergeClaude.mergeDisc/mergeEmail 同判：schema 校验 + 精确去重 + 模糊/批内去重(0.8)。
  // vetFlatDeploy 内部已铸好连续 id（ad{n}/em{n}），无需再重编。
  const { accepted, rejected, acceptedCount } = vetFlatDeploy(taskType, existing, newQuestions);

  if (accepted.length === 0) {
    return jsonErr(400, "所有题目均未通过校验/去重，未部署", { rejected, rejectedCount: rejected.length, acceptedCount: 0 });
  }

  const merged = [...existing, ...accepted];
  const label = config.label;

  await putRepoFile(config.bankPath, merged, bank.sha, `feat: deploy ${accepted.length} vetted ${label} questions from run ${runId}`);
  await deleteRepoFile(staging.path, staging.sha, `chore: remove deployed staging (run ${runId}) [skip ci]`);

  return Response.json({
    ok: true,
    addedQuestions: accepted.length,
    newIds: accepted.map((q) => q.id),
    acceptedCount,
    rejectedCount: rejected.length,
    rejected,
  });
}

// POST /api/admin/staging/[runId]/deploy?taskType=bs|disc|email
export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return jsonErr(401, "Unauthorized");

  const { runId } = params;
  const url = new URL(request.url);
  const taskType = url.searchParams.get("taskType") || "bs";
  const config = TASK_CONFIG[taskType];
  if (!config) return jsonErr(400, `Unknown task type: ${taskType}`);

  try {
    const stagingFilePath = `${config.stagingDir}/${runId}.json`;
    const staging = await getRepoFile(stagingFilePath);
    if (!staging) return jsonErr(404, "临时库文件不存在，可能已被删除或部署过");
    staging.path = stagingFilePath;

    if (taskType === "bs") {
      return deployBS(runId, staging);
    }
    return deployFlat(taskType, runId, staging);
  } catch (e) {
    return jsonErr(500, e.message);
  }
}
