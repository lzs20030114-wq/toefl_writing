import { countAnnotations, parseAnnotations, reanchorToSource } from "../lib/annotations/parseAnnotations";

describe("parseAnnotations", () => {
  test("parses attributes wrapped in Chinese curly quotes (DeepSeek mojibake)", () => {
    // Real-world failure mode: DeepSeek occasionally emits attribute values
    // wrapped in U+201C / U+201D (Chinese curly double quotes) instead of
    // ASCII straight quotes when the surrounding context is Chinese. Until
    // we taught parseAttrs to accept curly quotes, every annotation in such
    // a response was silently dropped (level=undefined → push skipped) and
    // the user saw only the calibration fallback on the first sentence.
    const raw =
      "I firmly agree with Emily's idea. " +
      "<r>more independence than live</r><n level=“red” fix=“change to 'more independent than living'”>语法错误：be more independence 应为 be more independent</n> " +
      "Besides, living alone is great. " +
      "<r>young person, they need</r><n level=“red” fix=“use 'young people need'”>person 应该复数</n>";
    const out = parseAnnotations(raw);

    expect(out.parseError).toBe(false);
    expect(out.annotations).toHaveLength(2);
    expect(out.annotations[0].level).toBe("red");
    expect(out.annotations[0].fix).toBe("change to 'more independent than living'");
    expect(out.annotations[1].level).toBe("red");
    expect(out.annotations[1].fix).toBe("use 'young people need'");
  });

  test("parses inline annotation tags and computes ranges on plain text", () => {
    const raw =
      'Hello <n level="orange" fix="Use a comma.">world</n> and <n level="red" fix="Use present perfect.">I go</n>.';
    const out = parseAnnotations(raw);

    expect(out.parseError).toBe(false);
    expect(out.plainText).toBe("Hello world and I go.");
    expect(out.plainText).not.toContain("<n");
    expect(out.annotations).toHaveLength(2);

    expect(out.annotations[0]).toMatchObject({
      level: "orange",
      message: "world",
      fix: "Use a comma.",
      start: 6,
      end: 11,
    });
    expect(out.plainText.slice(out.annotations[0].start, out.annotations[0].end)).toBe("world");

    expect(out.annotations[1]).toMatchObject({
      level: "red",
      message: "I go",
      fix: "Use present perfect.",
      start: 16,
      end: 20,
    });
    expect(out.plainText.slice(out.annotations[1].start, out.annotations[1].end)).toBe("I go");
  });

  test("keeps recoverable annotations when markup is partially broken", () => {
    const raw =
      'Intro <r>He go to school yesterday.</r><n level="red" fix="He went to school yesterday.">时态错误。</n> ' +
      'and <n level="orange" fix="This sentence is clearer.">This sentence are unclear.</n> ' +
      '<r>This tag is broken<n level="red" fix="fixed">bad';
    const out = parseAnnotations(raw);

    expect(out.parseError).toBe(true);
    expect(out.plainText).toContain("He go to school yesterday.");
    expect(out.annotations.length).toBeGreaterThanOrEqual(2);
    expect(out.annotations.some((a) => a.level === "red")).toBe(true);
    expect(out.annotations.some((a) => a.level === "orange")).toBe(true);
  });

  test("recognizes grammar error as red annotation", () => {
    const raw =
      '<r>He go to school yesterday.</r><n level="red" fix="He went to school yesterday.">语法错误：一般过去时使用错误。</n>';
    const out = parseAnnotations(raw);
    const counts = countAnnotations(out.annotations);

    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].level).toBe("red");
    expect(out.annotations[0].message).toContain("语法错误");
    expect(out.annotations[0].fix).toContain("went");
    expect(counts.red).toBe(1);
  });

  test("recognizes spelling error as red annotation", () => {
    const raw =
      '<r>I recieved your email.</r><n level="red" fix="I received your email.">拼写错误：recieved 应为 received。</n>';
    const out = parseAnnotations(raw);
    const counts = countAnnotations(out.annotations);

    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].level).toBe("red");
    expect(out.annotations[0].errorType).toBe("spelling");
    expect(out.annotations[0].message).toContain("拼写错误");
    expect(out.annotations[0].fix).toContain("received");
    expect(counts.red).toBe(1);
    expect(counts.spelling).toBe(1);
  });

  test("recognizes spelling error when fix is Chinese instruction", () => {
    const raw =
      '<r>recieve</r><n level="red" fix="将 recieve 改为 receive">拼写错误</n>';
    const out = parseAnnotations(raw);

    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].errorType).toBe("spelling");
  });

  test("recognizes spelling error via edit-distance heuristic (no keyword)", () => {
    const raw =
      '<r>accomodate</r><n level="red" fix="accommodate">常见拼错词。</n>';
    const out = parseAnnotations(raw);

    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].errorType).toBe("spelling");
  });

  test("does not flag grammar error as spelling", () => {
    const raw =
      '<r>He go to school yesterday.</r><n level="red" fix="He went to school yesterday.">语法错误：一般过去时使用错误。</n>';
    const out = parseAnnotations(raw);

    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].errorType).not.toBe("spelling");
  });

  test("keeps original layout when model emits detached marker lines", () => {
    const raw = [
      "I think service-learning course is good idea.",
      "<r>service-learning course</r><n level=\"red\" fix=\"the service-learning course\">冠词缺失。</n>",
      "",
      "Another sentence.",
    ].join("\n");
    const out = parseAnnotations(raw);

    expect(out.plainText).toContain("I think service-learning course is good idea.");
    expect(out.plainText).not.toMatch(/\nservice-learning course\n/);
    expect(out.annotations.length).toBeGreaterThan(0);
    const mark = out.annotations[0];
    expect(out.plainText.slice(mark.start, mark.end)).toBe("service-learning course");
  });

  test("anchors trailing annotation at end of line without duplicating text", () => {
    const raw =
      'I think service-learning courses are important. ' +
      '<r>service-learning courses</r><n level="red" fix="the service-learning courses">冠词缺失。</n>';
    const out = parseAnnotations(raw);

    expect(out.plainText).toBe("I think service-learning courses are important. ");
    expect(out.annotations).toHaveLength(1);
    const mark = out.annotations[0];
    expect(out.plainText.slice(mark.start, mark.end)).toBe("service-learning courses");
    // Should point to the original position (8), not be duplicated at the end
    expect(mark.start).toBe(8);
  });

  test("anchors multiple trailing annotations on the same line", () => {
    const raw =
      'I think courses provide experience. ' +
      '<r>courses</r><n level="red" fix="the courses">冠词缺失。</n> ' +
      '<r>provide experience</r><n level="orange" fix="offer hands-on experience">表达建议。</n>';
    const out = parseAnnotations(raw);

    expect(out.annotations).toHaveLength(2);
    expect(out.plainText.slice(out.annotations[0].start, out.annotations[0].end)).toBe("courses");
    expect(out.plainText.slice(out.annotations[1].start, out.annotations[1].end)).toBe("provide experience");
  });

  test("keeps inline mark when the marked word repeats earlier in the sentence", () => {
    // Real-world bug (2026-07 user report): the essay legitimately contained
    // "inform you about a problem about the heating system"; the AI marked
    // the SECOND "about" inline. The old trailing-echo heuristic saw "about"
    // earlier on the line, swallowed the marked word from the rendered text
    // and anchored the fix on the first (correct) "about".
    const raw =
      'I am writing to inform you about a problem ' +
      '<r>about</r><n level="red" fix="将 \'about\' 改为 \'with\'">介词搭配错误，应为 a problem with。</n>' +
      ' the heating system in my apartment.';
    const out = parseAnnotations(raw);

    expect(out.plainText).toBe(
      "I am writing to inform you about a problem about the heating system in my apartment."
    );
    expect(out.annotations).toHaveLength(1);
    const mark = out.annotations[0];
    expect(out.plainText.slice(mark.start, mark.end)).toBe("about");
    // Must anchor on the SECOND "about" (after "problem "), not the first.
    expect(mark.start).toBe("I am writing to inform you about a problem ".length);
  });

  test("keeps inline mark mid-line even when followed by more sentence text", () => {
    // "on" also appears inside "attention" earlier on the line — the old
    // heuristic swallowed the standalone "on" and highlighted the tail of
    // "attention" instead.
    const raw =
      'Thank you for your attention <r>on</r><n level="red" fix="将 \'on\' 改为 \'to\'">介词错误。</n> this matter.';
    const out = parseAnnotations(raw);

    expect(out.plainText).toBe("Thank you for your attention on this matter.");
    expect(out.annotations).toHaveLength(1);
    const mark = out.annotations[0];
    expect(out.plainText.slice(mark.start, mark.end)).toBe("on");
    expect(mark.start).toBe("Thank you for your attention ".length);
  });

  test("trailing echo anchors on a word boundary, not inside a longer word", () => {
    // Genuine trailing echo (pair at end of line), but plain lastIndexOf
    // would land inside "form" — the boundary-aware anchor must pick the
    // standalone "for".
    const raw =
      'Thanks for the form. <r>for</r><n level="orange" fix="改为 regarding">介词建议。</n>';
    const out = parseAnnotations(raw);

    expect(out.plainText).toBe("Thanks for the form. ");
    expect(out.annotations).toHaveLength(1);
    const mark = out.annotations[0];
    expect(out.plainText.slice(mark.start, mark.end)).toBe("for");
    expect(mark.start).toBe("Thanks ".length);
  });

  test("keeps orphan annotation when marked text has no earlier occurrence", () => {
    const raw = [
      "I think this policy is useful.",
      "<r>lexical precision</r><n level=\"orange\" fix=\"more precise wording\">表达不够精准。</n>",
      "Next paragraph starts here.",
    ].join("\n");
    const out = parseAnnotations(raw);

    expect(out.plainText).toContain("I think this policy is useful.");
    expect(out.plainText).toContain("Next paragraph starts here.");
    // The annotation text is kept because it cannot be distinguished
    // from a legitimate inline annotation occupying a full line.
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].level).toBe("orange");
  });
});

