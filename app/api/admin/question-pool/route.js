import { isAdminAuthorized } from "../../../../lib/adminAuth";
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

// GET /api/admin/question-pool — list pool entries
export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pool = readPool();
  return Response.json({ entries: pool.entries || [] });
}
