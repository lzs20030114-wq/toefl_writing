import { isAdminAuthorized } from "../../../../../lib/adminAuth";

const { getRepoFile } = require("../../../../../lib/githubApi");
const { isEmbeddedQuestion, isNegation } = require("../../../../../lib/questionBank/etsProfile");

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

function computeStats(data) {
  const sets = data.question_sets || [];
  const allQ = sets.flatMap((s) => s.questions || []);
  const meta = data._meta || {};

  // 题型分布
  const typeDistribution = {
    hasQuestionMark: allQ.filter((q) => q.has_question_mark).length,
    hasDistractor: allQ.filter((q) => q.distractor != null).length,
    hasEmbedded: allQ.filter((q) => isEmbeddedQuestion(q.grammar_points)).length,
    hasNegation: allQ.filter((q) => isNegation(q.grammar_points)).length,
    hasPrefilled: allQ.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0).length,
  };

  // chunk 长度分布
  const allChunks = allQ.flatMap((q) =>
    (q.chunks || []).filter((c) => c !== q.distractor).map((c) => c.trim().split(/\s+/).filter(Boolean).length)
  );
  const chunkStats = {
    total: allChunks.length,
    avgWords: allChunks.length ? Number((allChunks.reduce((a, b) => a + b, 0) / allChunks.length).toFixed(2)) : 0,
    single: allChunks.filter((n) => n === 1).length,
    double: allChunks.filter((n) => n === 2).length,
    triple: allChunks.filter((n) => n === 3).length,
  };

  // prefilled 数据
  const prefilledAll = allQ.flatMap((q) => q.prefilled || []);
  const prefilledFreq = {};
  prefilledAll.forEach((w) => { prefilledFreq[w] = (prefilledFreq[w] || 0) + 1; });
  const prefilledTop = Object.entries(prefilledFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));

  return {
    totalSets: sets.length,
    totalQuestions: allQ.length,
    totalRounds: meta.total_rounds,
    totalGenerated: meta.total_generated,
    totalAccepted: meta.total_accepted,
    acceptanceRate: meta.acceptance_rate,
    typeDistribution,
    chunkStats,
    prefilledTop,
    sets: sets.map((s) => ({
      set_id: s.set_id,
      questions: (s.questions || []).map((q) => ({
        id: q.id,
        prompt: q.prompt,
        answer: q.answer,
        chunks: q.chunks,
        prefilled: q.prefilled,
        distractor: q.distractor,
        has_question_mark: q.has_question_mark,
        grammar_points: q.grammar_points,
      })),
    })),
  };
}

// GET /api/admin/generate-bs/[jobId]
export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let headers;
  try {
    headers = ghHeaders();
  } catch (e) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const { jobId } = params;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    return Response.json({ error: `GitHub API 错误 ${res.status}` }, { status: res.status });
  }

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

  // 如果已完成且成功，尝试读取临时库文件
  if (r.status === "completed" && r.conclusion === "success") {
    try {
      const stagingFile = await getRepoFile(`data/buildSentence/staging/${jobId}.json`);
      if (stagingFile) {
        run.stats = computeStats(stagingFile.content);
        run.stagingReady = true;
      } else {
        // 文件不存在，可能已部署或删除
        run.stagingReady = false;
      }
    } catch (e) {
      run.statsError = e.message;
    }
  }

  return Response.json(run);
}
