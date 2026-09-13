/**
 * 真题「点选句子」题的纯函数锁（scripts/realbank/sentence_select.js）。
 *
 * 前端按契约在 paragraphs[paragraph] 里**顺序 indexOf** 每个选项来定位高亮 —— 分句器切错一刀，
 * 用户点的那句就高亮不出来、或者判分对不上。所以分句的每个坑（U.S. / Dr. / e.g. / 小数 /
 * 句号后引号）都单独钉一条；正确句匹配「必须唯一」、审计哈希「文字一变就失效」也各钉一条。
 */
const SS = require("../scripts/realbank/sentence_select.js");

/* ── 分句 ─────────────────────────────────────────────────────────────── */

describe("splitSentences：只切边界，不改写任何字符", () => {
  const exactSubstrings = (text) => {
    const out = SS.splitSentences(text);
    let cursor = 0;
    for (const s of out) {
      const at = text.indexOf(s, cursor);
      expect(at).toBeGreaterThanOrEqual(0);      // 每一句都是原文的精确子串，且按顺序出现
      cursor = at + s.length;
    }
    return out;
  };

  test("普通三句", () => {
    expect(exactSubstrings("Glaciers hold ice. As snow accumulates, it traps air. These bubbles matter."))
      .toEqual(["Glaciers hold ice.", "As snow accumulates, it traps air.", "These bubbles matter."]);
  });

  test("U.S. / Dr. / e.g. 这些缩写后面不切", () => {
    const t = "The U.S. Army funded Dr. Smith's lab. It tested materials, e.g. Kevlar and silk. Results varied.";
    expect(exactSubstrings(t)).toEqual([
      "The U.S. Army funded Dr. Smith's lab.",
      "It tested materials, e.g. Kevlar and silk.",
      "Results varied.",
    ]);
  });

  test("小数与百分比不切（点后没有空白）", () => {
    expect(exactSubstrings("Temperatures rose 1.5 degrees. Sea levels rose 3.2 percent."))
      .toEqual(["Temperatures rose 1.5 degrees.", "Sea levels rose 3.2 percent."]);
  });

  test("句号后面紧跟右引号：引号归前一句", () => {
    expect(exactSubstrings('She called it "a revolution." Critics disagreed.'))
      .toEqual(['She called it "a revolution."', "Critics disagreed."]);
    expect(exactSubstrings("He wrote “the end.” Then he left."))
      .toEqual(["He wrote “the end.”", "Then he left."]);
  });

  test("问号、括号收尾、人名缩写", () => {
    expect(exactSubstrings("But is this picture complete? Some researchers argue otherwise."))
      .toEqual(["But is this picture complete?", "Some researchers argue otherwise."]);
    expect(exactSubstrings("Waves reach the core (the center of Earth). They slow down."))
      .toEqual(["Waves reach the core (the center of Earth).", "They slow down."]);
    expect(exactSubstrings("J. K. Rowling wrote it. Fans loved it."))
      .toEqual(["J. K. Rowling wrote it.", "Fans loved it."]);
  });

  test("句点后接小写不切（OCR 常见的缩写残片）；空白原样保留在句子内部", () => {
    expect(exactSubstrings("It uses approx. ten sensors.  Each  one reports hourly."))
      .toEqual(["It uses approx. ten sensors.", "Each  one reports hourly."]);
  });

  test("空串 / 没有句末标点", () => {
    expect(SS.splitSentences("")).toEqual([]);
    expect(SS.splitSentences("a fragment without end")).toEqual(["a fragment without end"]);
  });
});

/* ── 正确句匹配 ───────────────────────────────────────────────────────── */

