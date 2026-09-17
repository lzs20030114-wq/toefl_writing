/**
 * 听力题号重建（scripts/realbank/listening_renumber.js）。
 *
 * 判据是**屏幕顺序**：题面 PDF 常把两三屏截图拼一页，OCR 先把这一页的几个题号页眉一起读出来，
 * 正文才跟在后面 —— 于是前几个题号的 block 正文为空、最后一个 block 的正文里挤着整页的几屏。
 * 「连续 k-1 个空 block + 1 个有正文 block」= 一页 k 屏，第 i 屏就是这段的第 i 个题号。
 *
 * 这一组把七件事钉死（每一条都对应一次真实事故或一条硬护栏）：
 *   1. 重复屏去重 —— 题干+选项逐字相同的两份只留一份，留的是选项齐全的那份；
 *   2. 后移 —— 空屏把后面的题号整体顶歪，要按屏幕顺序搬回去，并**重新从答案页取字母**；
 *   3. 局部换位 —— 掉一题导致组内换位，不是简单平移；
 *   4. 残缺选项拦截 —— 选项不是 4 个，字母位不可信，整题不动；
 *   5. 定位不唯一拦截 —— 一屏被两道题争，弱的那道不动；
 *   6. 跨材料拦截 —— 新题号出了本题组的题号带（= 会挂到另一段材料 / 改组 id），不动；
 *   7. 盲审票不许反向改号 —— 两票同字母 ≠ 新字母时只记 crossCheck，题号与字母仍以屏幕+答案页为准。
 */
const R = require("../scripts/realbank/listening_renumber.js");

const OPTS = (tag) => [`${tag} alpha option one`, `${tag} beta option two`, `${tag} gamma option three`, `${tag} delta option four`];

function screen(stem, options) {
  return `00:00:14 Hide Time\n${stem}\n${options.join("\n")}`;
}

function block(start, total, body) {
  return { section: "listening", start, end: start, total, body, section_inferred: false };
}

function item(q, stem, options, answerIndex) {
  return {
    q_number: q, q_number_raw: q, stem, options,
    answer_index: answerIndex, answer_key: "abcd"[answerIndex],
  };
}

function group(key, { module = 1, type = "lat", qStart, qEnd, items, problems = [] }) {
  return { key, section: "listening", module, type, q_start: qStart, q_end: qEnd, status: "ok", problems, items };
}

function scanOf(blocks, answersByN, { module = 1, total = 32 } = {}) {
  return {
    blocks,
    alignment: {
      listening: {
        modules: [{
          module, total,
          matched: Object.entries(answersByN).map(([n, answer]) => ({ n: Number(n), answer })),
        }],
      },
    },
  };
}

describe("屏幕切分与段落校验", () => {
  test("计时器切屏；短碎片（横幅残词）不算一屏", () => {
    const body = `onversation.\n${screen("What are they talking about?", OPTS("x"))}`;
    expect(R.splitScreens(body)).toHaveLength(1);
  });

  test("整屏没 OCR 出计时器时，够长的正文仍算一屏", () => {
    const body = `Choose the best response.\n${OPTS("y").join("\n")}`;
    expect(R.splitScreens(body)).toHaveLength(1);
  });

  test("屏数与题号数对不上 → 整段 fail-closed，不进屏幕表", () => {
    const blocks = [
      block(1, 32, ""),
      block(2, 32, screen("only one screen here", OPTS("z"))), // 该有 2 屏
      block(3, 32, screen("solo", OPTS("w"))),
    ];
    const { screens, runs } = R.buildScreenMap(blocks);
    expect([...screens.keys()]).toEqual([3]);
    expect(runs.find((r) => !r.ok).nums).toEqual([1, 2]);
  });
});

describe("重复屏去重", () => {
  test("题干+选项逐字相同只留一份，留选项齐全的那份", () => {
    const stem = "What is the main topic of the talk?";
    const full = item(13, stem, OPTS("a"), 0);
    const partial = item(14, stem, OPTS("a").slice(0, 2), 0);
    const g = group("listening|1|13", { type: "lc", qStart: 13, qEnd: 14, items: [partial, full] });
    const wrapped = [{ group: g, item: partial }, { group: g, item: full }];
    const { kept, dropped } = R.dedupeItems(wrapped);
    expect(kept).toHaveLength(1);
    expect(kept[0].item).toBe(full);
    expect(dropped[0].item).toBe(partial);
  });
});

