"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, TopBar } from "../shared/ui";
import { mockExamRunner } from "../../lib/mockExam/runner";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { loadMockExamHistory, saveMockExamSession } from "../../lib/mockExam/storage";
import { upsertMockSess } from "../../lib/sessionStore";
import { buildPersistPayload, finalizeDeferredScoringSession } from "../../lib/mockExam/service";
import { evaluateWritingResponse } from "../../lib/ai/writingEval";
import { SectionTimerPanel } from "./SectionTimerPanel";
import { MockExamStartCard } from "./MockExamStartCard";
import { MockExamMainPanel } from "./MockExamMainPanel";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";
import { getDefaultMockExamBlueprint } from "../../lib/mockExam/planner";

export function MockExamShell({ onExit, mode = PRACTICE_MODE.STANDARD }) {
  const [session, setSession] = useState(null);
  const [hist] = useState(() => loadMockExamHistory());
  const [sectionTimer, setSectionTimer] = useState(null);
  const [scoringPhase, setScoringPhase] = useState("idle"); // idle | pending | done | error
  const [scoringError, setScoringError] = useState("");
  const finalizedSessionIdsRef = useRef(new Set());

  const progress = useMemo(() => mockExamRunner.getExamProgress(session), [session]);
  const currentTask = useMemo(() => mockExamRunner.getCurrentTask(session), [session]);

  function persistFinalSession(finalSession, phase = "done", err = "") {
    const payload = buildPersistPayload(finalSession, { phase, error: err });
    saveMockExamSession(payload.sessionSnapshot);
    upsertMockSess(payload.historyPayload, payload.mockSessionId);
  }

  function startExam() {
    const blueprint = getDefaultMockExamBlueprint(mode);
    const next = mockExamRunner.startNewExam(blueprint);
    setSession({ ...next, mode });
    setSectionTimer(null);
    setScoringPhase("idle");
    setScoringError("");
  }

  function submitTaskResult(payload) {
    if (!session) return;
    const next = mockExamRunner.submitAndAdvance(session, payload);
    setSession(next);
  }

  function abortExam() {
    if (!session) return;
    const next = mockExamRunner.abort(session);
    setSession(next);
    persistFinalSession(next, "aborted", "");
  }

  useEffect(() => {
    async function finalizeDeferredScoring() {
      if (!session || session.status !== MOCK_EXAM_STATUS.COMPLETED) return;
      if (scoringPhase !== "idle") return;
      if (finalizedSessionIdsRef.current.has(session.id)) return;
      const hasDeferred = [TASK_IDS.EMAIL_WRITING, TASK_IDS.ACADEMIC_WRITING].some((taskId) => {
        const a = session.attempts?.[taskId];
        return a && a.score == null && a.meta?.deferredPayload;
      });
      if (!hasDeferred) {
        persistFinalSession(session, "done", "");
        finalizedSessionIdsRef.current.add(session.id);
        return;
      }

      setScoringPhase("pending");
      setScoringError("");

      try {
        const result = await finalizeDeferredScoringSession(session, {
          evaluateResponse: evaluateWritingResponse,
          updateTaskScore: mockExamRunner.updateTaskScore,
          recomputeAggregate: mockExamRunner.recomputeAggregate,
        });

        setSession(result.session);
        setScoringError(result.error || "");
        persistFinalSession(result.session, result.phase, result.error || "");
        setScoringPhase(result.phase);
        finalizedSessionIdsRef.current.add(result.session.id);
      } catch (e) {
        const msg = e?.message || "AI scoring failed";
        setScoringError(msg);
        setSession(session);
        persistFinalSession(session, "error", msg);
        finalizedSessionIdsRef.current.add(session.id);
        setScoringPhase("error");
      }
    }

    finalizeDeferredScoring();
  }, [session, scoringPhase]);

  const examResultRows = useMemo(() => {
    if (!session) return [];
    return session.blueprint.map((task) => {
      const a = session.attempts[task.taskId];
      const scoreText = Number.isFinite(a?.score) ? `${a.score}/${a.maxScore}` : "pending";
      return {
        id: task.taskId,
        title: task.title,
        scoreText,
        meta: a?.meta || null,
      };
    });
  }, [session]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={mode === PRACTICE_MODE.CHALLENGE ? "Full Mock Exam (Challenge)" : "Full Mock Exam"} section="Writing | Mock Mode" onExit={onExit} />
      <div style={{ maxWidth: 1200, margin: "24px auto", padding: "0 20px" }}>
        {!session && (
          <MockExamStartCard
            savedCount={(hist.sessions || []).length}
            onStart={startExam}
            mode={mode}
            totalTimeLabel={formatMinutesLabel(getDefaultMockExamBlueprint(mode).reduce((sum, t) => sum + (t.seconds || 0), 0))}
          />
        )}

        {!!session && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
            <MockExamMainPanel
              session={session}
              currentTask={currentTask}
              scoringPhase={scoringPhase}
              scoringError={scoringError}
              examResultRows={examResultRows}
              onTimerChange={({ timeLeft }) => setSectionTimer(timeLeft)}
              onSubmitTaskResult={submitTaskResult}
              onAbort={abortExam}
              onStartNew={startExam}
              onExit={onExit}
              mode={mode}
            />
            <SectionTimerPanel
              currentTask={currentTask}
              progress={progress}
              sectionTimer={sectionTimer}
              status={session.status}
              scoringPhase={scoringPhase}
              aggregate={session.aggregate}
              isAborted={session.status === MOCK_EXAM_STATUS.ABORTED}
            />
          </div>
        )}
      </div>
    </div>
  );
}
