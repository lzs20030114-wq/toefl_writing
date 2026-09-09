/**
 * POST /api/admin/real-bank-ingest/jobs/[id]/format  { source_kind }
 *
 * Worker 探测不出源格式（置信度 < 0.8）会停在 needs_format，人在后台选一个格式后重新派工。
 */
import { isAdminAuthorized } from "../../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../../lib/apiResponse";
import { validateSourceKind } from "../../../../../../../lib/realBankIngest/validate";
import { getJob } from "../../../../../../../lib/realBankIngest/jobs";
import { queueAndDispatch } from "../../../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");

  const body = await request.json().catch(() => ({}));
  const sk = validateSourceKind(body.source_kind, { allowEmpty: false });
  if (!sk.ok) return jsonError(400, sk.error);
  if (sk.value === "auto") return jsonError(400, "自动探测已经失败过，请选一个具体格式");

  let job;
  try {
    job = await getJob(params.id);
  } catch (e) {
    return jsonError(500, e.message || "读取任务失败");
  }
  if (!job) return jsonError(404, "任务不存在");
  if (job.status !== "needs_format") return jsonError(409, `任务状态是 ${job.status}，不需要选格式`);

  const r = await queueAndDispatch(job.id, { source_kind: sk.value });
  if (!r.ok) return Response.json({ ok: false, error: r.error, job: r.job }, { status: 502 });
  return Response.json({ ok: true, job: r.job });
}
