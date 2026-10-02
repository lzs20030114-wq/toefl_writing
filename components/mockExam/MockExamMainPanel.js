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
import { markRealMockSeen } from "../../lib/realMockExam/client";
import { TaskTransitionCard } from "./TaskTransitionCard";

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
}) {
  const [transitionTaskId, setTransitionTaskId] = useState("");
  const [transitionLeft, setTransitionLeft] = useState(0);
  const seenBsIdsRef = useRef(new Set());
  const taskTimeSeconds = realMockPaper && Number.isFinite(realMockTaskDeadline)
    ? Math.max(1, Math.min(currentTask?.seconds || 1, Math.ceil((realMockTaskDeadline - Date.now()) / 1000)))
    : currentTask?.seconds;
  const beforeBsQuestion = useCallback(async (question) => {
    if (!realMockPaper) return;
    const item = realMockPaper.bsQuestions.find((candidate) => candidate.id === question?.id);
    if (!item) throw new Error("当前真题不在预选试卷中");
    await markRealMockSeen(realMockPaper, [item]);
    seenBsIdsRef.current.add(item.id);
    addDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE, [item.id]);
    onRealMockSeen?.(item.id);
  }, [realMockPaper, onRealMockSeen]);

  useEffect(() => {
    if (session.status !== MOCK_EXAM_STATUS.RUNNING || !currentTask?.taskId) return;
    if (transitionTaskId === currentTask.taskId) return;
    setTransitionTaskId(currentTask.taskId);
    setTransitionLeft(TRANSITION_SECONDS);
  }, [session.status, currentTask?.taskId, transitionTaskId]);

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
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      {showTransition && (
        <TaskTransitionCard
          taskId={currentTask?.taskId}
          seconds={currentTask?.seconds}
          restSeconds={transitionLeft}
          onSkip={() => setTransitionLeft(0)}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && !showTransition && currentTask?.taskId === TASK_IDS.BUILD_SENTENCE && (
        <BuildSentenceTask
          embedded
          questions={realMockPaper?.bsQuestions}
          initialResults={realMockPaper ? realMockBsProgress : null}
          autoStartOnMount={!!realMockPaper && !!realMockTaskDeadline}
          beforeQuestion={realMockPaper ? beforeBsQuestion : null}
          recordGroupDone={!realMockPaper}
          onProgress={realMockPaper ? onRealMockBsProgress : null}
          persistSession={false}
          onExit={onAbort}
          onTimerChange={onTimerChange}
          timeLimitSeconds={taskTimeSeconds}
          practiceMode={mode}
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

      {session.status === MOCK_EXAM_STATUS.RUNNING && (
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onAbort} variant="danger">中止</Btn>
          <Btn onClick={onExit} variant="secondary">返回</Btn>
        </div>
      )}
    </div>
  );
}
