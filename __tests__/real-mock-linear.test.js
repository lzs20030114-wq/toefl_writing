import { TASK_IDS } from "../lib/mockExam/contracts";
import { updateTaskScore } from "../lib/mockExam/stateMachine";
import { finalizeRealWriting } from "../lib/realMockExam/linearWritingService";
import { scoreRealSpeaking, scoreRealWriting } from "../lib/realMockExam/linearScore";
import { buildRealBankCoverage, buildRealBankEntries, realSessionItemIds, realSessionScore } from "../lib/realBankHistory";
import { isRealSession, realItemIdOf } from "../lib/admin/realSession";

const essay = (id) => ({ promptData: { id }, userText: "A complete essay", reportLanguage: "zh" });
function writingSession() {
  return {
    status: "completed",
    attempts: {
      [TASK_IDS.BUILD_SENTENCE]: { score: 7, maxScore: 10, meta: {} },
      [TASK_IDS.EMAIL_WRITING]: { score: null, maxScore: 5, meta: { deferredPayload: essay("real_email_1") } },
      [TASK_IDS.ACADEMIC_WRITING]: { score: null, maxScore: 5, meta: { deferredPayload: essay("real_discussion_1") } },
    },
  };
}

test("writing uses 10+5+5 raw points and retries only the failed AI task", async () => {
  const evaluate = jest.fn()
    .mockResolvedValueOnce({ score: 4 })
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({ score: 3 });
  const first = await finalizeRealWriting(writingSession(), evaluate, updateTaskScore);
  expect(first.phase).toBe("error");
  expect(first.session.attempts[TASK_IDS.EMAIL_WRITING].score).toBe(4);
  expect(first.session.attempts[TASK_IDS.ACADEMIC_WRITING].score).toBeNull();
  expect(first.session.aggregate.band).toBeNull();
  const second = await finalizeRealWriting(first.session, evaluate, updateTaskScore);
  expect(second.phase).toBe("done");
  expect(second.session.aggregate).toMatchObject({ raw: 14, maxRaw: 20, percent: 70, band: 4.5 });
  expect(evaluate.mock.calls.map((call) => call[0])).toEqual(["email", "discussion", "discussion"]);
  expect(scoreRealWriting({ ...writingSession().attempts, [TASK_IDS.EMAIL_WRITING]: { score: null } }).band).toBeNull();
});

