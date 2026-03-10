import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const { uploadSetsToBank } = require("../../../../../../lib/questionBank/uploadSetsToBank");

const JOBS_DIR = join(process.cwd(), "data", "buildSentence", "jobs");

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
  } catch {
    return Response.json({ error: "Failed to read job output" }, { status: 500 });
  }

  const sets = outputData.question_sets || [];
  if (sets.length === 0) {
    return Response.json({ error: "No question sets in output" }, { status: 400 });
  }

  try {
    const result = uploadSetsToBank(sets);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
