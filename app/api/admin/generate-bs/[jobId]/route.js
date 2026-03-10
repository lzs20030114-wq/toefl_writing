import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const { profileQuestionSetDifficulty } = require("../../../../../lib/questionBank/difficultyControl");
const { isEmbeddedQuestion, isNegation } = require("../../../../../lib/questionBank/etsProfile");

const JOBS_DIR = join(process.cwd(), "data", "buildSentence", "jobs");

function jobStatePath(jobId) {
  return join(JOBS_DIR, `${jobId}.json`);
}

function outputPath(jobId) {
  return join(JOBS_DIR, `${jobId}_output.json`);
}

function logPath(jobId) {
  return join(JOBS_DIR, `${jobId}_log.txt`);
}

function readJobState(jobId) {
  try {
    return JSON.parse(readFileSync(jobStatePath(jobId), "utf8"));
  } catch {
    return null;
  }
}

function readLog(jobId) {
  try {
    return readFileSync(logPath(jobId), "utf8");
  } catch {
    return "";
  }
}

function computeReport(sets) {
  const allQuestions = sets.flatMap((s) => s.questions || []);
  const diffProfile = profileQuestionSetDifficulty(allQuestions);

  const qmarkCount = allQuestions.filter((q) => q.has_question_mark).length;
  const distractorCount = allQuestions.filter((q) => q.distractor != null).length;
  const embeddedCount = allQuestions.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;
  const negationCount = allQuestions.filter((q) => isNegation(q.grammar_points)).length;
  const prefilledCount = allQuestions.filter((q) => Array.isArray(q.prefilled) && q.prefilled.length > 0).length;

  return {
    totalSets: sets.length,
    totalQuestions: allQuestions.length,
    difficulty: diffProfile.counts,
    typeDistribution: {
      hasQuestionMark: qmarkCount,
      hasDistractor: distractorCount,
      hasEmbeddedQuestion: embeddedCount,
      hasNegation: negationCount,
      hasPrefilled: prefilledCount,
    },
    sets: sets.map((s) => ({
      set_id: s.set_id,
      questions: (s.questions || []).map((q) => ({
        id: q.id,
        prompt: q.prompt,
        answer: q.answer,
        chunks: q.chunks,
        prefilled: q.prefilled,
        prefilled_positions: q.prefilled_positions,
        distractor: q.distractor,
        has_question_mark: q.has_question_mark,
        grammar_points: q.grammar_points,
      })),
    })),
  };
}

function parseStatsFromLog(log) {
  const rounds = [];
  const lines = log.split("\n");
  let totalGenerated = 0;
  let totalAccepted = 0;

  for (const line of lines) {
    const m = line.match(/round\s+(\d+).*?generated=(\d+).*?accepted=(\d+).*?rejected=(\d+)/i);
    if (m) {
      rounds.push({ round: Number(m[1]), generated: Number(m[2]), accepted: Number(m[3]), rejected: Number(m[4]) });
      totalGenerated += Number(m[2]);
      totalAccepted += Number(m[3]);
    }
  }

  return {
    rounds: rounds.length,
    totalGenerated,
    totalAccepted,
    acceptanceRate: totalGenerated > 0 ? Number((totalAccepted / totalGenerated).toFixed(3)) : 0,
  };
}

// GET /api/admin/generate-bs/[jobId] — poll job status + report
export async function GET(request, { params }) {
  if (!isAdminAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) return Response.json({ error: "Missing jobId" }, { status: 400 });

  const state = readJobState(jobId);
  if (!state) return Response.json({ error: "Job not found" }, { status: 404 });

  const log = readLog(jobId);
  const logStats = parseStatsFromLog(log);

  // Infer status from output file if state still says running
  let status = state.status;
  if (status === "running" && existsSync(outputPath(jobId))) {
    status = "done";
  }

  const result = { ...state, status, log, logStats };

  if (status === "done" && existsSync(outputPath(jobId))) {
    try {
      const outputData = JSON.parse(readFileSync(outputPath(jobId), "utf8"));
      const sets = outputData.question_sets || [];
      const startedAt = new Date(state.startedAt);
      const finishedAt = state.finishedAt ? new Date(state.finishedAt) : new Date();
      const elapsedSeconds = Math.round((finishedAt - startedAt) / 1000);
      result.report = {
        ...computeReport(sets),
        ...logStats,
        elapsedSeconds,
      };
    } catch (e) {
      result.reportError = e.message;
    }
  }

  return Response.json(result);
}
