import { isAdminAuthorized } from "../../../../../lib/adminAuth";

const { getRepoFile, deleteRepoFile } = require("../../../../../lib/githubApi");
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

// ── Topic novelty helpers ────────────────────────────────────────────────────
const TOPIC_STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being",
  "do","does","did","have","has","had","will","would","could","should",
  "what","how","when","where","who","whom","which","that","this",
  "to","of","and","or","but","for","with","from","about","into",
  "you","your","yours","i","me","my","he","she","they","them","their","it",
  "not","no","any","some","if","then","than","so","very","just",
  "tell","told","asked","ask","want","wanted","know","find","out",
  "say","said","wonder","wondering","need","needs",
]);

function extractTopicWords(q) {
  const text = [
    String(q.prompt_context || ""),
    String(q.prompt_task_text || q.prompt || ""),
    String(q.answer || ""),
  ].join(" ").toLowerCase().replace(/[^a-z\s]/g, " ");
  return new Set(text.split(/\s+/).filter((w) => w.length > 4 && !TOPIC_STOPWORDS.has(w)));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compute topic novelty score (0–100).
 *
 * When bankQuestions is provided (the existing deployed question bank):
 *   Cross-bank score = % of new questions that have max Jaccard < 0.35 vs every bank question.
 *   Within-batch score = % of new-question pairs with Jaccard < 0.4.
 *   Final = min(cross-bank, within-batch) — penalises if new Qs repeat each other OR the bank.
 *
 * When no bankQuestions (fallback):
 *   Returns within-batch pairwise score only (less meaningful).
 *
 * Thresholds: ≥90 优秀, 80–89 良好, 70–79 合格, <70 需改进.
 */
function computeNoveltyScore(questions, bankQuestions = []) {
  if (questions.length < 2) return 100;
  const wordSets = questions.map(extractTopicWords);

  // Within-batch: pairwise Jaccard < 0.4
  let novelPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      totalPairs++;
      if (jaccardSimilarity(wordSets[i], wordSets[j]) < 0.4) novelPairs++;
    }
  }
  const withinScore = totalPairs > 0 ? Math.round((novelPairs / totalPairs) * 100) : 100;

  if (bankQuestions.length === 0) return withinScore;

  // Cross-bank: each new question must be sufficiently distinct from every existing bank question
  const bankWordSets = bankQuestions.map(extractTopicWords);
  let crossNovel = 0;
  for (const ws of wordSets) {
    const maxSim = bankWordSets.reduce((m, bws) => Math.max(m, jaccardSimilarity(ws, bws)), 0);
    if (maxSim < 0.35) crossNovel++;
  }
  const crossScore = Math.round((crossNovel / questions.length) * 100);

  return Math.min(withinScore, crossScore);
}

function noveltyLabel(score) {
  if (score >= 90) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 70) return "合格";
  return "需改进";
}
// ─────────────────────────────────────────────────────────────────────────────

