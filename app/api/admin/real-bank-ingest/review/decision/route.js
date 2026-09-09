/**
 * POST /api/admin/real-bank-ingest/review/decision
 *   { action:"allow_section", set_key, section, code, reason }  → 追加 review-overrides.json.allow[]
 *   { action:"hold_unit", file, id, scope, reason, ... }        → 追加 review-holds.json.holds[]
 *
 * 提交 main 之后自动派一个 rebuild job：清单只是**输入**，不重建库线上不会变。
 * rebuild 派工失败不回滚提交（文件改动本身是对的，重试按钮能补派），但会在响应里说清楚。
 */
import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { jsonError } from "../../../../../../lib/apiResponse";
import {
  normalizeAllowSection,
  normalizeHoldUnit,
  commitAllowSection,
  commitHoldUnit,
} from "../../../../../../lib/realBankIngest/review";
import { startRebuild } from "../../../../../../lib/realBankIngest/dispatch";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  let committed;
  let summary;
  try {
    if (action === "allow_section") {
      const v = normalizeAllowSection(body);
      if (!v.ok) return jsonError(400, v.error);
      committed = await commitAllowSection(v.value);
      summary = `放行 ${v.value.set} / ${v.value.section} / ${v.value.code}`;
    } else if (action === "hold_unit") {
      const v = normalizeHoldUnit(body);
      if (!v.ok) return jsonError(400, v.error);
      committed = await commitHoldUnit(v.value);
      summary = `下架 ${v.value.file} ${v.value.id}`;
    } else {
      return jsonError(400, `未知的 action：${action || "(空)"}`);
    }
  } catch (e) {
    return jsonError(502, `提交仓库失败：${e.message || e}`);
  }

  try {
    const r = await startRebuild(`复核决定：${summary}`);
    if (!r.ok) {
      return Response.json(
        { ok: true, committed, job: r.job, rebuildError: r.error, message: `${summary} 已提交 main，但 rebuild 派工失败，请在任务列表里重试` },
        { status: 200 }
      );
    }
    return Response.json({ ok: true, committed, job: r.job, message: `${summary} 已提交 main，并已派 rebuild 任务` });
  } catch (e) {
    return Response.json(
      { ok: true, committed, rebuildError: e.message || String(e), message: `${summary} 已提交 main，但 rebuild 任务没建起来` },
      { status: 200 }
    );
  }
}
