import { parseAnnotations } from "../lib/annotations/parseAnnotations";

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
});
