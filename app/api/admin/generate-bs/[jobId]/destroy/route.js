import { isAdminAuthorized } from "../../../../../../lib/adminAuth";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOBS_DIR = join(process.cwd(), "data", "buildSentence", "jobs");

function jobFiles(jobId) {
  return [
    join(JOBS_DIR, `${jobId}.json`),
    join(JOBS_DIR, `${jobId}_output.json`),
    join(JOBS_DIR, `${jobId}_log.txt`),
  ];
}

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) return Response.json({ error: "Missing jobId" }, { status: 400 });

  const statePath = join(JOBS_DIR, `${jobId}.json`);
  if (!existsSync(statePath)) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  // Mark as destroyed before deleting files
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.status === "running") {
      return Response.json({ error: "Cannot destroy a running job" }, { status: 409 });
    }
  } catch {
    // continue
  }

  for (const f of jobFiles(jobId)) {
    if (existsSync(f)) {
      try { unlinkSync(f); } catch (_) {}
    }
  }

  return Response.json({ ok: true, jobId, destroyed: true });
}
