import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const JOBS_DIR = join(process.cwd(), "data", "buildSentence", "jobs");

function ensureJobsDir() {
  if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true });
}

function jobStatePath(jobId) {
  return join(JOBS_DIR, `${jobId}.json`);
}

function readJobState(jobId) {
  try {
    return JSON.parse(readFileSync(jobStatePath(jobId), "utf8"));
  } catch {
    return null;
  }
}

function listJobs() {
  ensureJobsDir();
  try {
    return readdirSync(JOBS_DIR)
      .filter((f) => f.endsWith(".json") && !f.includes("_output") && !f.includes("_pool"))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(JOBS_DIR, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } catch {
    return [];
  }
}

// POST /api/admin/generate-bs — start a new job
export async function POST(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetSets = Math.max(1, Math.min(20, Number(body.targetSets) || 6));

  const jobId = randomUUID();
  const outputPath = join(JOBS_DIR, `${jobId}_output.json`);
  const logPath = join(JOBS_DIR, `${jobId}_log.txt`);

  ensureJobsDir();

  const state = {
    jobId,
    status: "running",
    targetSets,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  writeFileSync(jobStatePath(jobId), JSON.stringify(state, null, 2), "utf8");

  const env = {
    ...process.env,
    BS_TARGET_SETS: String(targetSets),
    BS_OUTPUT_PATH: outputPath,
    BS_JOB_ID: jobId,
    BS_JOB_STATE_PATH: jobStatePath(jobId),
  };

  const logFd = require("fs").openSync(logPath, "w");
  const child = spawn(process.execPath, ["scripts/generateBSQuestions.mjs"], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  require("fs").closeSync(logFd);

  return Response.json({ jobId, status: "running", targetSets });
}

// GET /api/admin/generate-bs — list all jobs
export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ jobs: listJobs() });
}
