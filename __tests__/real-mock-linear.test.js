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

test("speaking 7+4 scoring requires all 11 valid item scores", () => {
  const repeat = Array.from({ length: 7 }, () => ({ score: { officialLevel: 4 } }));
  const interview = Array.from({ length: 4 }, () => ({ aiScore: { score: 3 } }));
  expect(scoreRealSpeaking(repeat, interview)).toMatchObject({ raw: 40, maxRaw: 55, repeatRaw: 28, interviewRaw: 12 });
  interview[2].aiScore = { error: "STT failed" };
  expect(scoreRealSpeaking(repeat, interview).band).toBeNull();
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
