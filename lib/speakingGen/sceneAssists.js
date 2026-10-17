import catalog from "../../data/realBank/speaking/scene-assists.json";

const unit = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
export function validSceneAssistUrl(value) {
  if (typeof value !== "string" || !value || /[\s\\\u0000-\u001f]/.test(value)) return false;
  try {
    const local = value.startsWith("/") && !value.startsWith("//");
    const parsed = new URL(value, "https://scene-assist.invalid");
    return (local || value.startsWith("https://")) && parsed.protocol === "https:"
      && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}
export function validSceneOverlay(shape) {
  if (!shape || typeof shape !== "object") return false;
  if (shape.type === "rect") return [shape.x, shape.y, shape.width, shape.height].every(unit)
    && shape.width > 0 && shape.height > 0 && shape.x + shape.width <= 1 && shape.y + shape.height <= 1;
  if (shape.type === "ellipse") return [shape.cx, shape.cy, shape.rx, shape.ry].every(unit)
    && shape.rx > 0 && shape.ry > 0 && shape.cx >= shape.rx && shape.cy >= shape.ry
    && shape.cx + shape.rx <= 1 && shape.cy + shape.ry <= 1;
  return shape.type === "polygon" && Array.isArray(shape.points) && shape.points.length >= 3
    && shape.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(unit));
}

/** Exact bindings only: a changed sentence or ambiguous duplicate is never guessed. */
export function mapSceneAssists(raw, data = catalog) {
  if (data?.version !== 1 || !Array.isArray(data.entries)) return [];
  const candidates = data.entries.filter((entry) => entry?.item_id === raw?.id);
  return candidates.flatMap((entry) => {
    const sentence = raw?.sentences?.find((s) => s.id === entry.sentence_id);
    if (!sentence || sentence.sentence !== entry.sentence_text
      || candidates.filter((e) => e.sentence_id === entry.sentence_id).length !== 1) return [];
    if (!["highlight", "redraw"].includes(entry.kind)
      || !validSceneAssistUrl(entry.url)
      || !Number.isInteger(entry.w) || entry.w <= 0 || !Number.isInteger(entry.h) || entry.h <= 0
      || !Array.isArray(entry.references) || !entry.references.length
      || !entry.references.every((r) => typeof r?.url === "string" && r.url.length > 0)
      || !Array.isArray(entry.overlay) || !entry.overlay.every(validSceneOverlay)
      || (entry.kind === "highlight" && !entry.overlay.length)) return [];
    return [{ sentence_id: entry.sentence_id, sentence_text: entry.sentence_text,
      url: entry.url, w: entry.w, h: entry.h, kind: entry.kind,
      overlay: entry.overlay, references: entry.references, auxiliary: true }];
  });
}

export function sceneAssistsAllowed({ realMock = false, etsNumbering = null } = {}) {
  return !realMock && !etsNumbering;
}
