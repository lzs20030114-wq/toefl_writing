/**
 * 后台「微信群二维码」管理：
 *   GET    → 当前自定义图状态（是否存在 / 更新时间 / 大小）
 *   POST   → multipart 上传新图（字段 image），magic-byte 校验后覆盖到 Supabase Storage
 *   DELETE → 删除自定义图，前台回退内置默认图 public/wechat-group-qr.jpg
 * 存储细节见 lib/wechatQr/storage.js；前台读图走 /api/wechat-qr 同源代理。
 */
import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

const { validateQrImage, uploadQr, getQrStatus, deleteQr } = require("../../../../lib/wechatQr/storage");

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    const status = await getQrStatus();
    return Response.json({ ok: true, ...status });
  } catch (e) {
    return jsonError(500, e?.message || "Unexpected error");
  }
}

export async function POST(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError(400, "Expected multipart/form-data");
    const file = form.get("image");
    if (!file || typeof file.arrayBuffer !== "function") return jsonError(400, "Missing image");

    const buf = Buffer.from(await file.arrayBuffer());
    const check = validateQrImage(buf);
    if (!check.ok) return jsonError(check.status, check.error);

    const result = await uploadQr(buf, check.mime);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return jsonError(500, e?.message || "Upload failed");
  }
}

export async function DELETE(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");
    await deleteQr();
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e?.message || "Delete failed");
  }
}
