import { isAdminAuthorized } from "../../../../../lib/adminAuth";

const { getRepoFile, deleteRepoFile } = require("../../../../../lib/githubApi");

function stagingPath(runId) {
  return `data/buildSentence/staging/${runId}.json`;
}

// DELETE /api/admin/staging/[runId] — 删除临时库题目
export async function DELETE(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = params;

  try {
    const file = await getRepoFile(stagingPath(runId));
    if (!file) {
      return Response.json({ error: "临时库文件不存在" }, { status: 404 });
    }
    await deleteRepoFile(
      stagingPath(runId),
      file.sha,
      `chore: discard staged BS questions (run ${runId}) [skip ci]`
    );
    return Response.json({ ok: true, runId });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
