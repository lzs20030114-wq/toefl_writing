import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { CONTENT_GROUPS, getContentMeta } from "../../../../../lib/admin/contentRegistry";

function readJsonSafe(abs) {
  try {
    const text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function statSafe(abs) {
  try {
    return statSync(abs);
  } catch {
    return null;
  }
}

function listStagingFilesForMeta(meta) {
  const absDir = join(process.cwd(), meta.stagingDir);
  let entries = [];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    if (meta.stagingPrefix && !name.startsWith(meta.stagingPrefix)) continue;
    const abs = join(absDir, name);
    const st = statSafe(abs);
    // Strip extension + optional prefix to get the run id.
    let runId = name.replace(/\.json$/, "");
    if (meta.stagingPrefix) runId = runId.replace(new RegExp(`^${meta.stagingPrefix}`), "");
    out.push({
      file: name,
      runId,
      typeKey: meta.key,
      typeLabel: meta.label,
      groupLabel: meta.groupLabel || null,
      stagingDir: meta.stagingDir,
      size: st?.size ?? null,
      modifiedAt: st?.mtime ? st.mtime.toISOString() : null,
      hasGeneration: Boolean(meta.hasGeneration),
    });
  }
  return out;
}

// GET /api/admin/content/staging                    → list all staging files across types
// GET /api/admin/content/staging?type=<key>         → list for one type
// GET /api/admin/content/staging?type=<key>&file=X  → file content preview
export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const file = url.searchParams.get("file");

  if (type && file) {
    const meta = getContentMeta(type);
    if (!meta) return Response.json({ error: `Unknown type: ${type}` }, { status: 400 });
    // Only allow files that match the prefix (path traversal guard).
    const safeName = String(file).replace(/[\\/]/g, "");
    if (meta.stagingPrefix && !safeName.startsWith(meta.stagingPrefix)) {
      return Response.json({ error: "Forbidden file" }, { status: 400 });
    }
    if (!safeName.endsWith(".json")) {
      return Response.json({ error: "Forbidden file" }, { status: 400 });
    }
    const abs = join(process.cwd(), meta.stagingDir, safeName);
    const content = readJsonSafe(abs);
    if (!content) return Response.json({ error: "File not found or invalid JSON" }, { status: 404 });
    const st = statSafe(abs);
    return Response.json({
      meta,
      file: safeName,
      content,
      size: st?.size ?? null,
      modifiedAt: st?.mtime ? st.mtime.toISOString() : null,
    });
  }

  // Group list for the sidebar/dashboard
  const groups = CONTENT_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.items.map((meta) => ({
      ...meta,
      groupLabel: g.label,
    })).flatMap((m) => listStagingFilesForMeta(m)),
  })).filter((g) => g.items.length > 0);

  if (type) {
    const meta = getContentMeta(type);
    if (!meta) return Response.json({ error: `Unknown type: ${type}` }, { status: 400 });
    const items = listStagingFilesForMeta({ ...meta, groupLabel: meta.groupLabel });
    items.sort((a, b) => String(b.modifiedAt || "").localeCompare(String(a.modifiedAt || "")));
    return Response.json({ type, items });
  }

  // Return flat list too, sorted newest-first
  const flat = groups.flatMap((g) => g.items);
  flat.sort((a, b) => String(b.modifiedAt || "").localeCompare(String(a.modifiedAt || "")));

  return Response.json({ groups, items: flat });
}
