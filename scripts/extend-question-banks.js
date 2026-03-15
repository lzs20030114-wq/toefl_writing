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
  // Topics across 6 categories matching TPO distribution:
  // ~30% academic, ~20% workplace, ~15% community, ~15% peer, ~10% consumer, ~10% housing
  const topics = [
    // Academic (student→professor/staff)
    { scenario: "Your professor moved the final exam date forward by a week, and you already have two other exams that day. You need to discuss options.", to: "Professor Lane", subject: "Final exam date conflict", goals: ["Explain the scheduling conflict you are facing", "Ask whether an alternative exam time is available", "Propose a specific solution that would work for you"] },
    { scenario: "You completed an online certification relevant to your major and would like to receive course credit for it. Your department has a petition process for transfer credit.", to: "Dr. Navarro", subject: "Request for transfer credit", goals: ["Describe the certification you completed and its relevance", "Ask about the petition process and required documentation", "Explain why receiving credit would benefit your academic plan"] },
    { scenario: "You are interested in becoming a teaching assistant for an introductory biology course next semester. The application requires a faculty recommendation.", to: "Professor Grant", subject: "Teaching assistant application", goals: ["Express your interest in the TA position and explain your qualifications", "Ask about the recommendation process and timeline", "Mention specific experiences that make you a good candidate"] },
    { scenario: "Your study-abroad program requires pre-approval of courses to count toward your degree. You need your academic advisor to review your proposed course list before the enrollment deadline.", to: "Academic Advisor", subject: "Study-abroad course approval", goals: ["List the courses you plan to take abroad and their equivalents", "Ask which courses will count toward your major requirements", "Request a meeting to finalize your plan before the deadline"] },
    // Workplace/Professional
    { scenario: "Your team recently switched to a new scheduling software, and you are having trouble accessing the shared calendar. Several of your shifts next week may be incorrect.", to: "Manager, Rachel", subject: "Scheduling software access issue", goals: ["Describe the technical problem you are experiencing", "Explain which shifts may be affected", "Ask for help resolving the issue before next week"] },
    { scenario: "You completed a summer internship at a design firm and want to stay in touch with your supervisor. You also noticed a junior designer opening posted on their website.", to: "Ms. Thornton", subject: "Thank you and follow-up from internship", goals: ["Thank her for the mentorship during your internship", "Mention specific skills or projects that were valuable to you", "Ask about the junior designer position and the application process"] },
    { scenario: "Your coworker, Ryan, covered your shifts while you were sick last week. You want to thank him and offer to return the favor during his upcoming vacation.", to: "Ryan", subject: "Thanks for covering my shifts", goals: ["Thank him for covering your shifts and acknowledge the inconvenience", "Describe how you are feeling now and that you are back to full capacity", "Offer to cover his shifts during his vacation next month"] },
    // Community/Civic
    { scenario: "The city council is considering removing a popular bike lane near your neighborhood to add more parking. You want to voice your opinion at the next meeting but cannot attend in person.", to: "City Council Office", subject: "Comment on proposed bike lane removal", goals: ["State your position on the bike lane proposal", "Explain how the bike lane benefits the community with specific examples", "Ask how to submit a written comment for the public record"] },
    { scenario: "You recently volunteered at a community food bank and noticed that the sorting process was inefficient, causing long wait times for families. You have an idea for improvement.", to: "Mr. Ortiz", subject: "Suggestion for food bank operations", goals: ["Thank the organization for the opportunity to volunteer", "Describe the issue you observed with the sorting process", "Propose a specific improvement and explain how it could help"] },
    { scenario: "Your apartment building's recycling program has been inconsistent, with bins often overflowing or not collected on time. You want to bring this to the building management's attention.", to: "Building Management", subject: "Recycling collection issues", goals: ["Describe the recycling problems you have observed", "Explain how the situation affects residents in the building", "Suggest a solution such as a revised collection schedule"] },
    // Personal/Peer
    { scenario: "Your classmate, Mia, lent you her notes while you were absent for a week. You passed the midterm thanks to her help, and you want to do something to thank her.", to: "Mia", subject: "Thank you for the notes", goals: ["Thank her for lending you her notes and explain how they helped", "Share your midterm result and give her credit for your success", "Offer to help her with something in return"] },
    { scenario: "You and your friend, Lucas, planned a weekend hiking trip, but the weather forecast shows heavy rain. You need to discuss whether to reschedule or find an indoor alternative.", to: "Lucas", subject: "Weekend hiking trip — weather update", goals: ["Explain the weather situation and why the original plan may not work", "Suggest an alternative activity or a new date for the hike", "Ask for his preference and availability"] },
    // Consumer/Service
    { scenario: "You booked a hotel room online for a family visit, but the confirmation email shows the wrong dates. The hotel's phone line has been busy, and you need to fix this before the cancellation policy deadline.", to: "Hotel Reservations", subject: "Booking date correction needed", goals: ["Describe the booking error and provide your reservation number", "Explain the urgency due to the cancellation policy deadline", "Request the correct dates and ask for a confirmation update"] },
    // Housing
    { scenario: "You share an apartment with a roommate, and the landlord has informed you that rent will increase next month. You want to discuss how to handle the change with your roommate, Alex.", to: "Alex", subject: "Rent increase next month", goals: ["Inform your roommate about the rent increase and the new amount", "Discuss how to split the additional cost fairly", "Suggest scheduling a time to talk about it in person"] },
    { scenario: "The elevator in your apartment building has been out of service for over a week, and you live on the eighth floor. You have a medical condition that makes climbing stairs difficult.", to: "Property Management Office", subject: "Elevator out of service — urgent repair needed", goals: ["Describe how long the elevator has been broken", "Explain how the situation is affecting you personally", "Request a repair timeline and ask about interim accommodations"] },
  ];

  const items = [];
  for (let i = 0; i < count; i += 1) {
    const t = topics[i % topics.length];
    const n = startIdNum + i;
    items.push({
      id: `em${n}`,
      scenario: t.scenario,
      direction: `Write an email to ${t.to}. In your email, do the following:`,
      goals: t.goals,
      to: t.to,
      subject: t.subject,
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
