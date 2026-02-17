"use client";
import React from "react";
import { C, Btn } from "../shared/ui";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { BuildSentenceTask } from "../buildSentence/BuildSentenceTask";
import { WritingTask } from "../writing/WritingTask";
import { MockExamResult } from "./MockExamResult";

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
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 6, padding: 24 }}>
      {session.status === MOCK_EXAM_STATUS.RUNNING && currentTask?.taskId === TASK_IDS.BUILD_SENTENCE && (
        <BuildSentenceTask
          embedded
          persistSession={false}
          onExit={onAbort}
          onTimerChange={onTimerChange}
          onComplete={(payload) => {
            onSubmitTaskResult({
              score: payload.correct || 0,
              maxScore: payload.total || 10,
              meta: {
                type: "bs",
                detailCount: Array.isArray(payload.details) ? payload.details.length : 0,
                details: Array.isArray(payload.details) ? payload.details : [],
              },
            });
          }}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && currentTask?.taskId === TASK_IDS.EMAIL_WRITING && (
        <WritingTask
          type="email"
          embedded
          persistSession={false}
          deferScoring
          onExit={onAbort}
          onTimerChange={onTimerChange}
          onComplete={(payload) => {
            onSubmitTaskResult({
              score: null,
              maxScore: 5,
              meta: {
                type: "email",
                deferred: true,
                wordCount: payload.wordCount || 0,
                deferredPayload: payload?.details || null,
              },
            });
          }}
        />
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && currentTask?.taskId === TASK_IDS.ACADEMIC_WRITING && (
        <WritingTask
          type="discussion"
          embedded
          persistSession={false}
          deferScoring
          onExit={onAbort}
          onTimerChange={onTimerChange}
          onComplete={(payload) => {
            onSubmitTaskResult({
              score: null,
              maxScore: 5,
              meta: {
                type: "discussion",
                deferred: true,
                wordCount: payload.wordCount || 0,
                deferredPayload: payload?.details || null,
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
        />
      )}

      {session.status === MOCK_EXAM_STATUS.ABORTED && (
        <div style={{ background: "#fff6f6", border: "1px solid #f0cccc", borderRadius: 4, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Mock Exam Aborted</div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Btn onClick={onStartNew}>Start New Mock Exam</Btn>
            <Btn onClick={onExit} variant="secondary">Back</Btn>
          </div>
        </div>
      )}

      {session.status === MOCK_EXAM_STATUS.RUNNING && (
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onAbort} variant="danger">Abort</Btn>
          <Btn onClick={onExit} variant="secondary">Back</Btn>
        </div>
      )}
    </div>
  );
}