describe("按屏幕顺序重排", () => {
  // 一页两屏：q25 的页眉后面没正文，q26 的正文里挤着 q25 与 q26 两屏。
  const S25 = "What is the main topic of the talk?";
  const S26 = "What does the speaker say about frog reproduction?";
  const S27 = "What point does the speaker make about a type of fungus?";
  const S28 = "Why does the speaker mention bees?";
  const blocks = [
    block(25, 32, ""),
    block(26, 32, `${screen(S25, OPTS("m"))}\n${screen(S26, OPTS("n"))}`),
    block(27, 32, ""),
    block(28, 32, `${screen(S27, OPTS("p"))}\n${screen(S28, OPTS("q"))}`),
  ];
  const answers = { 25: "d", 26: "c", 27: "a", 28: "b" };

  test("后移：结构化的 Q27/Q28 其实是屏上的 Q26/Q27，答案随真题号重新盖章", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(25, S25, OPTS("m"), 3), item(27, S26, OPTS("n"), 0), item(28, S27, OPTS("p"), 1)],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    const moves = plan.moves.map((m) => [m.fromQ, m.toQ, m.toLetter]);
    expect(moves).toEqual([[27, 26, "c"], [28, 27, "a"]]);
    // 没动的那道也没被改字母
    expect(plan.keeps.map((k) => k.toQ)).toEqual([25]);
    // 屏上有题、structured 没抽出来的那一屏（Q28 = bees）没有被任何题认领
    expect(plan.moves.some((m) => m.toQ === 28)).toBe(false);
  });

  test("局部换位：两道题在屏上的先后与结构化给的号相反", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(26, S27, OPTS("p"), 0), item(27, S26, OPTS("n"), 0)],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    const moves = plan.moves.map((m) => [m.fromQ, m.toQ, m.toLetter]).sort((a, b) => a[0] - b[0]);
    expect(moves).toEqual([[26, 27, "a"], [27, 26, "c"]]);
  });

  test("applyPlan 落到 item 上：题号、字母、留痕、空题清理", () => {
    const phantom = item(26, "", [], 2);
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(25, S25, OPTS("m"), 3), phantom, item(27, S26, OPTS("n"), 0)],
    });
    const structured = { results: [g] };
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured });
    const applied = R.applyPlan(structured, plan);
    expect(applied).toEqual({ renumbered: 1, removed: 1 });
    const moved = g.items.find((it) => it.stem === S26);
    expect(moved.q_number).toBe(26);
    expect(moved.q_renumbered_from).toBe(27);
    expect(moved.answer_restamped_from).toBe("a");
    expect(moved.answer_key).toBe("c");
    expect(moved.answer_index).toBe(2);
    expect(g.items).toHaveLength(2);           // 撞号的空题被清掉
    expect(g.problems.some((p) => p.startsWith("listening_renumber:Q27→Q26"))).toBe(true);
  });

  test("重排是幂等的：在已重排的产物上再跑一次没有新动作", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(25, S25, OPTS("m"), 3), item(27, S26, OPTS("n"), 0)],
    });
    const structured = { results: [g] };
    R.applyPlan(structured, R.planSet({ scan: scanOf(blocks, answers), structured }));
    const again = R.planSet({ scan: scanOf(blocks, answers), structured });
    expect(again.moves).toHaveLength(0);
    expect(again.keeps.map((k) => k.toQ).sort()).toEqual([25, 26]);
  });
});

