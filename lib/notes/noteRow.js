// /api/notes 写入前对单条笔记的校验与整理（路由文件只能导出 HTTP 方法，所以放这里，也方便测试）。

export const NOTE_MAX_BYTES = 32 * 1024;
const ID_RE = /^n[a-z0-9]{6,24}$/;
const KEY_RE = /^p[a-z0-9]{1,16}-[a-z0-9]{1,8}$/;

export const noteTime = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** 校验并收拾一条要写进云端的笔记。返回 { row } 或 { error }。 */
export function toNoteRow(code, raw) {
  if (!raw || typeof raw !== "object") return { error: "note must be an object" };
  const id = String(raw.id || "");
  if (!ID_RE.test(id)) return { error: "invalid note.id" };
  const key = String(raw.passageKey || "");
  if (!KEY_RE.test(key)) return { error: "invalid note.passageKey" };
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  } catch {
    return { error: "note is not JSON-serializable" };
  }
  if (bytes > NOTE_MAX_BYTES) return { error: `note too large (${bytes} > ${NOTE_MAX_BYTES} bytes)` };
  const updatedAt = noteTime(raw.updatedAt) ? new Date(raw.updatedAt).toISOString() : new Date().toISOString();
  return {
    row: { user_code: code, note_id: id, passage_key: key, note: { ...raw, updatedAt }, updated_at: updatedAt },
  };
}

