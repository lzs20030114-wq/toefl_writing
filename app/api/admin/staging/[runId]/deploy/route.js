import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile, putRepoFile, deleteRepoFile } = require("../../../../../../lib/githubApi");
const { TASK_CONFIG } = require("../../../../../../lib/generateConfig");

function jsonErr(status, msg) {
  return Response.json({ error: msg }, { status });
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
  const maxSetId = existingSets.reduce((m, s) => Math.max(m, Number(s.set_id) || 0), 0);
  const newSetIds = [];
  const mergedSets = [...existingSets];

  newSets.forEach((set, i) => {
    const newSetId = maxSetId + i + 1;
    newSetIds.push(newSetId);
    mergedSets.push({
      set_id: newSetId,
      questions: (set.questions || []).map((q, qi) => ({
        ...q,
        id: `ets_s${newSetId}_q${qi + 1}`,
      })),
    });
  });

  const updatedBank = { ...existing, generated_at: new Date().toISOString(), question_sets: mergedSets };

  await putRepoFile(bankPath, updatedBank, bank.sha, `feat: deploy ${newSets.length} BS sets from run ${runId}`);
  await deleteRepoFile(staging.path, staging.sha, `chore: remove deployed staging (run ${runId}) [skip ci]`);

  return Response.json({ ok: true, addedSets: newSets.length, addedQuestions: newSets.reduce((n, s) => n + (s.questions || []).length, 0), newSetIds });
}

// ── Disc / Email deploy (flat array append) ──────────────────────────────────
async function deployFlat(taskType, runId, staging) {
  const config = TASK_CONFIG[taskType];
  const newQuestions = staging.content.questions || [];
  if (newQuestions.length === 0) return jsonErr(400, "临时库中没有题目");

  const bank = await getRepoFile(config.bankPath);
  if (!bank) return jsonErr(500, "正式题库文件不存在");

  const existing = Array.isArray(bank.content) ? bank.content : [];
  const prefix = taskType === "disc" ? "ad" : "em";

  // Find max existing ID number
  let maxNum = 0;
  for (const q of existing) {
    const n = parseInt(String(q.id || "").replace(new RegExp(`^${prefix}`), ""), 10);
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }

  // Assign new IDs
  const reIdQuestions = newQuestions.map((q, i) => ({
    ...q,
    id: `${prefix}${maxNum + i + 1}`,
  }));

  const merged = [...existing, ...reIdQuestions];
  const label = config.label;

  await putRepoFile(config.bankPath, merged, bank.sha, `feat: deploy ${reIdQuestions.length} ${label} questions from run ${runId}`);
  await deleteRepoFile(staging.path, staging.sha, `chore: remove deployed staging (run ${runId}) [skip ci]`);

  return Response.json({ ok: true, addedQuestions: reIdQuestions.length, newIds: reIdQuestions.map((q) => q.id) });
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
