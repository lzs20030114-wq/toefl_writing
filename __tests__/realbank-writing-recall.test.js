/**
 * 第一来源邮件 / 学术讨论补录（scripts/realbank/writing_recall.js + data/realBank/writing-recall.json）。
 *
 * 这条补录两头都贵：
 *   · 判松了 —— 串卷 / 编造的题面当真题上线；同一道题换个卷名收三遍（52 套里邮件只有 33 道不同的题）；
 *     补录插到老题前面，前端「第 N 套」整体漂移、改了 id 的老题练习记录失联；
 *   · 判紧了 —— 又回到 2026-09-14 之前：第一来源 52 套一道邮件 / 讨论都进不了库。
 * 两侧都锁死。
 */
const fs = require("fs");
const path = require("path");
const W = require("../scripts/realbank/writing_recall.js");

const LEDGER_PATH = path.join(__dirname, "..", "data", "realBank", "writing-recall.json");

const GT_EMAIL = {
  id: "2026-01-21_email", source: "1.21新托福真题A卷", recipient: "Mr. Thompson",
  subject: "Request for apartment repairs",
  scenario: "You are a university student who has recently moved into a new apartment. You have noticed some issues "
    + "with the apartment. You want to inform your landlord, Mr. Thompson, about these problems.",
  bullets: [
    "Describe the issues you have encountered in the apartment.",
    "Explain how conditions negatively affect your studies.",
    "Request that he make arrangements to address these issues soon.",
  ],
};

const POST = "We've been discussing corporate responsibility. Some people believe that companies should be fully "
  + "transparent about their operations, while others think certain information should stay private to protect "
  + "their competitive position. Do you think corporate transparency is essential, or should some information be "
  + "kept confidential? Why?";
const QUESTION = "Do you think corporate transparency is essential, or should some information be kept confidential? Why?";
const STUDENTS = [
  { name: "Claire", text: "I think corporate transparency is essential. It builds trust with consumers and stakeholders "
    + "and demonstrates a company's commitment to ethical practices." },
  { name: "Paul", text: "In my opinion, certain information should be confidential to protect competitive advantages. "
    + "Businesses need to safeguard proprietary information and strategic plans." },
];
const disc = (over = {}) => W.discussionShape({
  course: "business ethics", professor: { name: "Dr. Achebe", text: POST }, students: STUDENTS, ...over,
});

describe("形状：realExam2026 → 真题专区条目", () => {
  test("邮件：收件人 → to，bullets → goals，direction 按原卷那句补上（前端没有 direction 的整条不显示）", () => {
    const e = W.emailFromGt(GT_EMAIL);
    expect(e.to).toBe("Mr. Thompson");
    expect(e.goals).toHaveLength(3);
    expect(e.direction).toBe("Write an email to Mr. Thompson.");
    expect(W.emailProblems(e)).toEqual([]);
  });

  test("邮件：账本里已经是库形状（to / goals）也认得，重复映射结果不变", () => {
    const once = W.emailFromGt(GT_EMAIL);
    expect(W.emailFromGt(once)).toEqual(once);
  });

  test("邮件：对着原卷转写的指令句（带收件人身份）优先，不被「Write an email to X.」模板盖掉", () => {
    const dir = "Write an email to the lost and found manager, Ms. Davis.";
    const e = W.emailFromGt({ ...GT_EMAIL, recipient: "Ms. Davis", direction: dir });
    expect(e.direction).toBe(dir);
    expect(W.emailFromGt(e).direction).toBe(dir);
  });

  test("排版归一：截图转写的弯撇号 / 双空格 → 与库里现有题一致的直撇号、单空格（字不动）", () => {
    const d = W.discussionShape({ course: "psychology", professor: { name: "Dr. Gupta", text: "We’ve been discussing  memory." }, students: [] });
    expect(d.professor.text).toBe("We've been discussing memory.");
    expect(W.emailFromGt({ ...GT_EMAIL, subject: "Sarah’s  party" }).subject).toBe("Sarah's party");
  });

  test("讨论：课程名从左栏那句取，大小写照原卷", () => {
    expect(W.courseFromLine("Your professor is teaching a class on art history.")).toBe("art history");
    expect(W.courseFromLine("Your professor is teaching a class on business ethics")).toBe("business ethics");
    expect(W.courseFromLine("Your professor is teaching a course on social psychology.")).toBe("social psychology");
    expect(W.courseFromLine("Your professor is teaching an art history class.")).toBe("art history");
    expect(W.courseFromLine("[?]")).toBe("");
    expect(W.courseFromLine("Write a post responding to the professor's question.")).toBe("");
  });
});

