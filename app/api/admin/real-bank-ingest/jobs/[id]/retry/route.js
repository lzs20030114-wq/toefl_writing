/**
 * POST /api/admin/real-bank-ingest/jobs/[id]/retry
 *
 * 只允许 failed。源文件在 failed 时是保留的（Worker 只在 done 后删），所以重试不用重传。
 */
import { isAdminAuthorized } from "../../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../../lib/apiResponse";
import { getJob } from "../../../../../../../lib/realBankIngest/jobs";
import { queueAndDispatch } from "../../../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");

  let job;
  try {
    job = await getJob(params.id);
  } catch (e) {
    return jsonError(500, e.message || "读取任务失败");
  }
  if (!job) return jsonError(404, "任务不存在");
  if (job.status !== "failed") return jsonError(409, `只有失败的任务能重试（当前 ${job.status}）`);

  const r = await queueAndDispatch(job.id, { stage: null });
  if (!r.ok) return Response.json({ ok: false, error: r.error, job: r.job }, { status: 502 });
  return Response.json({ ok: true, job: r.job });
}
