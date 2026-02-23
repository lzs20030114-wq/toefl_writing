import { countAnnotations, parseAnnotations } from "../lib/annotations/parseAnnotations";

describe("parseAnnotations", () => {
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
    expect(out.annotations[0].message).toContain("拼写错误");
    expect(out.annotations[0].fix).toContain("received");
    expect(counts.red).toBe(1);
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
