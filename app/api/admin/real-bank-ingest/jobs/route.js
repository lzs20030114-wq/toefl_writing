/**
 * POST /api/admin/real-bank-ingest/jobs —— 建 job + 签直传 URL
 * GET  /api/admin/real-bank-ingest/jobs?limit=50 —— 任务列表
 *
 * 契约：docs/realbank-ingest-contract.md §3。
 */
import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { jsonError } from "../../../../../lib/apiResponse";
import { validateCreateJob } from "../../../../../lib/realBankIngest/validate";
import { createJob, listJobs, updateJob } from "../../../../../lib/realBankIngest/jobs";
import { createSignedUploads } from "../../../../../lib/realBankIngest/storage";
import { ghConfig } from "../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");

  const body = await request.json().catch(() => ({}));
  const v = validateCreateJob(body);
  if (!v.ok) return jsonError(400, v.error);
  if (v.value.kind !== "ingest") return jsonError(400, "本端点只建 ingest job，rebuild 走 /rebuild");

  let job;
  try {
    job = await createJob(v.value);
  } catch (e) {
    return jsonError(500, e.message || "创建任务失败");
  }

  try {
    const uploads = await createSignedUploads(job.id, v.value.files);
    return Response.json({ ok: true, job, uploads });
  } catch (e) {
    // 签不出直传地址 = 这个 job 永远上传不了，直接标失败，别在列表里挂着一个假的 uploading。
    await updateJob(job.id, { status: "failed", error: e.message || "签发上传地址失败" }).catch(() => {});
    return jsonError(500, e.message || "签发上传地址失败");
  }
}

export async function GET(request) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;
  try {
    const jobs = await listJobs({ limit });
    const { owner, repo } = ghConfig();
    // owner/repo 一起回，前端拼 Actions run 链接时不用硬编码仓库名。
    return Response.json({ ok: true, jobs, gh: { owner, repo } });
  } catch (e) {
    return jsonError(500, e.message || "读取任务列表失败");
  }
}
