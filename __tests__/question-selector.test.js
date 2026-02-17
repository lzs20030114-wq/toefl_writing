import { pickRandomPrompt } from "../lib/questionSelector";

describe("questionSelector", () => {
  test("throws when prompt bank is empty", () => {
    expect(() => pickRandomPrompt([], new Set(), "test-key")).toThrow(/Prompt bank is empty/i);
  });

  test("returns a valid index for non-empty prompt bank", () => {
    const idx = pickRandomPrompt([{ id: "a" }, { id: "b" }], new Set(), "test-key-2");
    expect(Number.isInteger(idx)).toBe(true);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(2);
  });
});
