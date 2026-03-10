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
 * Metric: percentage of question pairs with Jaccard similarity < 0.4.
 * (Avg-based score was misleading — rare high-similarity pairs got drowned out.)
 * Thresholds: ≥90 优秀, 80–89 良好, 70–79 合格, <70 需改进.
 */
function computeNoveltyScore(questions) {
  if (questions.length < 2) return 100;
  const wordSets = questions.map(extractTopicWords);
  let novelPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      totalPairs++;
      if (jaccardSimilarity(wordSets[i], wordSets[j]) < 0.4) novelPairs++;
    }
  }
  return totalPairs > 0 ? Math.round((novelPairs / totalPairs) * 100) : 100;
}

function noveltyLabel(score) {
  if (score >= 90) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 70) return "合格";
  return "需改进";
}
// ─────────────────────────────────────────────────────────────────────────────

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

  // 话题新颖度
  const noveltyScore = computeNoveltyScore(allQ);

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
