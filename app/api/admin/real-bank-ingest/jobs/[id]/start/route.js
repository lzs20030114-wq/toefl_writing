/**
 * POST /api/admin/real-bank-ingest/jobs/[id]/start
 *
 * 直传完成后由前端调用：service role 列桶目录核对文件齐全 → queued → dispatch → dispatched。
 * 「核对齐全」是必须的：浏览器直传是逐文件的，中途关页面/断网会留下半套源，
 * Worker 拿半套跑出来的库比不跑更糟（缺题静默上线）。
 */
import { isAdminAuthorized } from "../../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../../lib/apiResponse";
import { getJob, updateJob } from "../../../../../../../lib/realBankIngest/jobs";
import { listJobFiles } from "../../../../../../../lib/realBankIngest/storage";
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
  if (!["uploading", "queued", "failed"].includes(job.status)) {
    return jsonError(409, `任务状态是 ${job.status}，不能启动`);
  }

  const expected = Array.isArray(job.files) ? job.files : [];
  if (!expected.length) return jsonError(400, "任务没有登记任何文件");

  let present;
  try {
    present = await listJobFiles(job.id);
  } catch (e) {
    return jsonError(500, e.message || "读取源文件失败");
  }
  const have = new Set(present.map((f) => f.path));
  const missing = expected.filter((f) => !have.has(f.path)).map((f) => f.path);
  if (missing.length) {
    return jsonError(
      409,
      `还有 ${missing.length} 个文件没传完：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " …" : ""}`
    );
  }

  const files = expected.map((f) => ({ ...f, uploaded: true }));
  try {
    const r = await queueAndDispatch(job.id, { files });
    if (!r.ok) return Response.json({ ok: false, error: r.error, job: r.job }, { status: 502 });
    return Response.json({ ok: true, job: r.job });
  } catch (e) {
    await updateJob(job.id, { error: e.message || "启动失败" }).catch(() => {});
    return jsonError(500, e.message || "启动失败");
  }
}