describe("答案开头词 → 正确句（必须唯一命中）", () => {
  const P4 = [
    "Advancements in technology have also led to the creation of noise-canceling materials.",
    "Such materials are often used on buildings or road surfaces.",
    "Urban planners can use these materials to design acoustic panels and noise barriers.",
  ];

  test("答案页批注 / 省略号去掉，只留英文词", () => {
    expect(SS.answerPrefixWords("however...（第二段最后一句）")).toEqual(["however"]);
    expect(SS.answerPrefixWords("some insist...")).toEqual(["some", "insist"]);
    expect(SS.answerPrefixWords("urban planners")).toEqual(["urban", "planners"]);
  });

  test("唯一命中", () => {
    expect(SS.matchByPrefix(P4, "urban planners")).toEqual({ index: 2 });
  });

  test("逐词前缀：答案页把 Rogers 抄成 roger 也认", () => {
    const sents = ["One of Rogers' core beliefs was empathy.", "Rogers claimed this approach allows growth."];
    expect(SS.matchByPrefix(sents, "roger claimed")).toEqual({ index: 1 });
  });

  test("0 命中 / 多命中都拒绝，不猜", () => {
    expect(SS.matchByPrefix(P4, "researchers").error).toBe("no_match");
    const two = ["Some scientists agree.", "Sometimes the data conflict.", "Others doubt it."];
    expect(SS.matchByPrefix(two, "some")).toMatchObject({ error: "ambiguous", hits: [0, 1] });
  });
});

/* ── 题干 ─────────────────────────────────────────────────────────────── */

describe("题干清洗与段号", () => {
  test("去掉界面指令（含 OCR 截断、尾逗号），不动题干本身", () => {
    expect(SS.cleanStem("Identify the sentence in paragraph 4 that names specific elements. Select the sentence to make your choice,"))
      .toBe("Identify the sentence in paragraph 4 that names specific elements.");
    expect(SS.cleanStem("Identify the sentence in paragraph 2 that best explains it. Select the sentence to make your "))
      .toBe("Identify the sentence in paragraph 2 that best explains it.");
    expect(SS.cleanStem("Identify the sentence in paragraph 2 that contains the definition of a term"))
      .toBe("Identify the sentence in paragraph 2 that contains the definition of a term");
  });

  test("以 Select the sentence 开头的题干不许被整个吃掉", () => {
    expect(SS.cleanStem("Select the sentence in paragraph 3 that states the main claim."))
      .toBe("Select the sentence in paragraph 3 that states the main claim.");
  });

  test("段号：数字 / 粘字 / 序数词 / 最后一段；两个段号不收", () => {
    expect(SS.paragraphOf("Identify the sentence in paragraph 4 that …")).toBe(4);
    expect(SS.paragraphOf("Identifythesentence inparagraph2thatindicates")).toBe(2);
    expect(SS.paragraphOf("Identify the sentence in the first paragraph that …")).toBe(1);
    expect(SS.paragraphOf("Identify the sentence in the last paragraph that …")).toBe(-1);
    expect(SS.paragraphOf("Which sentence in paragraphs 2 and 3 …")).toBeNull();
    expect(SS.paragraphOf("Identify the sentence that …")).toBeNull();
  });
});

/* ── 组题 + 审计哈希 ──────────────────────────────────────────────────── */

