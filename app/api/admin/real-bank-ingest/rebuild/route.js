/**
 * POST /api/admin/real-bank-ingest/rebuild  { reason }
 *
 * 无源文件的 job：Worker 只 pull 中间产物 → 跑 build 尾段（build_bank + apply_review +
 * 配音补齐 + 题量常量）→ 推 main。复核决定改了 review-overrides/holds 之后必须重建一次，
 * 否则线上库还是旧的。也给一个手动按钮，方便「改了 holds 但没走后台」的场景。
 */
import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { jsonError } from "../../../../../lib/apiResponse";
import { startRebuild } from "../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
  const body = await request.json().catch(() => ({}));
  try {
    const r = await startRebuild(body.reason);
    if (!r.ok) return Response.json({ ok: false, error: r.error, job: r.job }, { status: 502 });
    return Response.json({ ok: true, job: r.job });
  } catch (e) {
    return jsonError(500, e.message || "创建 rebuild 任务失败");
  }
}
