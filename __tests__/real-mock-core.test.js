import { planRealMockExam, loadRealMockPool } from "../lib/realMockExam/planner";
import { canonicalId } from "../lib/realMockExam/identity";

const deterministic = () => 0.5;

function counts(items) {
  return items.reduce((map, item) => {
    map[item.taskType] = (map[item.taskType] || 0) + 1;
    return map;
  }, {});
}

function assertNoRepeat(items) {
  const keys = items.flatMap((x) => x.realMockKeys);
  expect(new Set(keys).size).toBe(keys.length);
}

test.each([
  ["reading", { ctw: 2, rdl: 4, ap: 1 }, { ctw: 1, ap: 1 }, { ctw: 1, rdl: 2 }],
  ["listening", { lcr: 12, lc: 3, la: 3, lat: 2 }, { lcr: 3, lc: 2, lat: 2 }, { lcr: 7, lc: 2, la: 2 }],
  ["speaking", { repeat: 1, interview: 1 }, {}, {}],
  ["writing", { bs: 10, email: 1, discussion: 1 }, {}, {}],
])("%s uses complete real mapped material and exact dual-route quota", (section, m1Counts, upperCounts, lowerCounts) => {
  const pool = loadRealMockPool(section);
  const result = planRealMockExam(section, { pool, rng: deterministic });
  expect(result.ok).toBe(true);
  const paper = result.paper;
  expect(counts(paper.m1Items)).toEqual(m1Counts);
  expect(counts(paper.m2ByPath.upper)).toEqual(upperCounts);
  expect(counts(paper.m2ByPath.lower)).toEqual(lowerCounts);
  assertNoRepeat([...paper.m1Items, ...paper.m2ByPath.upper]);
  assertNoRepeat([...paper.m1Items, ...paper.m2ByPath.lower]);
  expect(paper.m1Items.every((x) => x.realMockDifficulty === "unknown" && x.tier !== "legacy")).toBe(true);
  if (section === "reading") {
    expect(paper.m1Items.filter((x) => x.realMockRole === "scored").reduce((n, x) => n + (x.blanks?.length || x.questions?.length), 0)).toBe(20);
    expect(paper.m1Items.filter((x) => x.realMockRole === "practice-extra").reduce((n, x) => n + (x.blanks?.length || x.questions?.length), 0)).toBe(15);
  }
  if (section === "listening") {
    expect(paper.m1Items.filter((x) => x.realMockRole === "scored").reduce((n, x) => n + (x.questions?.length || 1), 0)).toBe(20);
    expect(paper.m1Items.filter((x) => x.realMockRole === "practice-extra").reduce((n, x) => n + (x.questions?.length || 1), 0)).toBe(12);
  }
});

test("completed and alias-equivalent material is never refilled", () => {
  const pool = loadRealMockPool("reading");
  const first = planRealMockExam("reading", { pool, rng: deterministic });
  const already = first.paper.m1Items[0];
  const second = planRealMockExam("reading", { pool, doneIds: [already.id], rng: deterministic });
  expect(second.ok).toBe(true);
  expect(second.paper.items.some((x) => x.realMockKey === already.realMockKey)).toBe(false);
  expect(canonicalId(already.id)).toBe(already.canonicalId);
});

test("exhaustion reports type and gap instead of shrinking the exam", () => {
  const pool = loadRealMockPool("speaking");
  const result = planRealMockExam("speaking", { pool: { ...pool, repeat: [] }, rng: deterministic });
  expect(result.ok).toBe(false);
  expect(result.code).toBe("REAL_MOCK_EXHAUSTED");
  expect(result.deficits).toEqual(expect.arrayContaining([expect.objectContaining({ taskType: "repeat", need: 1, available: 0, gap: 1 })]));
});

test("incomplete audio materials are filtered before planning", () => {
  const pool = loadRealMockPool("speaking");
  expect(pool.repeat.every((x) => x.sentences.length === 7 && x.sentences.every((s) => s.audio_url?.startsWith("https://")))).toBe(true);
  expect(pool.interview.every((x) => x.questions.length === 4 && x.questions.every((q) => q.audio_url?.startsWith("https://")))).toBe(true);
});

test("a real interview question repeated across different four-question sets excludes the entire second set", () => {
  const pool = loadRealMockPool("speaking");
  const earlier = pool.interview.find((x) => x.id === "real_interview_28_1");
  const later = pool.interview.find((x) => x.id === "real_interview_rf0713_1");
  expect(earlier?.questions).toHaveLength(4);
  expect(later?.questions).toHaveLength(4);
  const sharedKeys = earlier.realMockKeys.filter((key) => key.startsWith("material:") && later.realMockKeys.includes(key));
  expect(sharedKeys.length).toBeGreaterThan(0);
  expect(earlier.realMockKey).not.toBe(later.realMockKey); // the whole sets differ

  const seenResult = planRealMockExam("speaking", { pool, blockedKeys: earlier.realMockKeys, rng: deterministic });
  expect(seenResult.ok).toBe(true);
  expect(seenResult.paper.interviewSet.id).not.toBe(later.id);
  expect(seenResult.paper.interviewSet.questions).toHaveLength(4);

  const sharedChild = earlier.questions.find((q) => later.questions.some((other) =>
    q.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === other.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  ));
  expect(sharedChild).toBeDefined();
  const historyResult = planRealMockExam("speaking", { pool, doneIds: [sharedChild.id], rng: deterministic });
  expect(historyResult.ok).toBe(true);
  expect(historyResult.paper.interviewSet.id).not.toBe(earlier.id);
  expect(historyResult.paper.interviewSet.id).not.toBe(later.id);
  expect(historyResult.paper.interviewSet.questions).toHaveLength(4);
});