describe("结构闸", () => {
  test("邮件：缺收件人 / 缺主题 / 要求不是 3 条 / 情境过短 都拦", () => {
    const e = W.emailFromGt(GT_EMAIL);
    expect(W.emailProblems({ ...e, to: "", direction: "" }).join()).toMatch(/缺收件人/);
    expect(W.emailProblems({ ...e, subject: "" }).join()).toMatch(/缺主题/);
    expect(W.emailProblems({ ...e, goals: e.goals.slice(0, 2) }).join()).toMatch(/不是 3 条/);
    expect(W.emailProblems({ ...e, scenario: "You are a student." }).join()).toMatch(/情境过短/);
  });

  test("混中文 / 水印 / 看不清的 [?] 占位 / U+FFFD 都不许上线", () => {
    const e = W.emailFromGt(GT_EMAIL);
    expect(W.emailProblems({ ...e, subject: "Request 闲鱼" }).join()).toMatch(/水印|中文/);
    expect(W.emailProblems({ ...e, goals: [e.goals[0], "Explain how [?] affect your studies.", e.goals[2]] }).join()).toMatch(/\[\?\]/);
    expect(W.emailProblems({ ...e, scenario: `${e.scenario} caf�` }).join()).toMatch(/FFFD/);
  });

  test("讨论：完整的一道题零问题", () => {
    expect(W.discussionProblems(disc(), QUESTION)).toEqual([]);
  });

  test("讨论：教授发言只有提问句（旧抽取的原样）→ 拦下，这正是要回原卷找原话的那批", () => {
    const p = W.discussionProblems(disc({ professor: { name: "Dr. Achebe", text: QUESTION } }), QUESTION);
    expect(p.join()).toMatch(/教授发言过短/);
  });

  test("讨论：整段原话里找不到已抽到的提问句 → 疑似配错卷", () => {
    const other = "We've been discussing urban planning. Some argue that cities should invest in public transport, "
      + "while others think roads matter more for commuters and businesses. Which should cities prioritize? Why?";
    const p = W.discussionProblems(disc({ professor: { name: "Dr. Gupta", text: other } }), QUESTION);
    expect(p.join()).toMatch(/配错卷/);
  });

  test("讨论：学生帖不足 2 条 / 缺署名 / 被截断 都拦", () => {
    expect(W.discussionProblems(disc({ students: STUDENTS.slice(0, 1) }), QUESTION).join()).toMatch(/不足 2 条/);
    expect(W.discussionProblems(disc({ students: [STUDENTS[0], { name: "", text: STUDENTS[1].text }] }), QUESTION).join())
      .toMatch(/缺署名/);
    expect(W.discussionProblems(disc({ students: [STUDENTS[0], { name: "Paul", text: "In my opinion, certain information." }] }), QUESTION).join())
      .toMatch(/截断/);
  });
});

describe("OCR 覆盖率闸（连续三词）", () => {
  // OCR 的典型形态：单词粘连 + 夹着界面文字
  const OCR = W.glue(
    "Hide Time 00:06:12 You are a university student who has recently moved into a new apartment. You Your Response:\n"
    + "havenoticedsomeissueswiththeapartment.Youwantto informyourlandlord,\nMr. Thompson, about these problems. "
    + "To: Mr. Thompson Subject:Requestforapartment repairs\n. Describetheissuesyouhave encountered inthe apartment.\n"
    + ".Explain how conditions negatively affect your studies. Request that he make arrangements to address these issues soon.",
  );

  test("忠实转写（哪怕 OCR 粘连成一串）→ 放行", () => {
    const v = W.ocrVerdict(W.emailFields(W.emailFromGt(GT_EMAIL)), OCR);
    expect(v.ok).toBe(true);
    expect(v.ratio).toBeGreaterThan(0.9);
  });

  test("某一条要求整句是编的（整体被别的字段拉高也不行）→ 拦", () => {
    const e = W.emailFromGt(GT_EMAIL);
    const fake = { ...e, goals: [e.goals[0], "Propose that the building hires a full time maintenance manager for tenants.", e.goals[2]] };
    const v = W.ocrVerdict(W.emailFields(fake), OCR);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toMatch(/goals\[1\]/);
  });

  test("串了别的卷（整道题都对不上）→ 拦", () => {
    const other = W.emailFromGt({
      recipient: "Emma", subject: "Request for volunteering at charity event",
      scenario: "You are organizing a charity event at your university to raise funds for a local animal shelter. "
        + "You need volunteers to help with various tasks.",
      bullets: ["Describe the event and its purpose.", "Explain what tasks you need help with.", "Ask her whether she can join."],
    });
    const v = W.ocrVerdict(W.emailFields(other), OCR);
    expect(v.ok).toBe(false);
    expect(v.ratio).toBeLessThan(W.OCR_TRIGRAM_MIN);
  });
});

