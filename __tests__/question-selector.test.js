import { BANK_EXHAUSTED_ERRORS, DONE_STORAGE_KEYS, pickRandomPrompt } from "../lib/questionSelector";
import { addDoneIds, setCurrentUser } from "../lib/sessionStore";

describe("questionSelector", () => {
  afterEach(() => {
    setCurrentUser(null);
    localStorage.clear();
  });

  test("throws when prompt bank is empty", () => {
    expect(() => pickRandomPrompt([], new Set(), "test-key")).toThrow(/Prompt bank is empty/i);
  });

  test("returns a valid index for non-empty prompt bank", () => {
    const idx = pickRandomPrompt([{ id: "a" }, { id: "b" }], new Set(), "test-key-2");
    expect(Number.isInteger(idx)).toBe(true);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(2);
  });

  test("throws exhausted error when all prompts are done for current user", () => {
    setCurrentUser("ABC123");
    const data = [{ id: "a" }, { id: "b" }];
    addDoneIds(DONE_STORAGE_KEYS.EMAIL, ["a", "b"]);

    expect(() => pickRandomPrompt(data, new Set(), DONE_STORAGE_KEYS.EMAIL)).toThrow(
      BANK_EXHAUSTED_ERRORS.PROMPT
    );
  });
});