describe("buildSentenceQuestion：按契约组题", () => {
  const item = {
    paragraphs: [
      "Noise Control in Urban Areas",
      "Urban areas face noise pollution. It has many causes.",
      "Green walls absorb sound. They also purify air.",
      "Quiet zones restrict noisy activities. Cities create pockets of tranquility.",
      "Advancements in technology led to noise-canceling materials. Such materials are used on roads. Urban planners can use these materials to design acoustic panels.",
    ],
  };
  const entry = {
    stem: "Identify the sentence in paragraph 4 that names specific architectural elements. Select the sentence to make your choice.",
    paragraph: 4, answer_prefix: "urban planners", q_number: 34,
    correct_sentence: "Urban planners can use these materials to design acoustic panels.",
  };

  test("产出契约形状：S1… 按顺序、是段落精确子串、correct_answer 指向正确句", () => {
    const { question, hash } = SS.buildSentenceQuestion(entry, item);
    expect(question).toEqual({
      question_type: "sentence_selection",
      stem: "Identify the sentence in paragraph 4 that names specific architectural elements.",
      paragraph: 4,
      paragraph_index: 4,
      options: {
        S1: "Advancements in technology led to noise-canceling materials.",
        S2: "Such materials are used on roads.",
        S3: "Urban planners can use these materials to design acoustic panels.",
      },
      correct_answer: "S3",
      q_number: 34,
    });
    let cursor = 0;
    for (const v of Object.values(question.options)) {
      const at = item.paragraphs[4].indexOf(v, cursor);
      expect(at).toBeGreaterThanOrEqual(0);
      cursor = at + v.length;
    }
    expect(hash).toBe(SS.auditHash(question.stem, item.paragraphs[4]));
    expect(SS.isSentenceSelectQuestion(question)).toBe(true);
    expect(SS.correctSentenceOf(question)).toBe(entry.correct_sentence);
  });

  test("段号越界 / 该段切不出两句 / 开头词对不上 → error", () => {
    expect(SS.buildSentenceQuestion({ ...entry, paragraph: 9 }, item).error).toBe("paragraph_out_of_range");
    expect(SS.buildSentenceQuestion({ ...entry, paragraph: 1, answer_prefix: "urban", correct_sentence: null },
      { paragraphs: ["T", "Urban planners only get one sentence here."] }).error).toBe("too_few_sentences");
    expect(SS.buildSentenceQuestion({ ...entry, answer_prefix: "researchers" }, item).error).toBe("answer_no_match");
  });

  test("paragraphs[0] 不是标题（没有标题 / 标题粘在首段）→ 题干第 N 段 = paragraphs[N-1]，paragraph_index 按实际下标给", () => {
    const noTitle = { paragraphs: item.paragraphs.slice(1) };          // 去掉标题：第 4 段在 paragraphs[3]
    expect(SS.looksLikeTitle(noTitle.paragraphs[0])).toBe(false);
    const { question, hash } = SS.buildSentenceQuestion(entry, noTitle);
    expect(question).toMatchObject({ paragraph: 4, paragraph_index: 3, correct_answer: "S3" });
    expect(hash).toBe(SS.auditHash(question.stem, noTitle.paragraphs[3]));
  });

  test("正确句不在题干段号换算出的那一段（段落被 OCR 多切 / 少切了一刀）→ paragraph_mismatch", () => {
    const shifted = { paragraphs: [...item.paragraphs.slice(0, 1), "An extra split paragraph.", ...item.paragraphs.slice(1)] };
    expect(SS.buildSentenceQuestion(entry, shifted).error).toBe("paragraph_mismatch");
  });

  test("正确句原文出现在不止一段 → sentence_in_multiple_paragraphs", () => {
    const dup = { paragraphs: [...item.paragraphs.slice(0, 2), `${entry.correct_sentence} Another one here.`, ...item.paragraphs.slice(3)] };
    expect(SS.buildSentenceQuestion(entry, dup).error).toBe("sentence_in_multiple_paragraphs");
  });

  test("标题检测：短且无句末标点才算标题", () => {
    expect(SS.looksLikeTitle("Noise Control in Urban Areas")).toBe(true);
    expect(SS.looksLikeTitle("Urban areas face noise pollution.")).toBe(false);
    expect(SS.looksLikeTitle("Parallel Algorithms: From Challenges to Opportunities Parallel algorithms, a computing method common in modern computers, solve problems")).toBe(false);
    expect(SS.expectedParagraphIndex(["Title", "p1", "p2"], 2)).toBe(2);
    expect(SS.expectedParagraphIndex(["p1.", "p2.", "p3."], 2)).toBe(1);
    expect(SS.expectedParagraphIndex(["Title", "p1"], 5)).toBeNull();
    expect(SS.expectedParagraphIndex(["Title", "p1", "p2"], -1)).toBe(2);
  });

  test("账本记的正确句与宿主命中句差太远（宿主换了一份 OCR 变体）→ 拒收", () => {
    const e = { ...entry, correct_sentence: "Urban planners strategically place barriers near hospitals and parks everywhere." };
    expect(SS.buildSentenceQuestion(e, item).error).toBe("correct_sentence_mismatch");
  });

  test("审计哈希：题干或段落文字差一个字符就变", () => {
    const h = SS.auditHash("stem", "para text.");
    expect(SS.auditHash("stem", "para text.")).toBe(h);
    expect(SS.auditHash("stem", "para  text.")).not.toBe(h);
    expect(SS.auditHash("stem.", "para text.")).not.toBe(h);
    expect(SS.auditHash("stem pa", "ra text.")).not.toBe(SS.auditHash("stem", "pa ra text."));
  });

  test("rehost 的哈希与直接组题的哈希同口径（审计脚本与建库走两条路，必须算出同一个值）", () => {
    const { question, hash } = SS.buildSentenceQuestion(entry, item);
    expect(SS.rehostSentenceQuestion(question, item).hash).toBe(hash);
  });

  test("rehost：代表那份第 N 段里有同一句（Jaccard≥0.9）才搬，选项与答案按代表重算", () => {
    const { question } = SS.buildSentenceQuestion(entry, item);
    const rep = { paragraphs: [...item.paragraphs.slice(0, 4),
      "Noise-canceling materials emerged recently. Urban planners can use these materials to design acoustic panels. They are cheap."] };
    const r = SS.rehostSentenceQuestion(question, rep);
    expect(r.question.correct_answer).toBe("S2");
    expect(r.question.paragraph_index).toBe(4);
    expect(r.question.options.S2).toBe("Urban planners can use these materials to design acoustic panels.");
    expect(r.hash).toBe(SS.auditHash(question.stem, rep.paragraphs[4]));
    // 代表那份没有标题：按代表条目重算 paragraph_index（第 4 段 = paragraphs[3]）
    const repNoTitle = { paragraphs: rep.paragraphs.slice(1) };
    const r2 = SS.rehostSentenceQuestion(question, repNoTitle);
    expect(r2.question.paragraph_index).toBe(3);
    expect(r2.hash).toBe(SS.auditHash(question.stem, repNoTitle.paragraphs[3]));
    const bad = { paragraphs: [...item.paragraphs.slice(0, 4), "Totally different content here. Nothing matches at all."] };
    expect(SS.rehostSentenceQuestion(question, bad).error).toBe("sentence_not_in_rep");
    // 代表那份里这句在第 3 段而不是题干说的第 4 段 → 不搬
    const moved = { paragraphs: [rep.paragraphs[0], rep.paragraphs[1], rep.paragraphs[4], rep.paragraphs[2], "Filler sentence one. Filler sentence two."] };
    expect(SS.rehostSentenceQuestion(question, moved).error).toBe("paragraph_mismatch");
  });
});