describe("硬护栏", () => {
  const S1 = "What does the speaker mainly discuss?";
  const S2 = "Why does the speaker mention the theremin?";
  const blocks = [
    block(25, 32, ""),
    block(26, 32, `${screen(S1, OPTS("m"))}\n${screen(S2, OPTS("n"))}`),
  ];
  const answers = { 25: "a", 26: "b", 27: "c", 28: "d" };

  test("选项不是 4 个 → options_not_4，题号与字母都不动", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28, items: [item(27, S2, OPTS("n").slice(0, 3), 0)],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    expect(plan.moves).toHaveLength(0);
    expect(plan.blocked.map((b) => b.reason)).toContain("options_not_4");
  });

  test("一屏被两道近似题争 → 弱的那道不动（screen_contested）", () => {
    // 题干不同（去重管不着），选项却一模一样：两道都往屏 Q26 上贴，只有逐字对上的那道算数。
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(26, S2, OPTS("n"), 0), item(27, `${S2} Please explain in detail.`, OPTS("n"), 0)],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    expect(plan.moves.map((m) => m.fromQ)).toEqual([26]);
    const weak = plan.blocked.find((b) => b.q === 27);
    expect(["screen_contested", "ambiguous"]).toContain(weak.reason);
  });

  test("同组题干逐字相同的重复题：去重只留一份，另一份记 stem_duplicate", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(26, S2, OPTS("n"), 0), item(27, S2, OPTS("n").slice(0, 2), 0)],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    expect(plan.moves.map((m) => m.fromQ)).toEqual([26]);
    expect(plan.blocked.find((b) => b.q === 27).reason).toBe("stem_duplicate");
  });

  test("新题号出了本题组的题号带 → out_of_group_band，不动（不许跨材料搬）", () => {
    const g = group("listening|1|27", {
      qStart: 27, qEnd: 28, items: [item(27, S1, OPTS("m"), 0)], // 真身在屏 Q25，出带
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    expect(plan.moves).toHaveLength(0);
    expect(plan.blocked.find((b) => b.q === 27).reason).toBe("out_of_group_band");
  });

  test("merge 判掉的那一份才算 flagged：留下的 Q13 不受 stem_duplicate 连坐", () => {
    const g = group("listening|1|25", {
      qStart: 25, qEnd: 28,
      items: [item(27, S2, OPTS("n"), 0)],
      problems: ["stem_duplicate:Q27/Q28 同组题干逐字相同（剔 Q28）"],
    });
    const plan = R.planSet({ scan: scanOf(blocks, answers), structured: { results: [g] } });
    expect(plan.moves.map((m) => [m.fromQ, m.toQ])).toEqual([[27, 26]]);
  });

  test("答案页没有新题号的答案 → no_answer，不动", () => {
    const g = group("listening|1|25", { qStart: 25, qEnd: 28, items: [item(27, S2, OPTS("n"), 0)] });
    const scan = scanOf(blocks, { 25: "a", 27: "c" }); // 缺 26
    const plan = R.planSet({ scan, structured: { results: [g] } });
    expect(plan.moves).toHaveLength(0);
    expect(plan.blocked.find((b) => b.q === 27).reason).toBe("no_answer");
  });
});

describe("盲审票只做交叉验证", () => {
  const S1 = "What does the speaker mainly discuss?";
  const S2 = "Why does the speaker mention the theremin?";
  const blocks = [block(25, 32, ""), block(26, 32, `${screen(S1, OPTS("m"))}\n${screen(S2, OPTS("n"))}`)];
  const answers = { 25: "a", 26: "b", 27: "c", 28: "d" };

  test("两票同字母 ≠ 新答案时，不许反过来按票改号；只记一条 crossCheck", () => {
    const g = group("listening|1|25", { qStart: 25, qEnd: 28, items: [item(27, S2, OPTS("n"), 0)] });
    const plan = R.planSet({
      scan: scanOf(blocks, answers),
      structured: { results: [g] },
      auditIndex: { "1#27": { model: "d", second: "d", agree: false } },
    });
    expect(plan.moves.map((m) => [m.fromQ, m.toQ, m.toLetter])).toEqual([[27, 26, "b"]]);
    expect(plan.crossCheck).toEqual([
      { module: 1, fromQ: 27, toQ: 26, toLetter: "b", votes: ["d", "d"], unanimous: true, ok: false },
    ]);
  });

  test("票与新答案一致时 crossCheck.ok = true", () => {
    const g = group("listening|1|25", { qStart: 25, qEnd: 28, items: [item(27, S2, OPTS("n"), 0)] });
    const plan = R.planSet({
      scan: scanOf(blocks, answers),
      structured: { results: [g] },
      auditIndex: { "1#27": { model: "b", second: "b", agree: false } },
    });
    expect(plan.crossCheck[0].ok).toBe(true);
  });
});
