import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const JOBS_DIR = join(process.cwd(), "data", "buildSentence", "jobs");
const POOL_PATH = join(process.cwd(), "data", "buildSentence", "question_pool.json");

function readPool() {
  try {
    return JSON.parse(readFileSync(POOL_PATH, "utf8"));
  } catch {
    return { entries: [] };
  }
}

function writePool(pool) {
  writeFileSync(POOL_PATH, `${JSON.stringify(pool, null, 2)}\n`, "utf8");
}

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) return Response.json({ error: "Missing jobId" }, { status: 400 });

  const statePath = join(JOBS_DIR, `${jobId}.json`);
  const outputFilePath = join(JOBS_DIR, `${jobId}_output.json`);

  if (!existsSync(statePath)) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  if (!existsSync(outputFilePath)) {
    return Response.json({ error: "Job output not ready" }, { status: 409 });
  }

  let outputData;
  try {
    outputData = JSON.parse(readFileSync(outputFilePath, "utf8"));
  } catch (e) {
    return Response.json({ error: "Failed to read job output" }, { status: 500 });
  }

  const sets = outputData.question_sets || [];
  if (sets.length === 0) {
    return Response.json({ error: "No question sets in output" }, { status: 400 });
  }

  const pool = readPool();
  const entryId = randomUUID();
  pool.entries.push({
    id: entryId,
    savedAt: new Date().toISOString(),
    sourceJobId: jobId,
    setCount: sets.length,
    questionCount: sets.reduce((n, s) => n + (s.questions || []).length, 0),
    sets,
  });
  writePool(pool);

  return Response.json({ ok: true, entryId, setCount: sets.length });
}
