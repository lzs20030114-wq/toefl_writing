const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");
const {
  getStructuredPromptParts,
  renderPromptFromParts,
  hasExplicitTaskInLegacyPrompt,
} = require("../lib/questionBank/buildSentencePromptContract");

const QUESTIONS_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function norm(text) {
  return String(text || "").trim();
}

function cleanLegacyContext(prompt) {
  let text = norm(prompt);
  text = text.replace(/\s+You reply:\s*$/i, "").trim();
  text = text.replace(/:\s*$/i, "").trim();
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

function inferAnswerType(answer, grammarPoints = []) {
  const a = norm(answer).toLowerCase();
  const gps = (Array.isArray(grammarPoints) ? grammarPoints : []).map((x) => String(x || "").toLowerCase()).join(" | ");
  if (
    /^(can you tell me|could you tell me|do you know|would you mind telling me|could you explain|can you remind me|could you let me know|can you let me know)\b/.test(a) ||
    /\b(interrogative frame|polite question frame)\b/.test(gps)
  ) return "interrogative";
  if (
    /\b(wanted to know|asked|inquired|wondered|was curious|were curious|needed to know|needed to find out|was wondering|were wondering)\b/.test(a) ||
    /\b(3rd-reporting|reporting verb|indirect question)\b/.test(gps)
  ) return "3rd-reporting";
  if (
    /\b(have no idea|had no idea|don't understand|didn't understand|do not understand|did not understand|found out|would love to know|can't decide|cannot decide|don't know|didn't know|do not know|did not know)\b/.test(a) ||
    /\b(1st-embedded)\b/.test(gps)
  ) return "1st-embedded";
  if (
    /\b(relative clause|contact clause)\b/.test(gps)
  ) return "relative";
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|is not|isn't|are not|aren't|has not|hasn't|do not|don't)\b/.test(a)) {
    return "negation";
  }
  return "direct";
}

function inferAnswerSubject(answer) {
  const m = norm(answer).match(/^(I|He|She|They|We|You|[A-Z][a-z]+)\b/);
  return m ? m[1] : "they";
}

function inferPerspective(prompt, answer) {
  const p = norm(prompt).toLowerCase();
  if (/^you\b|^you're\b|^your\b/.test(p)) return "you";
  const subject = inferAnswerSubject(answer);
  if (/^(I|You)$/i.test(subject)) return "you";
  if (/^(He|She|They)$/i.test(subject)) return subject.toLowerCase();
  return "they";
}

function inferReportTaskText(answer) {
  const subject = inferAnswerSubject(answer);
  const lower = norm(answer).toLowerCase();
  const actor =
    /^i$/i.test(subject) ? "you" :
    /^he$/i.test(subject) ? "he" :
    /^she$/i.test(subject) ? "she" :
    /^they$/i.test(subject) ? "they" :
    subject;

  if (/\b(asked|inquired)\b/.test(lower)) {
    if (actor === "he") return "What did he ask?";
    if (actor === "she") return "What did she ask?";
    if (actor === "you") return "What did you ask?";
    if (actor === "they") return "What did they ask?";
    return `What did ${actor} ask?`;
  }

  if (actor === "he") return "What did he want to know?";
  if (actor === "she") return "What did she want to know?";
  if (actor === "you") return "What did you want to know?";
  if (actor === "they") return "What did they want to know?";
  return `What did ${actor} want to know?`;
}

function inferPromptTask(question) {
  const prompt = norm(question.prompt);
  const answer = norm(question.answer);
  const type = inferAnswerType(answer, question.grammar_points);
  const perspective = inferPerspective(prompt, answer);

  if (type === "3rd-reporting") {
    return { kind: "report", text: inferReportTaskText(answer) };
  }

  if (type === "interrogative") {
    if (perspective === "you") return { kind: "ask", text: "What do you ask?" };
    if (perspective === "he") return { kind: "ask", text: "What does he ask?" };
    if (perspective === "she") return { kind: "ask", text: "What does she ask?" };
    return { kind: "ask", text: "What do they ask?" };
  }

  if (/\b(friend|roommate)\b/i.test(prompt)) {
    return { kind: "tell", text: "Tell your friend about it." };
  }

  if (perspective === "you") return { kind: "respond", text: "How do you respond?" };
  if (perspective === "he") return { kind: "respond", text: "How does he respond?" };
  if (perspective === "she") return { kind: "respond", text: "How does she respond?" };
  return { kind: "respond", text: "How do they respond?" };
}

const OVERRIDES = {
  ets_s2_q4: {
    context: "You are helping plan the park cleanup with other volunteers.",
    kind: "respond",
    text: "How do you respond?",
  },
  ets_s2_q7: {
    context: "The local librarian was helping a patron plan for the author's talk.",
    kind: "report",
    text: "What did she want to know?",
  },
  ets_s3_q5: {
    context: "The software developer was discussing the project's status with some colleagues.",
    kind: "report",
    text: "What did they want to know?",
  },
};

function migrateQuestion(question) {
  const parts = getStructuredPromptParts(question);
  if (parts.hasStructured) return question;
  if (hasExplicitTaskInLegacyPrompt(question.prompt)) return question;

  const override = OVERRIDES[question.id];
  const context = override?.context || cleanLegacyContext(question.prompt);
  const inferred = override || inferPromptTask(question);
  const taskKind = inferred.kind;
  const taskText = inferred.text;
  const prompt = renderPromptFromParts(context, taskText);

  return {
    ...question,
    prompt_context: context,
    prompt_task_kind: taskKind,
    prompt_task_text: taskText,
    prompt,
  };
}

function migrateQuestionsJson() {
  const bank = readJson(QUESTIONS_PATH);
  let changed = 0;
  bank.question_sets = (bank.question_sets || []).map((set) => ({
    ...set,
    questions: (set.questions || []).map((q) => {
      const next = migrateQuestion(q);
      if (next !== q) changed += 1;
      return next;
    }),
  }));
  writeJson(QUESTIONS_PATH, bank);
  return changed;
}

function migrateReserveJson() {
  const pool = readJson(RESERVE_PATH);
  let changed = 0;
  const next = (pool || []).map((q) => {
    const out = migrateQuestion(q);
    if (out !== q) changed += 1;
    return out;
  });
  writeJson(RESERVE_PATH, next);
  return changed;
}

const changedQuestions = migrateQuestionsJson();
const changedReserve = migrateReserveJson();

console.log(`updated questions.json items: ${changedQuestions}`);
console.log(`updated reserve_pool.json items: ${changedReserve}`);
