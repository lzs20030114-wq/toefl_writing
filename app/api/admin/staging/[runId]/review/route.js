import { isAdminAuthorized } from "../../../../../../lib/adminAuth";

const { getRepoFile } = require("../../../../../../lib/githubApi");

// 介词碎片 chunk 模式：如 "of the", "in the", "at a" 等
const PREP_FRAGMENT = /^(of|in|at|for|on|to|by|with|from|into|after|before|during|about|all|per)\s+(the|a|an|our|your|their|his|her|my|its)\b/i;

// 不应单独成 chunk 的时间/频率副词
const STANDALONE_ADVERBS = new Set([
  "yesterday","today","tomorrow","recently","finally","always","often",
  "sometimes","probably","eventually","suddenly","already","usually",
  "still","again","now","soon","later","early","just","once","twice",
]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runReview(data) {
  const sets = data.question_sets || [];
  const allQ = sets.flatMap((s) => s.questions || []);

  // ── Check 1: ask/report/respond 带非空 prompt_context ────────────────────
  const contextViolations = allQ
    .filter((q) =>
      ["ask", "report", "respond", "yesno", "statement"].includes(q.prompt_task_kind) &&
      String(q.prompt_context || "").trim() !== ""
    )
    .map((q) => ({
      id: q.id,
      kind: q.prompt_task_kind,
      context: q.prompt_context,
      taskText: q.prompt_task_text,
    }));

  // ── Check 2: 独立 "not" chunk ─────────────────────────────────────────────
  const standaloneNot = allQ
    .filter((q) =>
      (q.chunks || [])
        .filter((c) => c !== q.distractor)
        .some((c) => c.trim().toLowerCase() === "not")
    )
    .map((q) => ({ id: q.id, answer: q.answer, chunks: q.chunks }));

  // ── Check 3: 介词碎片 chunk ───────────────────────────────────────────────
  const prepFragments = allQ
    .filter((q) =>
      (q.chunks || [])
        .filter((c) => c !== q.distractor)
        .some((c) => PREP_FRAGMENT.test(c.trim()))
    )
    .map((q) => ({
      id: q.id,
      answer: q.answer,
      badChunks: (q.chunks || []).filter(
        (c) => c !== q.distractor && PREP_FRAGMENT.test(c.trim())
      ),
    }));

  // ── Check 4: 结构重复（同一 distractor 出现 3+ 次）──────────────────────
  const distractorGroups = {};
  allQ.forEach((q) => {
    if (q.distractor) {
      const key = q.distractor.toLowerCase().trim();
      if (!distractorGroups[key]) distractorGroups[key] = [];
      distractorGroups[key].push(q.id);
    }
  });
  const repetition = Object.entries(distractorGroups)
    .filter(([, ids]) => ids.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([distractor, ids]) => ({ distractor, count: ids.length, ids }));

  // ── Check 5: distractor 出现在 answer 里（答案本身用错）──────────────────
  const answerErrors = allQ
    .filter(
      (q) =>
        q.distractor &&
        new RegExp(`\\b${escapeRegex(q.distractor)}\\b`, "i").test(q.answer)
    )
    .map((q) => ({ id: q.id, answer: q.answer, distractor: q.distractor }));

  // ── Check 6: 独立时间/频率副词 chunk ─────────────────────────────────────
  const standaloneAdverbs = allQ
    .filter((q) =>
      (q.chunks || [])
        .filter((c) => c !== q.distractor)
        .some(
          (c) =>
            c.trim().split(/\s+/).length === 1 &&
            STANDALONE_ADVERBS.has(c.trim().toLowerCase())
        )
    )
    .map((q) => ({
      id: q.id,
      answer: q.answer,
      badChunks: (q.chunks || []).filter(
        (c) =>
          c !== q.distractor &&
          c.trim().split(/\s+/).length === 1 &&
          STANDALONE_ADVERBS.has(c.trim().toLowerCase())
      ),
    }));

  const totalIssues =
    contextViolations.length +
    standaloneNot.length +
    prepFragments.length +
    answerErrors.length +
    standaloneAdverbs.length;

  return {
    total: allQ.length,
    totalIssues,
    checks: {
      contextViolations: { count: contextViolations.length, items: contextViolations },
      standaloneNot:     { count: standaloneNot.length,     items: standaloneNot },
      prepFragments:     { count: prepFragments.length,     items: prepFragments },
      repetition:        { count: repetition.length,        items: repetition },
      answerErrors:      { count: answerErrors.length,       items: answerErrors },
      standaloneAdverbs: { count: standaloneAdverbs.length,  items: standaloneAdverbs },
    },
  };
}

// GET /api/admin/staging/[runId]/review
export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = params;
  try {
    const file = await getRepoFile(`data/buildSentence/staging/${runId}.json`);
    if (!file) return Response.json({ error: "临时库文件不存在" }, { status: 404 });
    return Response.json(runReview(file.content));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