describe("同一道题判等", () => {
  test("邮件：同一道题（换卷、标点大小写不同）→ 同；话题相近的两道不同题 → 不同", () => {
    const a = W.emailFromGt(GT_EMAIL);
    const b = { ...a, scenario: a.scenario.toUpperCase().replace(/\./g, ""), subject: "request for apartment repairs" };
    expect(W.sameEmail(a, b)).toBe(true);
    const notes1 = W.emailFromGt({ recipient: "Jessica", subject: "Request for class notes",
      scenario: "You are a student who missed a recent class. You want to ask your classmate, Jessica, for her notes and any important details from the class.",
      bullets: ["Explain why you missed the class.", "Ask for her notes.", "Suggest what you could do in return."] });
    const notes2 = W.emailFromGt({ recipient: "Professor Lee", subject: "Missed lab session",
      scenario: "You missed a chemistry lab session because of a family emergency. You want to ask your professor whether you can make up the experiment later this week.",
      bullets: ["Explain why you missed the lab.", "Ask about a make-up session.", "Offer to complete extra work."] });
    expect(W.sameEmail(notes1, notes2)).toBe(false);
  });

  test("讨论：整段原话相同 → 同；一边只有提问句、另一边是含这句的整段 → 同；不同题 → 不同", () => {
    expect(W.sameDiscussion(disc(), disc())).toBe(true);
    expect(W.sameDiscussion(disc({ professor: { name: "Dr. Achebe", text: QUESTION } }), disc())).toBe(true);
    const other = disc({ professor: { name: "Dr. Gupta", text: "We've been discussing social media. Some think it connects people, "
      + "while others worry it isolates them. Do you think social media has a more positive or negative impact on society? Why?" } });
    expect(W.sameDiscussion(disc(), other)).toBe(false);
  });
});

describe("写作整科被扣时补录收不收（recallAllowedDespiteHold）", () => {
  test("只涉及答案页 / 造句题面的扣留码 → 邮件与讨论照收", () => {
    expect(W.recallAllowedDespiteHold(["ingest_blocker"])).toBe(true);
    expect(W.recallAllowedDespiteHold(["section_no_stems"])).toBe(true);
    expect(W.recallAllowedDespiteHold(["ingest_blocker", "section_no_stems"])).toBe(true);
  });

  test("混进任何一条别的扣留码 → 补录也不收；没被扣就不走这条判据", () => {
    expect(W.recallAllowedDespiteHold(["ingest_blocker", "section_gap"])).toBe(false);
    expect(W.recallAllowedDespiteHold(["writing_duplicate"])).toBe(false);
    expect(W.recallAllowedDespiteHold([])).toBe(false);
    expect(W.recallAllowedDespiteHold(undefined)).toBe(false);
  });
});

