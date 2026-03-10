import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile, putRepoFile, deleteRepoFile } = require("../../../../../../lib/githubApi");

const BANK_PATH = "data/buildSentence/questions.json";

function stagingPath(runId) {
  return `data/buildSentence/staging/${runId}.json`;
}

// POST /api/admin/staging/[runId]/deploy — 部署到正式题库
export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = params;

  try {
    // 1. 读取临时库文件
    const staging = await getRepoFile(stagingPath(runId));
    if (!staging) {
      return Response.json({ error: "临时库文件不存在，可能已被删除或部署过" }, { status: 404 });
    }
    const newSets = staging.content.question_sets || [];
    if (newSets.length === 0) {
      return Response.json({ error: "临时库中没有题目" }, { status: 400 });
    }

    // 2. 读取正式题库
    const bank = await getRepoFile(BANK_PATH);
    if (!bank) {
      return Response.json({ error: "正式题库文件不存在" }, { status: 500 });
    }
    const existing = bank.content;
    const existingSets = Array.isArray(existing.question_sets) ? existing.question_sets : [];

    // 3. 合并：重新编号
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

    const updatedBank = {
      ...existing,
      generated_at: new Date().toISOString(),
      question_sets: mergedSets,
    };

    // 4. 写入正式题库（触发 Vercel 重新部署）
    await putRepoFile(
      BANK_PATH,
      updatedBank,
      bank.sha,
      `feat: deploy ${newSets.length} BS question sets from run ${runId}`
    );

    // 5. 删除临时库文件
    await deleteRepoFile(
      stagingPath(runId),
      staging.sha,
      `chore: remove deployed staging file (run ${runId}) [skip ci]`
    );

    return Response.json({
      ok: true,
      addedSets: newSets.length,
      addedQuestions: newSets.reduce((n, s) => n + (s.questions || []).length, 0),
      newSetIds,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
