import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile, deleteRepoFile } = require("../../../../../../lib/githubApi");
const { TASK_CONFIG } = require("../../../../../../lib/generateConfig");

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

function err(status, msg) {
  return Response.json({ error: msg }, { status });
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function computeDiscStats(data) {
  const questions = data.questions || [];
  const meta = data._meta || {};
  const courseDist = {};
  questions.forEach((q) => {
    const c = q.course || "unknown";
    courseDist[c] = (courseDist[c] || 0) + 1;
  });
  return {
    totalQuestions: questions.length,
    totalGenerated: meta.total_generated,
    totalAccepted: meta.total_accepted,
    failures: meta.failures,
    courseDist,
    textStats: {
      avgProfLength: avg(questions.map((q) => (q.professor?.text || "").length)),
      avgS1Length: avg(questions.map((q) => (q.students?.[0]?.text || "").length)),
      avgS2Length: avg(questions.map((q) => (q.students?.[1]?.text || "").length)),
    },
    questions: questions.map((q) => ({
      id: q.id,
      course: q.course,
      professor: q.professor,
      students: q.students,
    })),
  };
}

function computeEmailStats(data) {
  const questions = data.questions || [];
  const meta = data._meta || {};
  const topicDist = {};
  questions.forEach((q) => {
    const t = q.topic || "unknown";
    topicDist[t] = (topicDist[t] || 0) + 1;
  });
  return {
    totalQuestions: questions.length,
    totalGenerated: meta.total_generated,
    totalAccepted: meta.total_accepted,
    failures: meta.failures,
    topicDist,
    textStats: {
      avgScenarioLength: avg(questions.map((q) => (q.scenario || "").length)),
    },
    questions: questions.map((q) => ({
      id: q.id,
      topic: q.topic,
      subject: q.subject,
      to: q.to,
      scenario: q.scenario,
      direction: q.direction,
      goals: q.goals,
    })),
  };
}

// GET — fetch run details + staging stats
export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { taskType, jobId } = params;
  const config = TASK_CONFIG[taskType];
  if (!config) return err(400, `Unknown task type: ${taskType}`);

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return err(res.status, `GitHub API 错误 ${res.status}`);

  const r = await res.json();
  const run = {
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    inputs: r.inputs || {},
  };

  if (r.status === "completed" && r.conclusion === "success") {
    try {
      const stagingFile = await getRepoFile(`${config.stagingDir}/${jobId}.json`);
      if (stagingFile) {
        run.stats = taskType === "disc"
          ? computeDiscStats(stagingFile.content)
          : computeEmailStats(stagingFile.content);
        run.stagingReady = true;
      } else {
        run.stagingReady = false;
      }
    } catch (e) {
      run.statsError = e.message;
    }
  }

  if (r.status === "completed" && r.conclusion !== "success") {
    try {
      const stateFile = await getRepoFile(`${config.stagingDir}/${jobId}.state.json`);
      if (stateFile?.content?.error) {
        run.failureReason = stateFile.content.error;
      }
    } catch (_) {}
  }

  return Response.json(run);
}

// PUT — graceful stop signal
export async function PUT(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { taskType, jobId } = params;
  const config = TASK_CONFIG[taskType];
  if (!config) return err(400, `Unknown task type: ${taskType}`);

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const runUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const runRes = await fetch(runUrl, { headers });
  if (runRes.ok) {
    const rd = await runRes.json();
    if (rd.status === "completed") {
      return Response.json({ ok: false, alreadyDone: true, message: "任务已完成。" });
    }
  }

  const filePath = `${config.stagingDir}/${jobId}.stop`;
  const content = Buffer.from(JSON.stringify({ stoppedAt: new Date().toISOString() })).toString("base64");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;

  const existRes = await fetch(url, { headers });
  if (existRes.status === 200) {
    return Response.json({ ok: true, message: "停止信号已发送。" });
  }

  const putRes = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `chore: stop signal for ${taskType} run ${jobId} [skip ci]`, content }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    return err(putRes.status, `创建停止信号失败 ${putRes.status}: ${text}`);
  }

  return Response.json({ ok: true, message: "已发送停止信号。" });
}

// POST — force cancel
export async function POST(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { jobId } = params;

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}/cancel`;
  const res = await fetch(url, { method: "POST", headers });

  if (res.status === 202 || res.status === 409) {
    return Response.json({ ok: true, alreadyDone: res.status === 409 });
  }
  const text = await res.text();
  return err(res.status, `GitHub API 错误 ${res.status}: ${text}`);
}

// DELETE — delete run record + staging files
export async function DELETE(request, { params }) {
  if (!isAdminAuthorized(request)) return err(401, "Unauthorized");

  const { taskType, jobId } = params;
  const config = TASK_CONFIG[taskType];
  if (!config) return err(400, `Unknown task type: ${taskType}`);

  let headers;
  try { headers = ghHeaders(); } catch (e) { return err(503, e.message); }

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const res = await fetch(url, { method: "DELETE", headers });

  if (res.status !== 204) {
    const text = await res.text();
    return err(res.status, `GitHub API 错误 ${res.status}: ${text}`);
  }

  try {
    const sf = await getRepoFile(`${config.stagingDir}/${jobId}.json`);
    if (sf) {
      await deleteRepoFile(`${config.stagingDir}/${jobId}.json`, sf.sha, `chore: discard staged ${taskType} (run ${jobId}) [skip ci]`);
    }
  } catch (_) {}

  return Response.json({ ok: true });
}