describe("planRecall：只追加、同一道题只收一条、过不了闸的不收", () => {
  const meta = (source) => ({ real: true, tier: "recalled", source, date: "2026-01-21", source_hash: null, source_flags: [] });
  const cand = (set, slug, email, problems = []) => ({
    set, id: `email_${slug}`, problems, item: { id: `email_${slug}`, ...email, ...meta(set) },
  });
  const A = W.emailFromGt(GT_EMAIL);
  const B = W.emailFromGt({ recipient: "Emma", subject: "Request for volunteering at charity event",
    scenario: "You are organizing a charity event at your university to raise funds for a local animal shelter. You need volunteers to help with various tasks.",
    bullets: ["Describe the event and its purpose.", "Explain what tasks you need help with.", "Ask her whether she can join."] });

  test("已入库（rf/rp）的同一道题 → 不收，记别名指向已入库那条（老 id 不动）", () => {
    const existing = [{ id: "email_rf0713", ...B, ...meta("rf0713") }];
    const plan = W.planRecall({ type: "email", existing, candidates: [cand("1.21新托福真题A卷", "121a", A), cand("3.4新托福真题", "34", B)] });
    expect(plan.accepted.map((x) => x.id)).toEqual(["email_121a"]);
    expect(plan.aliases).toEqual([{ from: "email_34", to: "email_rf0713", from_type: "email", to_type: "email", reason: "duplicate_of_live" }]);
    expect(existing).toHaveLength(1); // 不改入参
  });

  test("候选之间重复 → 卷名排序最靠前的留下，后面的记别名", () => {
    const plan = W.planRecall({ type: "email", existing: [], candidates: [cand("1.21新托福真题A卷", "121a", A), cand("3.4新托福真题", "34", A)] });
    expect(plan.accepted.map((x) => x.id)).toEqual(["email_121a"]);
    expect(plan.aliases[0]).toMatchObject({ from: "email_34", to: "email_121a", reason: "duplicate_prompt" });
  });

  test("最靠前的那份过不了闸 → 不收也不当别名目标，后面过得了闸的同一道题接任", () => {
    const plan = W.planRecall({
      type: "email", existing: [],
      candidates: [cand("1.21新托福真题A卷", "121a", A, ["要求不是 3 条（2）"]), cand("3.4新托福真题", "34", A)],
    });
    expect(plan.accepted.map((x) => x.id)).toEqual(["email_34"]);
    expect(plan.aliases).toEqual([]);
    expect(plan.dropped[0]).toMatchObject({ id: "email_121a", code: "recall_gate" });
  });

  test("讨论的别名题型记成 disc（assemble_sets / parseRealBankId 认的是 disc_ 前缀）", () => {
    const d = disc();
    const mk = (set, slug) => ({ set, id: `disc_${slug}`, problems: [], item: { id: `disc_${slug}`, ...d, ...meta(set) } });
    const plan = W.planRecall({ type: "discussion", existing: [], candidates: [mk("1.21新托福真题A卷", "121a"), mk("3.4新托福真题", "34")] });
    expect(plan.aliases[0]).toMatchObject({ from: "disc_34", to: "disc_121a", from_type: "disc", to_type: "disc" });
  });
});

describe("入库账本 data/realBank/writing-recall.json", () => {
  const ledger = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) : null;

  test("账本存在，且放行线与判据文件一致", () => {
    expect(ledger).toBeTruthy();
    expect(ledger._ocr_trigram_min).toBe(W.OCR_TRIGRAM_MIN);
  });

  // 覆盖率没达线的只有一种放法：人对着原图逐字核过、账本里写明理由（ocr_waiver）。不许悄悄放。
  const ocrPassedOrWaived = (e) => Boolean(e.ocr) && (e.ocr.trigram >= W.OCR_TRIGRAM_MIN || String(e.ocr_waiver || "").trim().length >= 10);

  test("每条 verdict=ok 的邮件都过结构闸、核过 OCR 且覆盖率达线（或写明理由的人工豁免）", () => {
    for (const [set, e] of Object.entries(ledger.email)) {
      if (e.verdict !== "ok") continue;
      expect([set, W.emailProblems(W.emailFromGt(e.content))]).toEqual([set, []]);
      expect([set, ocrPassedOrWaived(e)]).toEqual([set, true]);
    }
  });

  test("每条 verdict=ok 的讨论都过结构闸（课程 + 整段原话 + 2 条完整学生帖）、核过 OCR 且覆盖率达线（或写明理由的人工豁免）", () => {
    for (const [set, d] of Object.entries(ledger.discussion)) {
      if (d.verdict !== "ok") continue;
      expect([set, W.discussionProblems(W.discussionShape(d.content), d.question)]).toEqual([set, []]);
      expect([set, ocrPassedOrWaived(d)]).toEqual([set, true]);
    }
  });
});