// This test used to be "requires all 11 valid item scores": ANY item without a score —
// including one the student simply skipped — nulled the band AND both sub-scores, so a
// single 「Skip this sentence」 wiped the whole estimate. Now a skipped item (recorded:
// false) is 0, and only a recorded-but-unscored item (STT / AI failure) withholds the band.
describe("speaking 7+4 scoring", () => {
  const repeatItems = (level = 4) => Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, recorded: true, score: { officialLevel: level } }));
  const interviewItems = (score = 3) => Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, recorded: true, aiScore: { score } }));

  test("all 11 scored → raw, percent and band", () => {
    expect(scoreRealSpeaking(repeatItems(), interviewItems())).toEqual({
      raw: 40, maxRaw: 55, percent: 73, band: 4.5, repeatRaw: 28, interviewRaw: 12, unanswered: 0, unscored: 0,
    });
  });

  test("an unrecorded item counts 0 and the band is still computed", () => {
    const repeat = repeatItems();
    repeat[3] = { id: "r3", recorded: false, transcript: null, score: null };
    expect(scoreRealSpeaking(repeat, interviewItems())).toMatchObject({
      raw: 36, repeatRaw: 24, interviewRaw: 12, band: 4.5, unanswered: 1, unscored: 0,
    });
  });

  test("skipping all 11 is an estimate of 0, not a missing one", () => {
    const skip = (item) => ({ ...item, recorded: false, score: null, aiScore: null });
    expect(scoreRealSpeaking(repeatItems().map(skip), interviewItems().map(skip))).toMatchObject({
      raw: 0, percent: 0, band: 1, repeatRaw: 0, interviewRaw: 0, unanswered: 11, unscored: 0,
    });
  });

  test("a recorded-but-unscored item withholds the band but keeps the other part's raw", () => {
    const repeat = repeatItems();
    repeat[0] = { id: "r0", recorded: true, transcript: null, score: null };
    expect(scoreRealSpeaking(repeat, interviewItems())).toMatchObject({
      raw: null, percent: null, band: null, repeatRaw: null, interviewRaw: 12, unanswered: 0, unscored: 1,
    });
  });

  test("an AI scoring error is unscored, not zero", () => {
    const interview = interviewItems();
    interview[2] = { id: "q2", recorded: true, transcript: "I like it.", aiScore: { error: "STT failed" } };
    expect(scoreRealSpeaking(repeatItems(), interview)).toMatchObject({
      raw: null, band: null, repeatRaw: 28, interviewRaw: null, unanswered: 0, unscored: 1,
    });
  });

  test("a legacy item without `recorded` and without a score is unscored", () => {
    const repeat = repeatItems();
    repeat[6] = { id: "r6", score: null };
    expect(scoreRealSpeaking(repeat, interviewItems())).toMatchObject({ band: null, repeatRaw: null, interviewRaw: 12, unscored: 1, unanswered: 0 });
    // ...and the old shape with scores but no flag keeps scoring as before.
    const legacy = repeatItems().map(({ recorded, ...item }) => item);
    expect(scoreRealSpeaking(legacy, interviewItems()).band).toBe(4.5);
  });

  test("unanswered and unscored together: no band, counts reported", () => {
    const repeat = repeatItems();
    repeat[1] = { id: "r1", recorded: false, score: null };
    const interview = interviewItems();
    interview[0] = { id: "q0", recorded: true, aiScore: null };
    expect(scoreRealSpeaking(repeat, interview)).toMatchObject({ band: null, repeatRaw: 24, interviewRaw: null, unanswered: 1, unscored: 1 });
  });

  test("anything but exactly 7 + 4 items stays unavailable", () => {
    const none = { raw: null, band: null, repeatRaw: null, interviewRaw: null };
    expect(scoreRealSpeaking(repeatItems().slice(0, 6), interviewItems())).toMatchObject(none);
    expect(scoreRealSpeaking(repeatItems(), [...interviewItems(), { recorded: true, aiScore: { score: 3 } }])).toMatchObject(none);
    expect(scoreRealSpeaking(null, undefined)).toMatchObject(none);
  });
});

test("timed-out blank essays are explicit zero without AI calls", async () => {
  const session = writingSession();
  session.attempts[TASK_IDS.BUILD_SENTENCE].score = 0;
  session.attempts[TASK_IDS.EMAIL_WRITING].meta.deferredPayload.userText = "";
  session.attempts[TASK_IDS.ACADEMIC_WRITING].meta.deferredPayload.userText = "   ";
  const evaluate = jest.fn();
  const result = await finalizeRealWriting(session, evaluate, updateTaskScore);
  expect(result.phase).toBe("done");
  expect(result.session.aggregate).toMatchObject({ raw: 0, maxRaw: 20, band: 1 });
  expect(result.session.attempts[TASK_IDS.EMAIL_WRITING].meta.unanswered).toBe(true);
  expect(evaluate).not.toHaveBeenCalled();
});

test("mock coverage and admin detection count only seen typed items", () => {
  const session = {
    type: "mock", date: "2026-10-02T10:00:00.000Z",
    details: { real: true, source: "real-bank", realMock: true, section: "reading", subtype: "mock",
      itemIds: ["real_ctw_1", "real_ap_1", "real_rdl_1"], seenItemIds: ["real_ctw_1", "real_ap_1"],
      items: [{ id: "real_ctw_1", taskType: "ctw" }, { id: "real_ap_1", taskType: "ap" }, { id: "real_rdl_1", taskType: "rdl" }],
      scoredCorrect: 13, scoredTotal: 35,
    },
  };
  expect(isRealSession(session)).toBe(true);
  expect(realItemIdOf({ ...session, ...session.details })).toBe("real_ctw_1");
  expect(realSessionItemIds(session)).toEqual(["real_ctw_1", "real_ap_1"]);
  expect(realSessionScore(session).label).toBe("13/35");
  const entries = buildRealBankEntries([session], { resolveItemRef: () => ({ id: "wrong", type: "rdl" }) });
  expect(entries[0].subtype).toBe("mock-reading");
  const coverage = buildRealBankCoverage(entries, { ctw: 10, ap: 10, rdl: 10 });
  expect(coverage.find((row) => row.subtype === "ctw").done).toBe(1);
  expect(coverage.find((row) => row.subtype === "ap").done).toBe(1);
  expect(coverage.find((row) => row.subtype === "rdl").done).toBe(0);
});
