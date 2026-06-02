import { isV1Session, BANK_EPOCH_CURRENT } from "../lib/history/bankVersion";
import { buildRetryHref, peekRetrySnapshot, clearRetrySnapshot, startRetryFromHistory } from "../lib/history/retry";

describe("bankVersion.isV1Session", () => {
  test("pre-swap session (by date) is V1", () => {
    expect(isV1Session({ date: "2026-05-01T00:00:00.000Z" })).toBe(true);
  });

  test("post-swap session (by date) is not V1", () => {
    expect(isV1Session({ date: "2026-06-10T00:00:00.000Z" })).toBe(false);
  });

  test("bankEpoch stamp takes precedence over date", () => {
    // dated pre-swap but stamped current → not V1
    expect(isV1Session({ date: "2026-05-01T00:00:00.000Z", details: { bankEpoch: BANK_EPOCH_CURRENT } })).toBe(false);
    // dated post-swap but stamped older → V1
    expect(isV1Session({ date: "2026-06-10T00:00:00.000Z", details: { bankEpoch: BANK_EPOCH_CURRENT - 1 } })).toBe(true);
  });

  test("garbage / missing date → not V1", () => {
    expect(isV1Session(null)).toBe(false);
    expect(isV1Session({})).toBe(false);
    expect(isV1Session({ date: "not-a-date" })).toBe(false);
  });
});

describe("retry.buildRetryHref", () => {
  test("email session builds /email-writing with all params", () => {
    const href = buildRetryHref({
      type: "email",
      mode: "practice",
      details: { promptId: "em30", practiceRootId: "r1", practiceAttempt: 2, feedback: { reportLanguage: "en" } },
    });
    expect(href).toContain("/email-writing?");
    expect(href).toContain("retryPromptId=em30");
    expect(href).toContain("practiceRootId=r1");
    expect(href).toContain("retryFromAttempt=2");
    expect(href).toContain("mode=practice");
    expect(href).toContain("lang=en");
  });

  test("discussion session uses /academic-writing", () => {
    expect(buildRetryHref({ type: "discussion", details: { promptId: "ad61" } }))
      .toContain("/academic-writing?retryPromptId=ad61");
  });

  test("standard mode omits the mode param", () => {
    expect(buildRetryHref({ type: "email", mode: "standard", details: { promptId: "em1" } })).not.toContain("mode=");
  });

  test("non-writing type or missing id → empty string", () => {
    expect(buildRetryHref({ type: "bs", details: { promptId: "x" } })).toBe("");
    expect(buildRetryHref({ type: "email", details: {} })).toBe("");
    expect(buildRetryHref(null)).toBe("");
  });
});

describe("retry snapshot handoff", () => {
  beforeAll(() => {
    // jsdom location is read-only; redefine so href assignment doesn't try to navigate.
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: { href: "" } });
  });
  beforeEach(() => {
    sessionStorage.clear();
    window.location.href = "";
  });

  test("stashes the exact practiced snapshot, retrievable by matching id", () => {
    // em30 exists in both V1 and V2 with different content — the snapshot must win.
    const promptData = { id: "em30", to: "Professor", scenario: "OLD V1 scenario", direction: "do x", goals: ["a", "b", "c"] };
    startRetryFromHistory({ type: "email", details: { promptId: "em30", promptData } });
    expect(window.location.href).toContain("/email-writing?retryPromptId=em30");
    expect(peekRetrySnapshot("em30")).toEqual(promptData);
  });

  test("peek returns null for a non-matching id, and after clear", () => {
    const promptData = { id: "em30", scenario: "x", direction: "y", goals: ["a", "b", "c"] };
    startRetryFromHistory({ type: "email", details: { promptId: "em30", promptData } });
    expect(peekRetrySnapshot("em31")).toBeNull();
    clearRetrySnapshot();
    expect(peekRetrySnapshot("em30")).toBeNull();
  });

  test("non-retryable session is a no-op (no navigation, no stash)", () => {
    startRetryFromHistory({ type: "bs", details: {} });
    expect(window.location.href).toBe("");
    expect(peekRetrySnapshot("anything")).toBeNull();
  });
});
