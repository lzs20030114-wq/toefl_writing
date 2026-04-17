import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { CONTENT_GROUPS, getContentMeta } from "../../../../lib/admin/contentRegistry";

function readJson(relPath) {
  try {
    const abs = join(process.cwd(), relPath);
    const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractItems(raw, shape) {
  if (!raw) return [];
  if (shape === "array") return Array.isArray(raw) ? raw : [];
  if (shape === "itemsWrapper") return Array.isArray(raw?.items) ? raw.items : [];
  if (shape === "bsSets") {
    const sets = Array.isArray(raw?.question_sets) ? raw.question_sets : [];
    const flat = [];
    for (const set of sets) {
      const questions = Array.isArray(set.questions) ? set.questions : [];
      for (const q of questions) flat.push({ ...q, _setId: set.set_id });
    }
    return flat;
  }
  return [];
}

function countStagingFiles(stagingDir, prefix) {
  try {
    const abs = join(process.cwd(), stagingDir);
    const entries = readdirSync(abs);
    let count = 0;
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      if (prefix && !name.startsWith(prefix)) continue;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function bankFileInfo(relPath) {
  try {
    const abs = join(process.cwd(), relPath);
    const st = statSync(abs);
    return { size: st.size, modifiedAt: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

// GET /api/admin/content                → summary for all banks
// GET /api/admin/content?type=<key>      → full item list for one bank
// GET /api/admin/content?type=<key>&id=X → single item
export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (!type) {
    // Summary: counts per bank, grouped.
    const groups = CONTENT_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      items: g.items.map((meta) => {
        const raw = readJson(meta.bankPath);
        const items = extractItems(raw, meta.shape);
        const info = bankFileInfo(meta.bankPath);
        return {
          key: meta.key,
          label: meta.label,
          bankPath: meta.bankPath,
          count: items.length,
          stagingCount: countStagingFiles(meta.stagingDir, meta.stagingPrefix),
          hasGeneration: Boolean(meta.hasGeneration),
          bankExists: Boolean(raw),
          bankSize: info?.size ?? null,
          modifiedAt: info?.modifiedAt ?? null,
        };
      }),
    }));
    return Response.json({ groups });
  }

  const meta = getContentMeta(type);
  if (!meta) return Response.json({ error: `Unknown content type: ${type}` }, { status: 400 });

  const raw = readJson(meta.bankPath);
  const items = extractItems(raw, meta.shape);
  const idField = meta.idField || "id";

  if (id) {
    const found = items.find((item) => String(item?.[idField]) === String(id));
    if (!found) return Response.json({ error: "Item not found" }, { status: 404 });
    return Response.json({ meta, item: found });
  }

  // Trim items to keep payload reasonable for big banks.
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const slice = items.slice(offset, offset + limit);

  return Response.json({
    meta,
    total: items.length,
    offset,
    limit,
    items: slice,
  });
}
