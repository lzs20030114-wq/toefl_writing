import { isAdminAuthorized } from "../../../../lib/adminAuth";

const GH_OWNER = process.env.GH_OWNER || "lzs20030114-wq";
const GH_REPO = process.env.GH_REPO || "toefl_writing";
const WORKFLOW_FILE = "generate-bs.yml";

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

// POST /api/admin/generate-bs — 触发 workflow
export async function POST(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let headers;
  try { headers = ghHeaders(); } catch (e) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const targetSets = Math.max(1, Math.min(20, Number(body.targetSets) || 6));

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { target_sets: String(targetSets) } }),
  });

  if (res.status !== 204) {
    const text = await res.text();
    return Response.json({ error: `GitHub API 错误 ${res.status}: ${text}` }, { status: 500 });
  }

  return Response.json({ triggered: true, targetSets, triggeredAt: new Date().toISOString() });
}

// GET /api/admin/generate-bs — 列出最近的 workflow runs
export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let headers;
  try { headers = ghHeaders(); } catch (e) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=15`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    return Response.json({ error: `GitHub API 错误 ${res.status}` }, { status: 500 });
  }

  const data = await res.json();
  return Response.json({ runs: (data.workflow_runs || []).map(formatRun) });
}