describe("reanchorToSource", () => {
  function ann(plainText, frag, from = 0, extra = {}) {
    const start = plainText.indexOf(frag, from);
    return { level: "red", message: "m", fix: "f", start, end: start + frag.length, ...extra };
  }

  test("returns parsed unchanged when echo already equals the source", () => {
    const src = "The radiators is still cold.";
    const parsed = { plainText: src, annotations: [ann(src, "is")] };
    expect(reanchorToSource(parsed, src)).toBe(parsed);
  });

  test("restores the user's exact layout when the echo lost line breaks", () => {
    const src = "Dear Mr. Harris,\nSince last week, the heater has completely stop working.\nThe radiators is still cold.";
    const echo = "Dear Mr. Harris, Since last week, the heater has completely stop working. The radiators is still cold.";
    const parsed = {
      plainText: echo,
      annotations: [ann(echo, "stop"), ann(echo, "is", echo.indexOf("radiators"))],
    };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(2);
    expect(src.slice(out.annotations[0].start, out.annotations[0].end)).toBe("stop");
    // "is" must land after "radiators", not inside "Harris"
    expect(src.slice(out.annotations[1].start, out.annotations[1].end)).toBe("is");
    expect(out.annotations[1].start).toBeGreaterThan(src.indexOf("radiators"));
  });

  test("disambiguates a repeated fragment by its surrounding context", () => {
    const src = "I am writing to inform you about a problem about the heating system in my apartment.";
    // Echo dropped the greeting but kept both "about"s; the mark is on the SECOND.
    const echo = "I am writing to inform you about a problem about the heating system in my apartment. ";
    const secondAbout = echo.indexOf("about", echo.indexOf("problem"));
    const parsed = {
      plainText: echo,
      annotations: [{ level: "red", message: "m", fix: "f", start: secondAbout, end: secondAbout + 5 }],
    };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(1);
    const mark = out.annotations[0];
    expect(src.slice(mark.start, mark.end)).toBe("about");
    expect(mark.start).toBe(src.indexOf("about", src.indexOf("problem")));
  });

  test("drops marks on text the user never wrote, keeps the rest", () => {
    const src = "The heater has stop working since last week.";
    const echo = "The heater has stop working since last month."; // echo rewrote "week"→"month"
    const parsed = {
      plainText: echo,
      annotations: [ann(echo, "stop"), ann(echo, "month")],
    };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(1);
    expect(src.slice(out.annotations[0].start, out.annotations[0].end)).toBe("stop");
  });

  test("rebuilds from the source when nothing anchors (never shows the alien echo)", () => {
    // 旧行为是原样返回 parsed(把 AI 复述文当「原文」展示)——那正是修3要治的
    // 不一致;现在与 valid.length===0 分支同形状:原文 + 空批注。
    const src = "A completely different essay.";
    const echo = "The heater has stop working.";
    const parsed = { plainText: echo, annotations: [ann(echo, "stop")] };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(0);
  });

  test("rebuilds from the source when the only mark fails to anchor", () => {
    // 修3回归:echo 把被标注的词改写掉(stop→quit),该批注锚定不上被丢弃后,
    // 回退必须展示用户原文,而不是 AI 篡改过的复述文。
    const src = "The heater has stop working since last week.";
    const echo = "The heater has quit working since last week.";
    const parsed = { plainText: echo, annotations: [ann(echo, "quit")] };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(0);
  });

  test("reanchors a mark whose apostrophe glyph drifted (curly vs straight)", () => {
    // 修4回归:DeepSeek 在中文语境下会把直撇号漂成弯撇号 —— echo/fragment 是
    // don’t(U+2019),用户原文是 don't(ASCII)。字形折叠前这里零候选,整条
    // 批注被静默丢弃;折叠后必须成功重锚定。
    const src = "I don't have enough time to finish the report.";
    const echo = "I don’t have enough time to finish the report.";
    const parsed = { plainText: echo, annotations: [ann(echo, "don’t have")] };
    const out = reanchorToSource(parsed, src);

    expect(out.plainText).toBe(src);
    expect(out.annotations).toHaveLength(1);
    expect(src.slice(out.annotations[0].start, out.annotations[0].end)).toBe("don't have");
  });
});
