"use client";
import React from "react";
import { C, Btn } from "../shared/ui";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { BuildSentenceTask } from "../buildSentence/BuildSentenceTask";
import { WritingTask } from "../writing/WritingTask";

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
        <div style={{ background: "#f8fff8", border: "1px solid #cce8cc", borderRadius: 4, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 6 }}>Mock Exam Completed</div>
          <div style={{ fontSize: 13, color: C.t1, marginBottom: 8 }}>
            Overall percent: {session.aggregate.percent}%
          </div>
          {scoringPhase === "pending" && (
            <div style={{ fontSize: 13, color: C.blue }}>
              AI is scoring Task 2 and Task 3 in background. Please wait...
            </div>
          )}
          {scoringPhase === "error" && (
            <div style={{ fontSize: 13, color: C.red }}>
              AI scoring partially failed: {scoringError}
            </div>
          )}
          {(scoringPhase === "done" || scoringPhase === "error" || scoringPhase === "idle") && (
            <div style={{ marginTop: 10, borderTop: "1px solid #dfeadf", paddingTop: 10 }}>
              {examResultRows.map((row) => (
                <div key={row.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                  <span>{row.title}</span>
                  <span>{row.scoreText}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {session.status === MOCK_EXAM_STATUS.ABORTED && (
        <div style={{ background: "#fff6f6", border: "1px solid #f0cccc", borderRadius: 4, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Mock Exam Aborted</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {session.status === MOCK_EXAM_STATUS.RUNNING && (
          <Btn onClick={onAbort} variant="danger">Abort</Btn>
        )}
        {(session.status === MOCK_EXAM_STATUS.COMPLETED || session.status === MOCK_EXAM_STATUS.ABORTED) && (
          <Btn onClick={onStartNew}>Start New Mock Exam</Btn>
        )}
        <Btn onClick={onExit} variant="secondary">Back</Btn>
      </div>
    </div>
  );
}
