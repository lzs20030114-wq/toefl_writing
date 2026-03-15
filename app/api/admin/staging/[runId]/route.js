import { isAdminAuthorized } from "../../../../../lib/adminAuth";

const { getRepoFile, deleteRepoFile } = require("../../../../../lib/githubApi");
const { TASK_CONFIG } = require("../../../../../lib/generateConfig");

// DELETE /api/admin/staging/[runId]?taskType=bs|disc|email
export async function DELETE(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = params;
  const url = new URL(request.url);
  const taskType = url.searchParams.get("taskType") || "bs";
  const config = TASK_CONFIG[taskType];
  if (!config) {
    return Response.json({ error: `Unknown task type: ${taskType}` }, { status: 400 });
  }

  const filePath = `${config.stagingDir}/${runId}.json`;

  try {
    const file = await getRepoFile(filePath);
    if (!file) {
      return Response.json({ error: "临时库文件不存在" }, { status: 404 });
    }
    await deleteRepoFile(filePath, file.sha, `chore: discard staged ${config.label} (run ${runId}) [skip ci]`);
    return Response.json({ ok: true, runId });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
