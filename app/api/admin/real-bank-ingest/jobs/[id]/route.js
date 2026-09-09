/** GET /api/admin/real-bank-ingest/jobs/[id] —— 任务详情（含 progress 全文与 result）。 */
import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../lib/apiResponse";
import { getJob } from "../../../../../../lib/realBankIngest/jobs";
import { ghConfig } from "../../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
  try {
    const job = await getJob(params.id);
    if (!job) return jsonError(404, "任务不存在");
    const { owner, repo } = ghConfig();
    return Response.json({ ok: true, job, gh: { owner, repo } });
  } catch (e) {
    return jsonError(500, e.message || "读取任务失败");
  }
}
