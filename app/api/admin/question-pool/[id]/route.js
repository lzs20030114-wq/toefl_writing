import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const POOL_PATH = join(process.cwd(), "data", "buildSentence", "question_pool.json");

function readPool() {
  try {
    if (!existsSync(POOL_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(POOL_PATH, "utf8"));
  } catch {
    return { entries: [] };
  }
}

function writePool(pool) {
  writeFileSync(POOL_PATH, `${JSON.stringify(pool, null, 2)}\n`, "utf8");
}

// DELETE /api/admin/question-pool/[id] — destroy pool entry
export async function DELETE(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  const pool = readPool();
  const before = pool.entries.length;
  pool.entries = pool.entries.filter((e) => e.id !== id);
  if (pool.entries.length === before) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }
  writePool(pool);
  return Response.json({ ok: true, id });
}
