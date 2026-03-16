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
  // 15 templates across 6 categories, TPO-aligned format:
  // Scenario: 35-45 words, opens with "You are…"/"You recently…"/"Your [person]…"
  // Goals: 3 distinct verbs, no modifiers, no numbers
  const topics = [
    // Academic (4)
    { scenario: "You are a student in Professor Lane's history course. Your professor recently moved the final exam date forward by one week, and you already have two other exams scheduled for that same day. You need to find a solution.", to: "Professor Lane", subject: "Final exam date conflict", goals: ["Explain the scheduling conflict you are facing", "Ask whether an alternative exam time is available", "Suggest a solution that could work for both of you"] },
    { scenario: "You recently completed an online data-science certification that is closely related to your major. Your department allows students to petition for transfer credit, and the enrollment deadline for next semester is approaching. You want to make sure the credits will count.", to: "Dr. Navarro", subject: "Request for transfer credit", goals: ["Describe the certification you completed and how it relates to your coursework", "Ask about the petition process and what documents you need", "Explain why receiving credit would help your academic plan"] },
    { scenario: "You are a junior majoring in biology and are interested in becoming a teaching assistant for an introductory course next semester. The application requires a recommendation from a faculty member, and the deadline is in two weeks.", to: "Professor Grant", subject: "Teaching assistant application", goals: ["Express your interest in the position and why you are a good fit", "Ask about the recommendation process and timeline", "Mention experiences that have prepared you for the role"] },
    { scenario: "Your study-abroad program requires pre-approval of courses before they can count toward your degree. You have put together a list of courses and need your advisor to review them before the enrollment deadline next Friday.", to: "Academic Advisor", subject: "Study-abroad course approval", goals: ["Describe the courses you plan to take abroad and their local equivalents", "Ask which ones will count toward your major requirements", "Suggest a time to meet and finalize the plan"] },
    // Workplace (3)
    { scenario: "Your team recently switched to a new scheduling software, and you are having trouble accessing the shared calendar. You have noticed that several of your shifts for next week appear to be listed at the wrong times.", to: "Rachel", subject: "Scheduling software access issue", goals: ["Describe the technical problem you are experiencing", "Explain which shifts may be affected", "Ask for help resolving the issue before next week"] },
    { scenario: "You recently completed a summer internship at a design firm and want to stay in touch with your supervisor. You also noticed a junior designer opening posted on the company's website that interests you.", to: "Ms. Thornton", subject: "Thank you and follow-up from internship", goals: ["Thank her for the mentorship during your internship", "Mention skills or projects that were valuable to you", "Ask about the junior designer position and how to apply"] },
    { scenario: "Your coworker, Ryan, covered your shifts while you were sick last week. You are feeling better now and want to thank him. His vacation is coming up next month, and you would like to return the favor.", to: "Ryan", subject: "Thanks for covering my shifts", goals: ["Thank him for covering your shifts while you were out", "Describe how you are doing now", "Offer to cover his shifts during his vacation"] },
    // Community (3)
    { scenario: "You are a resident in a neighborhood where the city council is considering removing a popular bike lane to add more parking. You want to share your opinion but cannot attend the next council meeting in person.", to: "City Council Office", subject: "Comment on proposed bike lane removal", goals: ["Describe your position on the bike lane proposal", "Explain how the bike lane benefits the community", "Ask how to submit a written comment for the public record"] },
    { scenario: "You recently volunteered at a community food bank and noticed that the food-sorting process was slow, causing long wait times for families picking up their orders. You have an idea that could help improve the workflow and reduce waiting.", to: "Mr. Ortiz", subject: "Suggestion for food bank operations", goals: ["Thank the organization for the opportunity to volunteer", "Describe the issue you observed with the sorting process", "Suggest an improvement and explain how it could help"] },
    { scenario: "You are a resident of an apartment building where the recycling bins have been overflowing for several weeks. The collection schedule does not seem to match the amount of waste residents produce, and the area has become unpleasant.", to: "Building Management", subject: "Recycling collection issues", goals: ["Describe the recycling problems you have observed", "Explain how the situation is affecting residents", "Suggest a change to the collection schedule"] },
    // Personal/Peer (2)
    { scenario: "Your classmate, Mia, lent you her notes while you were absent from class for a week. You recently took the midterm and did well, largely because of her help. You want to find a way to thank her.", to: "Mia", subject: "Thank you for the notes", goals: ["Thank her for lending you her notes and explain how they helped", "Tell her about your midterm result", "Offer to help her with something in return"] },
    { scenario: "Your friend, Lucas, and you have been planning a weekend hiking trip for several weeks. You just checked the weather forecast, and it shows heavy rain for both Saturday and Sunday. You need to decide what to do.", to: "Lucas", subject: "Weekend hiking trip and weather", goals: ["Explain the weather situation and why the original plan may not work", "Suggest an alternative activity or a new date", "Ask for his preference and availability"] },
    // Consumer (1)
    { scenario: "You recently booked a hotel room online for a family visit, but the confirmation email shows the wrong check-in and check-out dates. The hotel's phone line has been busy, and the cancellation policy deadline is approaching.", to: "Hotel Reservations", subject: "Booking date correction needed", goals: ["Describe the booking error and provide your reservation details", "Explain why you need the issue resolved quickly", "Ask how to get the dates corrected and receive an updated confirmation"] },
    // Housing (2)
    { scenario: "Your roommate, Alex, and you share an apartment near campus. Your landlord recently sent a notice saying the rent will increase by fifteen percent starting next month. You want to talk about how to handle the extra cost.", to: "Alex", subject: "Rent increase next month", goals: ["Tell your roommate about the rent increase and the new amount", "Explain how you think the additional cost should be handled", "Suggest a time to sit down and discuss it together"] },
    { scenario: "You are a resident on the eighth floor of an apartment building. The elevator has been out of service for over a week, and you have a medical condition that makes climbing stairs difficult.", to: "Property Management Office", subject: "Elevator repair needed", goals: ["Describe how long the elevator has been out of service", "Explain how the situation is affecting you personally", "Ask for a repair timeline and whether any temporary arrangement is available"] },
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
