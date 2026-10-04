/**
 * 口语真题模考壳（SpeakingExamShell realMock）的回归锁：
 *   ① 旁白「继续」记已见失败 → 错误卡只给「重试同步」（以前唯一的按钮是「返回」= handleRestart，
 *      会把做完的 7 句跟读整个丢掉）；错误期间旁白卡隐藏，重试成功即收起错误；
 *   ② 访谈答完只等 answered seen：先存记录、出结果页，再 finish 且不等它（以前 finish 失败就把成绩挡在「重试同步」后面）；
 *   ③ 不出估分时不挂「中级」，说清楚原因；另一部分的原始分照常显示；记录里存 unanswered / unscored；
 *   ④ 死卷（已结束 / 过期 / 不存在）清本地存档，只给「重新组卷」+「返回真题专区」；
 *   ⑤ 另一份进行中的卷要确认才放弃；题目凑不齐只能回真题专区；
 *   ⑥ 重新组卷把内存里的旧卷作为 restartAttemptId 交给服务端，不再客户端先 finish。
 * 常规（非真题）模考的错误卡保持原样（「返回」= 回到开考页）。
 */
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => "ABC123", getSavedTier: () => "pro" }));
jest.mock("../lib/sessionStore", () => ({ saveSess: jest.fn(), loadDoneIds: jest.fn(() => []), addDoneIds: jest.fn() }));
jest.mock("../lib/realMockExam/client", () => ({
  prepareRealMockExam: jest.fn(),
  markRealMockSeen: jest.fn(),
  finishRealMockExam: jest.fn(),
  finishRealMockExamReliably: jest.fn(),
}));
jest.mock("../lib/mockExam/speakingPlanner", () => ({ buildSpeakingExam: jest.fn() }));
jest.mock("../components/shared/ExamAudioProvider", () => ({
  ExamAudioProvider: ({ children }) => children,
  useExamAudio: () => null,
}));
jest.mock("../components/speaking/SpeakingIntroScreen", () => ({ useNarration: () => {} }));

// 两个任务组件换成一键交卷的桩：壳只关心 onComplete 交上来的 items。
const mockTasks = { repeatResult: null, interviewResult: null, repeatProps: null, interviewProps: null };
jest.mock("../components/speaking/RepeatTask", () => ({
  RepeatTask: (props) => {
    mockTasks.repeatProps = props;
    return <button type="button" onClick={() => props.onComplete(mockTasks.repeatResult)}>完成跟读</button>;
  },
}));
jest.mock("../components/speaking/InterviewTask", () => ({
  InterviewTask: (props) => {
    mockTasks.interviewProps = props;
    return <button type="button" onClick={() => props.onComplete(mockTasks.interviewResult)}>完成访谈</button>;
  },
}));

import { SpeakingExamShell } from "../components/mockExam/SpeakingExamShell";
import { prepareRealMockExam, markRealMockSeen, finishRealMockExam, finishRealMockExamReliably } from "../lib/realMockExam/client";
import { buildSpeakingExam } from "../lib/mockExam/speakingPlanner";
import { saveSess } from "../lib/sessionStore";
import { saveMockCheckpoint } from "../lib/mockExam/storage";
import { RELEASE_ACTIVE_ATTEMPT_CONFIRM } from "../lib/realMockExam/messages";

const repeatSet = { id: "real_repeat_set", taskType: "repeat", sentences: Array.from({ length: 7 }, (_, i) => ({ id: `real_repeat_${i}`, sentence: `Sentence ${i}.` })) };
const interviewSet = { id: "real_interview_set", taskType: "interview", questions: Array.from({ length: 4 }, (_, i) => ({ id: `real_interview_${i}`, question: `Question ${i}?` })) };
const PAPER = {
  attemptId: "11111111-1111-4111-8111-111111111111", userCode: "ABC123", section: "speaking",
  templateVersion: "2026-full-v1", repeatSet, interviewSet, items: [repeatSet, interviewSet],
};
const SCOPE = { source: "real-bank", section: "speaking", userCode: "ABC123", templateVersion: "2026-full-v1" };

const scoredRepeat = (level = 4) => repeatSet.sentences.map((s) => ({
  id: s.id, sentence: s.sentence, recorded: true, transcript: s.sentence, score: { officialLevel: level, score: level, accuracy: 90 },
}));
const scoredInterview = (score = 3) => interviewSet.questions.map((q) => ({
  id: q.id, question: q.question, recorded: true, transcript: "Because it helps me focus.", aiScore: { score },
}));
const skipped = (item) => ({ ...item, recorded: false, transcript: null, score: null, aiScore: null });
const apiError = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

