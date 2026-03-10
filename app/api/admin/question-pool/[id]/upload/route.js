import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const { uploadSetsToBank } = require("../../../../../../lib/questionBank/uploadSetsToBank");

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

// POST /api/admin/question-pool/[id]/upload — upload pool entry to production bank
export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  const pool = readPool();
  const entry = pool.entries.find((e) => e.id === id);
  if (!entry) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }

  const sets = entry.sets || [];
  if (sets.length === 0) {
    return Response.json({ error: "No question sets in pool entry" }, { status: 400 });
  }

  try {
    const result = uploadSetsToBank(sets);

    // Remove uploaded entry from pool
    pool.entries = pool.entries.filter((e) => e.id !== id);
    writePool(pool);

    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
