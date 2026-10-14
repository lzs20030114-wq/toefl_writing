// /api/real-favorites 写入前对单条收藏的校验与整理（路由文件只能导出 HTTP 方法，所以放这里，也方便测试）。

export const FAV_MAX_BYTES = 2 * 1024;
// 「题型:题目 id」；真题条目 id 一律 real_ 前缀（lib/realBankHistory.realSessionItemIds 同一口径）。
export const FAV_KEY_RE = /^[a-z]{2,12}:real_[A-Za-z0-9_.-]{1,160}$/;

export const favTime = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** 校验并收拾一条要写进云端的收藏。返回 { row } 或 { error }。 */
export function toFavRow(code, raw) {
  if (!raw || typeof raw !== "object") return { error: "favorite must be an object" };
  const key = String(raw.key || "");
  if (!FAV_KEY_RE.test(key)) return { error: "invalid favorite.key" };
  if (key !== `${raw.subtype}:${raw.itemId}`) return { error: "favorite.key does not match subtype/itemId" };
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  } catch {
    return { error: "favorite is not JSON-serializable" };
  }
  if (bytes > FAV_MAX_BYTES) return { error: `favorite too large (${bytes} > ${FAV_MAX_BYTES} bytes)` };
  const updatedAt = favTime(raw.updatedAt) ? new Date(raw.updatedAt).toISOString() : new Date().toISOString();
  return { row: { user_code: code, fav_key: key, fav: { ...raw, updatedAt }, updated_at: updatedAt } };
}
