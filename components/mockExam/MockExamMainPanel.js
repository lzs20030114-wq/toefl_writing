"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, Btn } from "../shared/ui";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { BuildSentenceTask } from "../buildSentence/BuildSentenceTask";
import { WritingTask } from "../writing/WritingTask";
import { addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { buildMockDraftKey } from "../../lib/mockExam/storage";
import { MockExamResult } from "./MockExamResult";
import { syncRealMockSeen } from "../../lib/realMockExam/seenSync";
import { TaskTransitionCard } from "./TaskTransitionCard";
import { ETS } from "../shared/etsExamUi";

const TRANSITION_SECONDS = 25;

export function MockExamMainPanel({
  session,
  currentTask,
  scoringPhase,
  scoringError,
  examResultRows,
  onTimerChange,
  onSubmitTaskResult,
  onAbort,
  onStartNew,
  onExit,
  mode,
  canRetryScoring,
  onRetryScoring,
  reportLanguage,
  realMockPaper,
  realMockBsProgress,
  onRealMockBsProgress,
  realMockSeenItemIds,
  onRealMockSeen,
  realMockTaskDeadline,
  onBsQuestionChange,
  onRealMockSyncFatal,
}) {
  // 真题模考：作答页换成真题（ETS 机考）外观 —— 白底、无卡片框，顶栏由 MockExamShell 换成考试细栏。
  const ets = !!realMockPaper;
  const [transitionTaskId, setTransitionTaskId] = useState("");
  const [transitionLeft, setTransitionLeft] = useState(0);
  const seenBsIdsRef = useRef(new Set());
  const taskTimeSeconds = realMockPaper && Number.isFinite(realMockTaskDeadline)
    ? Math.max(1, Math.min(currentTask?.seconds || 1, Math.ceil((realMockTaskDeadline - Date.now()) / 1000)))
    : currentTask?.seconds;
  // 已见在后台同步（lib/realMockExam/seenSync），造句题一出现就能作答。
  const onBsQuestionShown = useCallback((question) => {
    if (!realMockPaper) return;
    const item = realMockPaper.bsQuestions.find((candidate) => candidate.id === question?.id);
    if (!item || seenBsIdsRef.current.has(item.id)) return;
    seenBsIdsRef.current.add(item.id);
    addDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE, [item.id]);
    onRealMockSeen?.(item.id);
    syncRealMockSeen(realMockPaper, [item], { onFatal: onRealMockSyncFatal });
  }, [realMockPaper, onRealMockSeen, onRealMockSyncFatal]);

  useEffect(() => {
    if (session.status !== MOCK_EXAM_STATUS.RUNNING || !currentTask?.taskId) return;
    if (transitionTaskId === currentTask.taskId) return;
    setTransitionTaskId(currentTask.taskId);
    // A real-mock task that already has a deadline was started before this mount
    // (page reload): its clock is running, so go straight back to it — the 25 s
    // card would otherwise show the full time limit while the deadline ticks on.
    setTransitionLeft(realMockPaper && Number.isFinite(realMockTaskDeadline) ? 0 : TRANSITION_SECONDS);
  }, [session.status, currentTask?.taskId, transitionTaskId, realMockPaper, realMockTaskDeadline]);

  useEffect(() => {
    if (transitionLeft <= 0) return;
    const timer = setInterval(() => {
      setTransitionLeft((v) => (v <= 1 ? 0 : v - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [transitionLeft]);

  const showTransition =
    session.status === MOCK_EXAM_STATUS.RUNNING &&
    !!currentTask?.taskId &&
    transitionTaskId === currentTask.taskId &&
    transitionLeft > 0;

  useEffect(() => {
    if (showTransition) onTimerChange?.({ timeLeft: null, isRunning: false, phase: "transition" });
  }, [showTransition, onTimerChange]);

  return (
    <div style={ets ? { background: ETS.canvas, padding: 0 } : { background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      {showTransition && (
        // 真题外观的外壳铺满整宽，过渡卡单独收回到阅读宽度。
        <div style={ets ? { maxWidth: 860, margin: "32px auto 0", padding: "0 20px" } : undefined}>
          <TaskTransitionCard
            taskId={currentTask?.taskId}
            seconds={currentTask?.seconds}
            restSeconds={transitionLeft}
            onSkip={() => setTransitionLeft(0)}
          />
        </div>
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && !showTransition && currentTask?.taskId === TASK_IDS.BUILD_SENTENCE && (
        <BuildSentenceTask
          embedded
          questions={realMockPaper?.bsQuestions}
          initialResults={realMockPaper ? realMockBsProgress : null}
          autoStartOnMount={!!realMockPaper && !!realMockTaskDeadline}
          onQuestionShown={realMockPaper ? onBsQuestionShown : null}
          recordGroupDone={!realMockPaper}
          onProgress={realMockPaper ? onRealMockBsProgress : null}
          persistSession={false}
          onExit={onAbort}
          onTimerChange={onTimerChange}
          timeLimitSeconds={taskTimeSeconds}
          practiceMode={mode}
          etsLook={ets}
          onQuestionChange={ets ? onBsQuestionChange : null}
          onComplete={(payload) => {
            onSubmitTaskResult({
              score: payload.correct || 0,
              maxScore: payload.total || 10,
              meta: {
                type: "bs",
                detailCount: Array.isArray(payload.details) ? payload.details.length : 0,
                details: Array.isArray(payload.details) ? payload.details : [],
                ...(realMockPaper ? { seenItemIds: [...new Set([...(realMockSeenItemIds || []), ...seenBsIdsRef.current])] } : {}),
              },
            });
          }}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && !showTransition && currentTask?.taskId === TASK_IDS.EMAIL_WRITING && (
        <WritingTask
          type="email"
          prompts={realMockPaper ? [realMockPaper.emailPrompt] : null}
          initialPromptId={realMockPaper?.emailPrompt?.id || ""}
          embedded
          persistSession={false}
          deferScoring
          onExit={onAbort}
          onTimerChange={onTimerChange}
          timeLimitSeconds={taskTimeSeconds}
          practiceMode={mode}
          showTaskIntro={false}
          etsLook={ets}
          autoStartOnMount
          reportLanguage={reportLanguage}
          draftKey={buildMockDraftKey(session.id, currentTask.taskId)}
          onComplete={(payload) => {
            const promptId = payload?.details?.promptData?.id;
            if (promptId) {
              addDoneIds(DONE_STORAGE_KEYS.EMAIL, [promptId]);
            }
            onSubmitTaskResult({
              score: null,
              maxScore: 5,
              meta: {
                type: "email",
                deferred: true,
                wordCount: payload.wordCount || 0,
                deferredPayload: payload?.details || null,
                reportLanguage: payload?.details?.reportLanguage || reportLanguage,
              },
            });
          }}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && !showTransition && currentTask?.taskId === TASK_IDS.ACADEMIC_WRITING && (
        <WritingTask
          type="discussion"
          prompts={realMockPaper ? [realMockPaper.discussionPrompt] : null}
          initialPromptId={realMockPaper?.discussionPrompt?.id || ""}
          embedded
          persistSession={false}
          deferScoring
          onExit={onAbort}
          onTimerChange={onTimerChange}
          timeLimitSeconds={taskTimeSeconds}
          practiceMode={mode}
          showTaskIntro={false}
          etsLook={ets}
          autoStartOnMount
          reportLanguage={reportLanguage}
          draftKey={buildMockDraftKey(session.id, currentTask.taskId)}
          onComplete={(payload) => {
            const promptId = payload?.details?.promptData?.id;
            if (promptId) {
              addDoneIds(DONE_STORAGE_KEYS.DISCUSSION, [promptId]);
            }
            onSubmitTaskResult({
              score: null,
              maxScore: 5,
              meta: {
                type: "discussion",
                deferred: true,
                wordCount: payload.wordCount || 0,
                deferredPayload: payload?.details || null,
                reportLanguage: payload?.details?.reportLanguage || reportLanguage,
              },
            });
          }}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.COMPLETED && session.aggregate && (
        <MockExamResult
          session={session}
          scoringPhase={scoringPhase}
          scoringError={scoringError}
          examResultRows={examResultRows}
          onStartNew={onStartNew}
          onExit={onExit}
          canRetryScoring={canRetryScoring}
          onRetryScoring={onRetryScoring}
          reportLanguage={reportLanguage}
          realMock={!!realMockPaper}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.ABORTED && (
        <div style={{ background: "#fff6f6", border: "1px solid #f0cccc", borderRadius: 4, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>模考已中止</div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Btn onClick={onStartNew}>开始新模考</Btn>
            <Btn onClick={onExit} variant="secondary">返回</Btn>
          </div>
        </div>
      )}

      {/* 真题外观：「中止」在考试头上（MockExamShell 传给 EtsTopBar），「返回」是考试头左侧那颗，正文里不再放。 */}
      {session.status === MOCK_EXAM_STATUS.RUNNING && !ets && (
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onAbort} variant="danger">中止</Btn>
          <Btn onClick={onExit} variant="secondary">返回</Btn>
        </div>
      )}
    </div>
  );
}
