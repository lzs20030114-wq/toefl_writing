/**
 * POST /api/admin/real-bank-ingest/jobs/[id]/cancel
 *
 * uploading / queued / needs_format / failed → cancelled，并删掉源目录（桶要花钱且源是原始资料，
 * 不留垃圾）。running/dispatched 不给取消：Actions 那边还在跑，改状态只会让两边打架，
 * 要停就去 Actions 页面 cancel run，Worker 的 if:failure() 兜底会把 job 标 failed。
 */
import { isAdminAuthorized } from "../../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../../lib/apiResponse";
import { getJob, updateJob } from "../../../../../../../lib/realBankIngest/jobs";
import { deleteJobDir } from "../../../../../../../lib/realBankIngest/storage";

export const dynamic = "force-dynamic";

const CANCELLABLE = ["uploading", "queued", "needs_format", "failed"];

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");

  let job;
  try {
    job = await getJob(params.id);
  } catch (e) {
    return jsonError(500, e.message || "读取任务失败");
  }
  if (!job) return jsonError(404, "任务不存在");
  if (!CANCELLABLE.includes(job.status)) {
    return jsonError(409, `任务状态是 ${job.status}，不能取消（跑到一半请到 GitHub Actions 里停 run）`);
  }

  let removed = 0;
  let cleanupError = null;
  if (job.kind !== "rebuild") {
    try {
      ({ removed } = await deleteJobDir(job.id));
    } catch (e) {
      cleanupError = e.message || "删除源文件失败"; // 删不掉不阻塞取消，只回报
    }
  }
  const updated = await updateJob(job.id, { status: "cancelled", stage: null, error: cleanupError });
  return Response.json({ ok: true, job: updated, removed, cleanupError });
}
