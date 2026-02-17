import { loadMockExamHistory, saveMockExamSession } from "../lib/mockExam/storage";

describe("mock exam storage", () => {
  const KEY = "toefl-mock-exam-history";

  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test("saveMockExamSession keeps working when storage quota write fails once", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });

    saveMockExamSession({ id: "m1", status: "done" });

    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.sessions[0].id).toBe("m1");
  });

  test("loadMockExamHistory returns safe fallback for invalid json", () => {
    localStorage.setItem(KEY, "{bad");
    expect(loadMockExamHistory()).toEqual({ sessions: [] });
  });
});