function computeStats(data, bankQuestions = []) {
  const sets = data.question_sets || [];
  const allQ = sets.flatMap((s) => s.questions || []);
  const meta = data._meta || {};
  const total = allQ.length || 1;

  // 题型分布（含百分比）
  const qmarkCount    = allQ.filter((q) => q.has_question_mark).length;
  const distractorCount = allQ.filter((q) => q.distractor != null).length;
  const embeddedCount = allQ.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
  const negationCount = allQ.filter((q) => isNegation(q.grammar_points)).length;
  const prefilledCount = allQ.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0).length;
  const typeDistribution = {
    hasQuestionMark: qmarkCount,
    hasDistractor: distractorCount,
    hasEmbedded: embeddedCount,
    hasNegation: negationCount,
    hasPrefilled: prefilledCount,
    pct: {
      hasQuestionMark: qmarkCount / total,
      hasDistractor: distractorCount / total,
      hasEmbedded: embeddedCount / total,
      hasNegation: negationCount / total,
      hasPrefilled: prefilledCount / total,
    },
  };

  // chunk 长度分布
  const allChunks = allQ.flatMap((q) =>
    (q.chunks || []).filter((c) => c !== q.distractor).map((c) => c.trim().split(/\s+/).filter(Boolean).length)
  );
  const effectiveChunkCounts = allQ.map((q) =>
    (q.chunks || []).filter((c) => c !== q.distractor).length
  );
  const multiWordCount = allChunks.filter((n) => n > 1).length;
  const chunkStats = {
    total: allChunks.length,
    avgWords: allChunks.length ? Number((allChunks.reduce((a, b) => a + b, 0) / allChunks.length).toFixed(2)) : 0,
    avgEffectiveChunks: effectiveChunkCounts.length
      ? Number((effectiveChunkCounts.reduce((a, b) => a + b, 0) / effectiveChunkCounts.length).toFixed(1))
      : 0,
    single: allChunks.filter((n) => n === 1).length,
    double: allChunks.filter((n) => n === 2).length,
    triple: allChunks.filter((n) => n === 3).length,
    multiWordCount,
    multiWordPct: allChunks.length ? multiWordCount / allChunks.length : 0,
  };

  // prefilled 长度分布（按题计算，每题 prefilled 的总词数）
  const prefilledWordCounts = allQ
    .filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0)
    .map((q) => q.prefilled.join(" ").trim().split(/\s+/).filter(Boolean).length);
  const pf1 = prefilledWordCounts.filter((n) => n === 1).length;
  const pf2 = prefilledWordCounts.filter((n) => n === 2).length;
  const pf3 = prefilledWordCounts.filter((n) => n >= 3).length;
  const pfTotal = prefilledWordCounts.length || 1;
  const prefilledLengthDist = { pf1, pf2, pf3, pf1Pct: pf1 / pfTotal, pf2Pct: pf2 / pfTotal, pf3Pct: pf3 / pfTotal };

  // prefilled 频次 Top 8
  const prefilledAll = allQ.flatMap((q) => q.prefilled || []);
  const prefilledFreq = {};
  prefilledAll.forEach((w) => { prefilledFreq[w] = (prefilledFreq[w] || 0) + 1; });
  const prefilledTop = Object.entries(prefilledFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));

  // 话题新颖度（跟现有题库交叉比较，bankQuestions 为空时降级为批次内比较）
  const noveltyScore = computeNoveltyScore(allQ, bankQuestions);

  return {
    totalSets: sets.length,
    totalQuestions: allQ.length,
    totalRounds: meta.total_rounds,
    totalGenerated: meta.total_generated,
    totalAccepted: meta.total_accepted,
    acceptanceRate: meta.acceptance_rate,
    noveltyScore,
    noveltyLabel: noveltyLabel(noveltyScore),
    typeDistribution,
    chunkStats,
    prefilledLengthDist,
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
        // 同时读取现有题库，用于跨库新颖度比较
        let bankQuestions = [];
        try {
          const bankFile = await getRepoFile("data/buildSentence/questions.json");
          if (bankFile) {
            bankQuestions = (bankFile.content.question_sets || []).flatMap((s) => s.questions || []);
          }
        } catch (_) {
          // 题库读取失败不影响主流程，降级为批次内新颖度
        }
        run.stats = computeStats(stagingFile.content, bankQuestions);
        run.stagingReady = true;
      } else {
        // 文件不存在，可能已部署或删除
        run.stagingReady = false;
      }
    } catch (e) {
      run.statsError = e.message;
    }
  }

  // 如果已完成但失败，尝试读取 state 文件获取失败原因
  if (r.status === "completed" && r.conclusion !== "success") {
    try {
      const stateFile = await getRepoFile(`data/buildSentence/staging/${jobId}.state.json`);
      if (stateFile?.content?.error) {
        run.failureReason = stateFile.content.error;
      }
    } catch (_) {}
  }

  return Response.json(run);
}

// PUT /api/admin/generate-bs/[jobId] — 发送优雅停止信号（创建 .stop 文件）
export async function PUT(request, { params }) {
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

  // First check if the job is still running
  const runUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}`;
  const runRes = await fetch(runUrl, { headers });
  if (runRes.ok) {
    const runData = await runRes.json();
    if (runData.status === "completed") {
      return Response.json({ ok: false, alreadyDone: true, message: "任务已完成，无需停止。" });
    }
  }

  // Create stop signal file via GitHub Contents API
  const filePath = `data/buildSentence/staging/${jobId}.stop`;
  const content = Buffer.from(JSON.stringify({ stoppedAt: new Date().toISOString(), requestedBy: "admin" })).toString("base64");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;

  // Check if file already exists (idempotent)
  const existRes = await fetch(url, { headers });
  if (existRes.status === 200) {
    return Response.json({ ok: true, alreadySent: true, message: "停止信号已发送，脚本将在当前轮次结束后停止并组题。" });
  }

  const putRes = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `chore: graceful stop signal for run ${jobId} [skip ci]`,
      content,
    }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    return Response.json({ error: `创建停止信号失败 ${putRes.status}: ${text}` }, { status: putRes.status });
  }

  return Response.json({ ok: true, message: "已发送优雅停止信号，脚本将在当前轮次结束后停止并保存已生成的题目。" });
}

// POST /api/admin/generate-bs/[jobId] — 取消正在运行的 workflow
export async function POST(request, { params }) {
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
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${jobId}/cancel`;
  const res = await fetch(url, { method: "POST", headers });

  // 202 = 取消请求已受理；409 = 任务已完成无需取消
  if (res.status === 202 || res.status === 409) {
    return Response.json({ ok: true, alreadyDone: res.status === 409 });
  }
  const text = await res.text();
  return Response.json({ error: `GitHub API 错误 ${res.status}: ${text}` }, { status: res.status });
}

// DELETE /api/admin/generate-bs/[jobId] — 删除 workflow run 记录（同时清理临时库文件）
export async function DELETE(request, { params }) {
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
  const res = await fetch(url, { method: "DELETE", headers });

  if (res.status !== 204) {
    const text = await res.text();
    return Response.json({ error: `GitHub API 错误 ${res.status}: ${text}` }, { status: res.status });
  }

  // 尝试同步清理临时库文件（失败不影响主流程）
  try {
    const stagingFile = await getRepoFile(`data/buildSentence/staging/${jobId}.json`);
    if (stagingFile) {
      await deleteRepoFile(
        `data/buildSentence/staging/${jobId}.json`,
        stagingFile.sha,
        `chore: discard staged BS questions (run ${jobId}) [skip ci]`
      );
    }
  } catch (_) {}

  return Response.json({ ok: true });
}
