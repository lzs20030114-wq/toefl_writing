import { isAdminAuthorized } from "../../../../../lib/adminAuth";

const { TASK_CONFIG } = require("../../../../../lib/generateConfig");

const GH_OWNER = process.env.GH_OWNER || "lzs20030114-wq";
const GH_REPO = process.env.GH_REPO || "toefl_writing";

function ghHeaders() {
  const pat = process.env.GH_PAT;
  if (!pat) throw new Error("GH_PAT 未配置");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function formatRun(r) {
  return {
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    inputs: r.inputs || {},
  };
}

function err(status, msg) {
  return Response.json({ error: msg }, { status });
}

export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { taskType } = params;
  const config = TASK_CONFIG[taskType];
  if (!config) return err(400, `Unknown task type: ${taskType}`);

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const body = await request.json().catch(() => ({}));
  const count = Math.max(1, Math.min(config.maxVal, Number(body.count) || config.defaultVal));

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${config.workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { [config.inputKey]: String(count) } }),
  });

  if (res.status !== 204) {
    const text = await res.text();
    return err(500, `GitHub API 错误 ${res.status}: ${text}`);
  }

  return Response.json({ triggered: true, count, triggeredAt: new Date().toISOString() });
}

export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { taskType } = params;
  const config = TASK_CONFIG[taskType];
  if (!config) return err(400, `Unknown task type: ${taskType}`);

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${config.workflowFile}/runs?per_page=15`;
  const res = await fetch(url, { headers });
  if (!res.ok) return err(500, `GitHub API 错误 ${res.status}`);

  const data = await res.json();
  return Response.json({ runs: (data.workflow_runs || []).map(formatRun) });
}