/* ── 账本 → 成品：挂题与上线闸 ────────────────────────────────────────── */

describe("attachSentenceSelect / gateSentenceSelect", () => {
  const passage = [
    "Ancient Air in Glaciers",
    "Glaciers serve as frozen libraries. As snow accumulates over centuries, it traps air bubbles. These bubbles matter.",
    "Scientists drill ice cores. Layers mark time periods.",
  ];
  const opt = (n) => ({ A: `a${n}`, B: `b${n}`, C: `c${n}`, D: `d${n}` });
  const host = () => ({
    id: "real_ap_523_2_12", paragraphs: passage.slice(), passage: passage.join("\n\n"),
    questions: [12, 13, 14].map((n) => ({ question_type: "factual_detail", stem: `Q${n}?`, options: opt(n), correct_answer: "A", q_number: n })),
  });
  const entry = {
    key: "5.23新托福真题#2#11", set: "5.23新托福真题", slug: "523", module: 2, q_number: 11,
    stem: "Identify the sentence in paragraph 1 that explains the natural process. Select the sentence to make your choice.",
    paragraph: 1, answer_prefix: "as snow",
  };

  test("按 同卷 + 同 module + 同学术题号带 找宿主，挂上后自有题按题号重排", () => {
    const items = [host(), { ...host(), id: "real_ap_523_1_31", questions: [{ ...host().questions[0], q_number: 31 }] }];
    const r = SS.attachSentenceSelect(items, { entries: [entry] });
    expect(r).toMatchObject({ attached: 1, failed: {} });
    expect(items[0].questions.map((q) => q.q_number)).toEqual([11, 12, 13, 14]);
    expect(items[0].questions[0]).toMatchObject({ question_type: "sentence_selection", paragraph: 1, correct_answer: "S2" });
    expect(items[1].questions).toHaveLength(1);                 // 同卷 M1 那篇不受影响
  });

  test("找不到宿主 / 同带两篇 / 题号已被占 / 开头词对不上 → 记原因，不挂", () => {
    const r1 = SS.attachSentenceSelect([], { entries: [entry] });
    expect(r1.failed).toEqual({ host_missing: 1 });
    const r2 = SS.attachSentenceSelect([host(), { ...host(), id: "real_ap_523_2_13" }], { entries: [entry] });
    expect(r2.failed).toEqual({ host_ambiguous: 1 });
    const taken = host(); taken.questions[0].q_number = 11;
    expect(SS.attachSentenceSelect([taken], { entries: [entry] }).failed).toEqual({ q_number_taken: 1 });
    expect(SS.attachSentenceSelect([host()], { entries: [{ ...entry, answer_prefix: "researchers" }] }).failed)
      .toEqual({ answer_no_match: 1 });
  });

  test("上线闸：哈希 + 正确句都对得上才放行；没审过的摘掉并进待审清单，其余题不动", () => {
    const items = [host()];
    SS.attachSentenceSelect(items, { entries: [entry] });
    const q = items[0].questions[0];
    const hash = SS.auditHash(q.stem, passage[1]);

    const none = SS.gateSentenceSelect(JSON.parse(JSON.stringify(items)), new Map());
    expect(none).toMatchObject({ live: 0, dropped: { unaudited: 1 } });
    expect(none.pending).toEqual([{ host: "real_ap_523_2_12", q_number: 11, stem: q.stem, paragraph: 1, hash, why: "unaudited", question: q }]);

    const ledger = { entries: [{ ...entry, audits: [{ hash, agree: true, expected_sentence: q.options[q.correct_answer] }] }] };
    const copy = JSON.parse(JSON.stringify(items));
    expect(SS.gateSentenceSelect(copy, SS.passingHashes(ledger))).toMatchObject({ live: 1, dropped: {} });
    expect(copy[0].questions).toHaveLength(4);

    // 第一票不一致、第二票一致 → 也算过（audit_answers 同口径）
    const second = { entries: [{ audits: [{ hash, agree: false, second_vote: { agree: true }, expected_sentence: q.options[q.correct_answer] }] }] };
    expect(SS.gateSentenceSelect(JSON.parse(JSON.stringify(items)), SS.passingHashes(second)).live).toBe(1);

    // 哈希对上但当时审定的不是这一句 → 不放行
    const wrong = { entries: [{ audits: [{ hash, agree: true, expected_sentence: "Glaciers serve as frozen libraries." }] }] };
    expect(SS.gateSentenceSelect(JSON.parse(JSON.stringify(items)), SS.passingHashes(wrong)).dropped).toEqual({ unaudited: 1 });
  });

  test("上线闸：段落文字被改过（复核 patch / 换了 OCR 变体）→ 哈希失配，摘掉等重审", () => {
    const items = [host()];
    SS.attachSentenceSelect(items, { entries: [entry] });
    const q = items[0].questions[0];
    const ledger = { entries: [{ audits: [{ hash: SS.auditHash(q.stem, passage[1]), agree: true, expected_sentence: q.options[q.correct_answer] }] }] };
    // 只改句与句之间的空白：选项仍按序是子串（结构没坏），但文字已经不是审过的那份
    items[0].paragraphs[1] = items[0].paragraphs[1].replace("libraries. As", "libraries.  As");
    expect(SS.gateSentenceSelect(items, SS.passingHashes(ledger)).dropped).toEqual({ unaudited: 1 });
  });

  test("上线闸：选项已经不是段落子串（结构坏了）→ 摘掉", () => {
    const items = [host()];
    SS.attachSentenceSelect(items, { entries: [entry] });
    items[0].paragraphs[1] = "Completely rewritten paragraph. Nothing lines up.";
    expect(SS.gateSentenceSelect(items, new Map()).dropped).toEqual({ structure_broken: 1 });
  });
});
