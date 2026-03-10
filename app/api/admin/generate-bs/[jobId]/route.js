import { isAdminAuthorized } from "../../../../../lib/adminAuth";

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

// GET /api/admin/generate-bs/[jobId] — 查询单个 run 状态
export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let headers;
  try { headers = ghHeaders(); } catch (e) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const { jobId } = params;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    return Response.json({ error: `GitHub API 错误 ${res.status}` }, { status: res.status });
  }

  const r = await res.json();
  return Response.json({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    inputs: r.inputs || {},
  });
}
