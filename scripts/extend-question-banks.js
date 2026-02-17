const fs = require("fs");
const path = require("path");
const { validateQuestionSet } = require("../lib/questionBank/buildSentenceSchema");

const ROOT = path.resolve(__dirname, "..");
const EMAIL_PATH = path.join(ROOT, "data", "emailWriting", "prompts.json");
const DISC_PATH = path.join(ROOT, "data", "academicWriting", "prompts.json");
const BUILD_PATH = path.join(ROOT, "data", "buildSentence", "questions.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, data) {
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function capitalizeFirstSentenceFromChunks(chunks, punct = ".") {
  const raw = chunks.join(" ").replace(/\s+/g, " ").trim();
  if (!raw) return punct;
  let text = raw;
  if (/^i(\b|\s)/.test(text)) {
    text = `I${text.slice(1)}`;
  } else {
    text = text[0].toUpperCase() + text.slice(1);
  }
  return `${text}${punct}`;
}

function ensureUniqueId(existing, id) {
  if (existing.has(id)) throw new Error(`duplicate id: ${id}`);
  existing.add(id);
}

function chooseDistractor(chunks, candidates, fallback = "did") {
  const answerWords = new Set(
    chunks
      .join(" ")
      .toLowerCase()
      .replace(/[.,!?;:]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
  for (const c of candidates) {
    const w = String(c || "").toLowerCase().trim();
    if (!w) continue;
    if (!answerWords.has(w)) return w;
  }
  if (!answerWords.has(fallback)) return fallback;
  return "that";
}

function makeBuildQuestion({ id, prompt, chunks, grammar_points, hasQ = false, addDistractor = true, distractorPool = [] }) {
  const punct = hasQ ? "?" : ".";
  const answer = capitalizeFirstSentenceFromChunks(chunks, punct);
  const distractor = addDistractor ? chooseDistractor(chunks, distractorPool) : null;
  return {
    id,
    prompt,
    answer,
    chunks,
    prefilled: [],
    prefilled_positions: {},
    distractor,
    has_question_mark: hasQ,
    grammar_points,
  };
}

function generateBuildSet(setId) {
  const topicA = ["workshop", "tutorial", "seminar", "studio", "review session"][setId % 5];
  const topicB = ["rubric", "proposal", "timeline", "presentation", "dataset"][setId % 5];
  const place = ["in hall B", "in room 204", "in the main lab", "in the media center", "in the north building"][setId % 5];
  const team = ["our team", "the research group", "our section", "the lab group", "our committee"][setId % 5];

  const questions = [
    makeBuildQuestion({
      id: `ets_s${setId}_q1`,
      prompt: "Did the tutor share the materials after class?",
      chunks: ["the tutor", "shared", "the slides", "after class", "this morning"],
      grammar_points: ["simple past statement"],
      addDistractor: true,
      distractorPool: ["did", "about", "while"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q2`,
      prompt: "What did she ask about the session?",
      chunks: ["she wanted", "to know", "where", `the ${topicA}`, "would be held"],
      grammar_points: ["embedded question (wanted to know + where)"],
      addDistractor: true,
      distractorPool: ["did", "what", "then"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q3`,
      prompt: "Why did he miss the meeting?",
      chunks: ["he did not", "understand", "why", "the system", "was offline"],
      grammar_points: ["embedded question (understand + why)", "negation (did not)"],
      addDistractor: true,
      distractorPool: ["because", "did", "about"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q4`,
      prompt: "Was the draft ready before the deadline?",
      chunks: ["the draft", "was not", "ready", "before", "the deadline"],
      grammar_points: ["negation (was not)", "passive-style predicate"],
      addDistractor: false,
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q5`,
      prompt: "Did they receive any update from the professor?",
      chunks: ["they were wondering", "if", "the professor", "had changed", `the ${topicB}`],
      grammar_points: ["embedded question (wondering + if)", "past perfect"],
      addDistractor: true,
      distractorPool: ["did", "that", "because"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q6`,
      prompt: "What happened to the report last night?",
      chunks: ["the report", "was revised", "by", team, "last night"],
      grammar_points: ["passive voice (was revised)"],
      addDistractor: true,
      distractorPool: ["did", "are", "if"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q7`,
      prompt: "Can you explain his reaction in advising?",
      chunks: ["i have", "no idea", "what", "the advisor", "meant"],
      grammar_points: ["embedded question (have no idea + what)", "negation (no)"],
      addDistractor: true,
      distractorPool: ["did", "about", "then"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q8`,
      prompt: "Did the committee accept the submission?",
      chunks: ["she asked", "whether", "the proposal", "had been approved", "by the committee"],
      grammar_points: ["embedded question (asked + whether)", "passive voice (had been approved)"],
      addDistractor: true,
      distractorPool: ["did", "how", "about"],
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q9`,
      prompt: "How will this policy affect your grade?",
      chunks: ["the assignment", "will no longer", "count", "toward", "the final grade"],
      grammar_points: ["negation (no longer)", "future form"],
      addDistractor: false,
    }),
    makeBuildQuestion({
      id: `ets_s${setId}_q10`,
      prompt: "Where can we check the publishing schedule?",
      chunks: ["could you tell", "me", "when", "the results", "will be posted"],
      grammar_points: ["embedded question (could you tell + when)"],
      hasQ: true,
      addDistractor: true,
      distractorPool: ["do", "did", "about"],
    }),
  ];

  // tiny lexical variation per set to avoid repetitive duplicates
  questions[1].chunks[3] = `the ${topicA}`;
  questions[5].chunks[4] = setId % 2 === 0 ? "late last night" : "last night";
  questions[9].chunks[3] = setId % 2 === 0 ? "the final results" : "the results";

  // Recompute dependent answers after variation
  for (const q of questions) {
    const punct = q.has_question_mark ? "?" : ".";
    q.answer = capitalizeFirstSentenceFromChunks(q.chunks, punct);
    if (q.distractor) {
      q.distractor = chooseDistractor(q.chunks, [q.distractor, "did", "about", "then"]);
    }
  }

  return { set_id: setId, questions };
}

function generateEmailPrompts(startIdNum, count) {
  const topics = [
    ["computer lab reservation", "Technology Services Office", "weekend project access"],
    ["internship recommendation letter", "Career Center Advisor", "application deadline"],
    ["late tuition fee appeal", "Student Accounts Office", "payment plan options"],
    ["research assistant schedule", "Lab Coordinator", "exam-week conflict"],
    ["club funding request", "Student Activities Office", "community event budget"],
    ["language center appointment", "Language Center Director", "speaking assessment"],
    ["library noise complaint", "Library Operations Manager", "quiet-floor policy"],
    ["study-abroad housing", "Global Programs Staff", "arrival logistics"],
    ["missed quiz makeup", "Course Instructor", "documented illness"],
    ["volunteer hour verification", "Program Supervisor", "scholarship requirement"],
    ["campus shuttle route", "Transportation Office", "evening safety"],
    ["lab equipment access", "Department Technician", "time-sensitive experiment"],
    ["group project mediation", "Teaching Assistant", "workload imbalance"],
    ["transcript processing", "Registrar Office", "graduate application"],
    ["work-study schedule", "Campus Employer", "class-time overlap"],
  ];

  const items = [];
  for (let i = 0; i < count; i += 1) {
    const [subject, to, urgency] = topics[i % topics.length];
    const n = startIdNum + i;
    items.push({
      id: `em${n}`,
      scenario: `You are a university student dealing with ${subject}. A recent change has created an issue that may affect your academic plans, and you need clarification quickly regarding ${urgency}.`,
      direction: `Write an email to ${to}:`,
      goals: [
        `Clearly explain your current situation related to ${subject}`,
        "Ask two specific questions about policy, timeline, or next steps",
        "Propose a practical solution and explain why it would help",
      ],
      to,
      from: "You (student)",
    });
  }
  return items;
}

function generateDiscussionPrompts(startIdNum, count) {
  const themes = [
    "whether universities should prioritize practical job skills over broad liberal-arts learning",
    "whether attendance should count toward final grades in large lecture courses",
    "whether first-year students should be required to live on campus",
    "whether AI-assisted writing tools should be allowed in draft stages",
    "whether internships should be mandatory for graduation in applied majors",
    "whether campuses should replace printed textbooks with digital-only materials",
    "whether group projects should include anonymous peer scoring",
    "whether tuition discounts should reward early degree completion",
    "whether universities should cap class sizes in writing-intensive courses",
    "whether public speaking should be a general-education requirement",
    "whether undergraduates should be allowed to retake major-required exams",
    "whether campus jobs should prioritize financial-need applicants",
    "whether universities should adopt year-round trimester calendars",
    "whether students should be required to complete a service-learning course",
    "whether departments should publish grade distribution data every term",
  ];

  const items = [];
  for (let i = 0; i < count; i += 1) {
    const n = startIdNum + i;
    const theme = themes[i % themes.length];
    items.push({
      id: `ad${n}`,
      professor: {
        name: `Dr. Rivera-${n}`,
        text: `In this week's discussion, consider ${theme}. Supporters argue it improves fairness and outcomes, while critics argue it may reduce flexibility or increase pressure on students. State your position and explain your reasoning with specific support.`,
      },
      students: [
        {
          name: "Student A",
          text: "I support this policy because clear standards help students plan better and can improve accountability across courses.",
        },
        {
          name: "Student B",
          text: "I disagree because one policy cannot fit all departments, and strict rules can create unintended disadvantages for some learners.",
        },
      ],
    });
  }
  return items;
}

function qualityCheckEmail(items) {
  const ids = new Set();
  const scenarios = new Set();
  for (const x of items) {
    if (!x.id || ids.has(x.id)) throw new Error(`email id invalid/duplicate: ${x.id}`);
    ids.add(x.id);
    if (!x.scenario || x.scenario.length < 120) throw new Error(`email scenario too short: ${x.id}`);
    if (scenarios.has(x.scenario)) throw new Error(`duplicate email scenario: ${x.id}`);
    scenarios.add(x.scenario);
    if (!Array.isArray(x.goals) || x.goals.length !== 3) throw new Error(`email goals invalid: ${x.id}`);
  }
}

function qualityCheckDiscussion(items) {
  const ids = new Set();
  const topics = new Set();
  for (const x of items) {
    if (!x.id || ids.has(x.id)) throw new Error(`discussion id invalid/duplicate: ${x.id}`);
    ids.add(x.id);
    if (!x.professor?.text || x.professor.text.length < 140) throw new Error(`discussion prompt too short: ${x.id}`);
    if (topics.has(x.professor.text)) throw new Error(`duplicate discussion text: ${x.id}`);
    topics.add(x.professor.text);
    if (!Array.isArray(x.students) || x.students.length < 2) throw new Error(`discussion students invalid: ${x.id}`);
  }
}

function qualityCheckBuild(sets) {
  const idSet = new Set();
  for (const set of sets) {
    for (const q of set.questions || []) {
      if (idSet.has(q.id)) throw new Error(`duplicate build id: ${q.id}`);
      idSet.add(q.id);
    }
    const v = validateQuestionSet(set);
    if (!v.ok) {
      throw new Error(`build set ${set.set_id} failed: ${v.errors.join(" | ")}`);
    }
  }
}

function main() {
  const email = readJson(EMAIL_PATH);
  const disc = readJson(DISC_PATH);
  const build = readJson(BUILD_PATH);

  const emailIdSet = new Set(email.map((x) => x.id));
  const discIdSet = new Set(disc.map((x) => x.id));
  const buildSetIdSet = new Set((build.question_sets || []).map((s) => s.set_id));

  const existingEmailNums = email
    .map((x) => Number(String(x.id || "").replace(/^em/, "")))
    .filter((n) => Number.isFinite(n));
  const existingDiscNums = disc
    .map((x) => Number(String(x.id || "").replace(/^ad/, "")))
    .filter((n) => Number.isFinite(n));

  const nextEmail = (existingEmailNums.length ? Math.max(...existingEmailNums) : 0) + 1;
  const nextDisc = (existingDiscNums.length ? Math.max(...existingDiscNums) : 0) + 1;

  const newEmail = generateEmailPrompts(nextEmail, 15);
  const newDisc = generateDiscussionPrompts(nextDisc, 15);

  newEmail.forEach((x) => ensureUniqueId(emailIdSet, x.id));
  newDisc.forEach((x) => ensureUniqueId(discIdSet, x.id));

  qualityCheckEmail(newEmail);
  qualityCheckDiscussion(newDisc);

  const currentSetIds = (build.question_sets || []).map((s) => Number(s.set_id)).filter(Number.isFinite);
  let startSetId = currentSetIds.length ? Math.max(...currentSetIds) + 1 : 1;
  const newBuildSets = [];
  for (let i = 0; i < 15; i += 1) {
    while (buildSetIdSet.has(startSetId)) startSetId += 1;
    const set = generateBuildSet(startSetId);
    buildSetIdSet.add(startSetId);
    newBuildSets.push(set);
    startSetId += 1;
  }

  qualityCheckBuild(newBuildSets);

  const mergedEmail = [...email, ...newEmail];
  const mergedDisc = [...disc, ...newDisc];
  const mergedBuild = {
    ...build,
    generated_at: new Date().toISOString(),
    question_sets: [...(build.question_sets || []), ...newBuildSets],
  };

  writeJson(EMAIL_PATH, mergedEmail);
  writeJson(DISC_PATH, mergedDisc);
  writeJson(BUILD_PATH, mergedBuild);

  console.log(`email added: ${newEmail.length}, total: ${mergedEmail.length}`);
  console.log(`discussion added: ${newDisc.length}, total: ${mergedDisc.length}`);
  console.log(`build sets added: ${newBuildSets.length}, total sets: ${mergedBuild.question_sets.length}`);
}

main();