const errorCard = () => screen.queryByTestId("speaking-exam-error");
const buttonsIn = (el) => within(el).getAllByRole("button").map((b) => b.textContent);
const checkpointKeys = () => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  return keys.filter((k) => k.startsWith("toefl-mock-exam-checkpoint"));
};

async function startExam() {
  fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
  await screen.findByText("Speaking Section", { selector: "h3" });
}

/** 开考 → 跟读 → 访谈，一路成功，停在结果页。 */
async function runWholeExam() {
  await startExam();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "完成跟读" }));
  await screen.findByText("Take an Interview", { selector: "h3" });
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "完成访谈" }));
  await screen.findByText("口语模考结果");
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  prepareRealMockExam.mockResolvedValue(PAPER);
  markRealMockSeen.mockResolvedValue({ ok: true, status: "ok" });
  finishRealMockExamReliably.mockResolvedValue(true);
  mockTasks.repeatResult = { items: scoredRepeat(4) };
  mockTasks.interviewResult = { items: scoredInterview(3) };
});

describe("考试中途的同步失败", () => {
  test("跟读旁白记已见失败：错误卡只给「重试同步」、旁白卡隐藏；重试成功即收起错误进入跟读", async () => {
    markRealMockSeen.mockRejectedValueOnce(apiError("NETWORK_ERROR", "无法连接真题模考服务，请稍后重试。"));
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    await startExam();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const card = await screen.findByTestId("speaking-exam-error");
    expect(card).toHaveTextContent("无法连接真题模考服务，请稍后重试。");
    expect(buttonsIn(card)).toEqual(["重试同步"]);
    expect(screen.queryByText("Speaking Section", { selector: "h3" })).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "重试同步" }));
    await screen.findByRole("button", { name: "完成跟读" });
    expect(errorCard()).toBeNull();
    expect(markRealMockSeen.mock.calls).toEqual([[PAPER, [repeatSet]], [PAPER, [repeatSet]]]);
    expect(mockTasks.repeatProps.realMock).toBe(true);
  });

  test("访谈旁白失败后重试恢复；答完只等 answered seen，存好记录出结果页后才 finish，且不等它", async () => {
    finishRealMockExamReliably.mockReturnValue(new Promise(() => {})); // 永远不落地
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    await startExam();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "完成跟读" }));
    await screen.findByText("Take an Interview", { selector: "h3" });

    markRealMockSeen.mockRejectedValueOnce(apiError("REAL_MOCK_ERROR", "真题模考服务暂不可用，请稍后重试。"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const card = await screen.findByTestId("speaking-exam-error");
    expect(buttonsIn(card)).toEqual(["重试同步"]);
    expect(screen.queryByText("Take an Interview", { selector: "h3" })).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "重试同步" }));
    fireEvent.click(await screen.findByRole("button", { name: "完成访谈" }));
    expect(mockTasks.interviewProps.realMock).toBe(true);

    await screen.findByText("口语模考结果");
    expect(errorCard()).toBeNull();
    expect(screen.getByText(/本站模考估分/)).toHaveTextContent("本站模考估分 · 中高级"); // 28 + 12 = 40/55 → 4.5
    expect(markRealMockSeen).toHaveBeenCalledWith(PAPER, [repeatSet], { answered: true });
    expect(markRealMockSeen).toHaveBeenLastCalledWith(PAPER, [interviewSet], { answered: true });
    expect(finishRealMockExamReliably).toHaveBeenCalledWith(PAPER);
    expect(finishRealMockExam).not.toHaveBeenCalled();
    expect(saveSess).toHaveBeenCalledTimes(1);
    expect(saveSess.mock.invocationCallOrder[0]).toBeLessThan(finishRealMockExamReliably.mock.invocationCallOrder[0]);
  });

  test("交卷时 answered seen 失败：留在「重试同步」，重试成功才出成绩", async () => {
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    await startExam();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "完成跟读" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续" }));
    markRealMockSeen.mockRejectedValueOnce(apiError("NETWORK_ERROR", "无法连接真题模考服务，请稍后重试。"));
    fireEvent.click(await screen.findByRole("button", { name: "完成访谈" }));

    const card = await screen.findByTestId("speaking-exam-error");
    expect(buttonsIn(card)).toEqual(["重试同步"]);
    expect(saveSess).not.toHaveBeenCalled();
    expect(finishRealMockExamReliably).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "重试同步" }));
    await screen.findByText("口语模考结果");
    expect(errorCard()).toBeNull();
    expect(saveSess).toHaveBeenCalledTimes(1);
    expect(finishRealMockExamReliably).toHaveBeenCalledTimes(1);
  });
});

describe("结果页", () => {
  test("有题录了音却没评上分：不出估分、不挂等级并说明原因；另一部分原始分照常；记录存 unanswered / unscored", async () => {
    const onExit = jest.fn();
    const repeat = scoredRepeat(4);
    repeat[0] = { ...repeat[0], transcript: null, score: null }; // 录了音，识别失败
    const interview = scoredInterview(3);
    interview[0] = skipped(interview[0]); // 没作答
    mockTasks.repeatResult = { items: repeat };
    mockTasks.interviewResult = { items: interview };
    render(<SpeakingExamShell realMock onExit={onExit} />);
    await runWholeExam();

    expect(screen.getByText("本次不出估分")).toBeInTheDocument();
    expect(screen.queryByText(/高级|中级|初级/)).toBeNull();
    const note = screen.getByTestId("real-speaking-score-note");
    expect(note).toHaveTextContent("有 1 题录了音但评分没完成（语音识别或 AI 评分失败），本次不出估分。");
    expect(note).toHaveTextContent("1 题没有作答，按 0 分计入。");
    expect(screen.getByText("原始分 —/35")).toBeInTheDocument();
    expect(screen.getByText("原始分 9/20")).toBeInTheDocument(); // 0 + 3 + 3 + 3
    expect(screen.getByText("2.5/5")).toBeInTheDocument(); // 9 / 4 题，与原始分同一口径

    const saved = saveSess.mock.calls[0][0];
    expect(saved.band).toBeNull();
    expect(saved.details).toMatchObject({ realMock: true, unanswered: 1, unscored: 1, rawTotal: null, interviewScore: 2.5 });
    expect(saved.details.tasks.map((t) => t.score)).toEqual([null, 9]);
    expect(screen.getByTestId("real-speaking-record-link").getAttribute("href"))
      .toBe(`/real-bank/progress?mock=${encodeURIComponent(saved.date)}`);
    expect(screen.queryByText(/口语练习记录/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回真题专区" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("全部跳过：未作答按 0 计，照样出估分（1.0），不再显示「中级」或「语音识别失败」", async () => {
    mockTasks.repeatResult = { items: scoredRepeat(4).map(skipped) };
    mockTasks.interviewResult = { items: scoredInterview(3).map(skipped) };
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    await runWholeExam();

    expect(screen.getByText(/本站模考估分/)).toHaveTextContent("本站模考估分 · 初级");
    expect(screen.queryByText(/中级/)).toBeNull();
    expect(screen.getByTestId("real-speaking-score-note")).toHaveTextContent("11 题没有作答，按 0 分计入。");
    expect(screen.getByTestId("real-speaking-score-note")).not.toHaveTextContent("本次不出估分");
    expect(screen.getByText("原始分 0/35")).toBeInTheDocument();
    expect(screen.getByText("原始分 0/20")).toBeInTheDocument();
    expect(screen.queryByText("语音识别失败")).toBeNull();
    expect(saveSess.mock.calls[0][0]).toMatchObject({ band: 1, details: { rawTotal: 0, unanswered: 11, unscored: 0 } });
  });
});

describe("组卷与死卷", () => {
  test("死卷：清掉本地存档，只给「重新组卷」与「返回真题专区」；重新组卷是一次全新的组卷", async () => {
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    await startExam();
    expect(checkpointKeys()).toHaveLength(1);

    markRealMockSeen.mockRejectedValueOnce(apiError("ATTEMPT_EXPIRED", "试卷预留已过期，请重新开始。"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const card = await screen.findByTestId("speaking-exam-error");
    expect(card).toHaveTextContent("本卷无法继续作答");
    expect(buttonsIn(card)).toEqual(["重新组卷", "返回真题专区"]);
    expect(checkpointKeys()).toHaveLength(0);

    prepareRealMockExam.mockClear();
    fireEvent.click(within(card).getByRole("button", { name: "重新组卷" }));
    await screen.findByText("Speaking Section", { selector: "h3" });
    expect(prepareRealMockExam).toHaveBeenCalledWith("speaking", {});
    expect(errorCard()).toBeNull();
  });

  test("另一份进行中的卷：只有确认后才放弃它并重新组卷", async () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    prepareRealMockExam.mockRejectedValueOnce(apiError("ACTIVE_ATTEMPT", "已有正在进行的真题模考，请续考或选择重新开始。", { activeAttemptId: otherId }));
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));

    const card = await screen.findByTestId("speaking-exam-error");
    expect(card).toHaveTextContent("你还有一份没做完的同科真题模考");
    expect(buttonsIn(card)).toEqual(["放弃那份试卷并重新组卷", "返回真题专区"]);

    fireEvent.click(within(card).getByRole("button", { name: "放弃那份试卷并重新组卷" }));
    expect(confirm).toHaveBeenCalledWith(RELEASE_ACTIVE_ATTEMPT_CONFIRM);
    expect(prepareRealMockExam).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fireEvent.click(within(card).getByRole("button", { name: "放弃那份试卷并重新组卷" }));
    await screen.findByText("Speaking Section", { selector: "h3" });
    expect(prepareRealMockExam).toHaveBeenLastCalledWith("speaking", { restartAttemptId: otherId });
    confirm.mockRestore();
  });

  test("未做过的真题凑不齐：不给重试，只能回真题专区", async () => {
    prepareRealMockExam.mockRejectedValueOnce(apiError("REAL_MOCK_EXHAUSTED", "未做真题数量不足", { deficits: [{ taskType: "interview", need: 1, available: 0 }] }));
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));

    const card = await screen.findByTestId("speaking-exam-error");
    expect(card).toHaveTextContent("口语访谈还差 1 套");
    expect(buttonsIn(card)).toEqual(["返回真题专区"]);
  });

  test("录音中途刷新后的「重新组卷」把旧卷作为 restartAttemptId 交给服务端，失败可原样重试，不再客户端先 finish", async () => {
    saveMockCheckpoint({ phase: "repeat", exam: PAPER, repeatResults: null, interviewResults: null, finalScore: null, elapsed: 30 }, "repeat", SCOPE);
    prepareRealMockExam.mockRejectedValueOnce(apiError("NETWORK_ERROR", "无法连接真题模考服务，请稍后重试。"));
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    expect(screen.getByText("这项口语任务无法从录音中途恢复")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新组卷" }));
    const card = await screen.findByTestId("speaking-exam-error");
    expect(buttonsIn(card)).toEqual(["重试", "返回真题专区"]);

    prepareRealMockExam.mockResolvedValueOnce({ ...PAPER, attemptId: "33333333-3333-4333-8333-333333333333" });
    fireEvent.click(within(card).getByRole("button", { name: "重试" }));
    await screen.findByText("Speaking Section", { selector: "h3" });
    expect(prepareRealMockExam.mock.calls).toEqual([
      ["speaking", { restartAttemptId: PAPER.attemptId }],
      ["speaking", { restartAttemptId: PAPER.attemptId }],
    ]);
    expect(finishRealMockExam).not.toHaveBeenCalled();
    expect(errorCard()).toBeNull();
  });

  test("开考页写明：展示过的题永久计为已做，录音中途刷新即作废", () => {
    render(<SpeakingExamShell realMock onExit={jest.fn()} />);
    expect(screen.getByText("开考后展示过的题会永久计为已做；口语录音中途刷新或离开，本卷作废、需要重新组卷。")).toBeInTheDocument();
  });
});

describe("常规（非真题）口语模考不受影响", () => {
  test("组卷失败的错误卡仍是「返回」→ 回到开考页；开考页没有真题专属说明", async () => {
    buildSpeakingExam.mockReturnValue({ repeatSet: null, interviewSet: null });
    render(<SpeakingExamShell onExit={jest.fn()} />);
    expect(screen.queryByText(/本卷作废/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始考试" }));
    const card = await screen.findByTestId("speaking-exam-error");
    expect(card).toHaveTextContent("题库数据不足，无法开始考试。请稍后再试。");
    expect(buttonsIn(card)).toEqual(["返回"]);

    fireEvent.click(within(card).getByRole("button", { name: "返回" }));
    expect(errorCard()).toBeNull();
    expect(screen.getByRole("button", { name: "开始考试" })).toBeInTheDocument();
    expect(prepareRealMockExam).not.toHaveBeenCalled();
  });
});
