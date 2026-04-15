"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, TopBar } from "../shared/ui";
import { mockExamRunner } from "../../lib/mockExam/runner";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { loadMockExamHistory, saveMockExamSession, saveMockCheckpoint, loadMockCheckpoint, clearMockCheckpoint } from "../../lib/mockExam/storage";
import { upsertMockSess } from "../../lib/sessionStore";
import { buildPersistPayload, finalizeDeferredScoringSession, isTimeoutError, retryTimeoutScoringSession } from "../../lib/mockExam/service";
import { evaluateWritingResponse } from "../../lib/ai/writingEval";
import { SectionTimerPanel } from "./SectionTimerPanel";
import { MockExamStartCard } from "./MockExamStartCard";
import { MockExamMainPanel } from "./MockExamMainPanel";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";
import { getDefaultMockExamBlueprint } from "../../lib/mockExam/planner";
import { normalizeReportLanguage, readReportLanguage } from "../../lib/reportLanguage";
import { getSavedCode, getSavedTier } from "../../lib/AuthContext";
import { checkCanPractice } from "../../lib/dailyUsage";
import UpgradeModal from "../shared/UpgradeModal";

const MOCK_EXAM_COST = 3;

/**
 * Modal confirming mock exam will consume 3 free credits.
 */
function MockExamCostConfirmModal({ remaining, onConfirm, onCancel, userCode }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const insufficient = remaining < MOCK_EXAM_COST;

  if (showUpgrade) {
    return (
      <UpgradeModal
        userCode={userCode}
        onClose={onCancel}
        onUpgraded={() => window.location.reload()}
      />
    );
  }

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)", display: "flex", justifyContent: "center",
        alignItems: "center", zIndex: 9999, fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "32px 28px",
          maxWidth: 380, width: "90%", textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {insufficient ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9888;&#65039;</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
              免费次数不足
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
              模考需要消耗 <strong>{MOCK_EXAM_COST} 次</strong>免费练习次数，
              你今日仅剩 <strong>{remaining} 次</strong>。
              升级 Pro 版可无限模考。
            </p>
            <button
              onClick={() => setShowUpgrade(true)}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                marginBottom: 10, fontFamily: FONT,
              }}
            >
              升级 Pro
            </button>
            <button
              onClick={onCancel}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10,
                border: "1px solid " + C.bdr, background: "#fff",
                color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
              }}
            >
              返回
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#128221;</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: C.t1 }}>
              模考将消耗免费次数
            </h3>
            <p style={{ fontSize: 14, color: C.t2, marginBottom: 20, lineHeight: 1.6 }}>
              一次模考将消耗 <strong>{MOCK_EXAM_COST} 次</strong>免费练习次数，
              你今日还剩 <strong>{remaining} 次</strong>。确定开始吗？
            </p>
            <button
              onClick={onConfirm}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10,
                border: "none", background: C.blue, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                marginBottom: 10, fontFamily: FONT,
              }}
            >
              确定开始
            </button>
            <button
              onClick={onCancel}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 10,
                border: "1px solid " + C.bdr, background: "#fff",
                color: C.t2, fontSize: 14, cursor: "pointer", fontFamily: FONT,
              }}
            >
              取消
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export function MockExamShell({ onExit, mode = PRACTICE_MODE.STANDARD, reportLanguage }) {
  const uiReportLanguage = normalizeReportLanguage(reportLanguage || readReportLanguage());
  const [session, setSession] = useState(() => {
    const cp = loadMockCheckpoint();
    return cp?.session || null;
  });
  const [hist] = useState(() => loadMockExamHistory());
  const [sectionTimer, setSectionTimer] = useState(null);
  const [scoringPhase, setScoringPhase] = useState(() => {
    const cp = loadMockCheckpoint();
    return cp?.scoringPhase || "idle";
  });
  const [scoringError, setScoringError] = useState("");
  const finalizedSessionIdsRef = useRef(new Set());
  const [showCostModal, setShowCostModal] = useState(false);
  const [usageRemaining, setUsageRemaining] = useState(null);

  // Auto-checkpoint session to localStorage on every state change
  useEffect(() => {
    if (session) {
      saveMockCheckpoint(session, scoringPhase);
    }
  }, [session, scoringPhase]);

  const userCode = getSavedCode();
  const tier = getSavedTier();
  const isFreeUser = tier !== "pro" && tier !== "legacy";

  const progress = useMemo(() => mockExamRunner.getExamProgress(session), [session]);
  const currentTask = useMemo(() => mockExamRunner.getCurrentTask(session), [session]);

  function persistFinalSession(finalSession, phase = "done", err = "") {
    const payload = buildPersistPayload(finalSession, { phase, error: err });
    saveMockExamSession(payload.sessionSnapshot);
    upsertMockSess(payload.historyPayload, payload.mockSessionId);
    clearMockCheckpoint(); // session persisted, checkpoint no longer needed
  }

  function doStartExam() {
    clearMockCheckpoint(); // clear any stale checkpoint before starting fresh
    const blueprint = getDefaultMockExamBlueprint(mode);
    const next = mockExamRunner.startNewExam(blueprint);
    setSession({ ...next, mode });
    setSectionTimer(null);
    setScoringPhase("idle");
    setScoringError("");
  }

  async function startExam() {
    if (!isFreeUser) {
      doStartExam();
      return;
    }
    // Free user — check remaining credits
    try {
      const result = await checkCanPractice(userCode, tier);
      setUsageRemaining(result.remaining);
      setShowCostModal(true);
    } catch {
      // Fail-open
      doStartExam();
    }
  }

  function handleCostConfirm() {
    setShowCostModal(false);
    doStartExam();
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

  const canRetryScoring = useMemo(() => {
    if (!session || session.status !== MOCK_EXAM_STATUS.COMPLETED) return false;
    return [TASK_IDS.EMAIL_WRITING, TASK_IDS.ACADEMIC_WRITING].some((taskId) => {
      const a = session?.attempts?.[taskId];
      return a?.meta?.error && a?.meta?.retryPayload;
    });
  }, [session]);

  async function retryFailedScoring() {
    if (!session || !canRetryScoring) return;
    setScoringPhase("pending");
    setScoringError("");
    try {
      const result = await retryTimeoutScoringSession(session, {
        evaluateResponse: evaluateWritingResponse,
        updateTaskScore: mockExamRunner.updateTaskScore,
        recomputeAggregate: mockExamRunner.recomputeAggregate,
      });
      setSession(result.session);
      setScoringError(result.error || "");
      persistFinalSession(result.session, result.phase, result.error || "");
      setScoringPhase(result.phase);
    } catch (e) {
      const msg = e?.message || "Retry scoring failed";
      setScoringError(msg);
      persistFinalSession(session, "error", msg);
      setScoringPhase("error");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={mode === PRACTICE_MODE.CHALLENGE ? "整套模考（挑战模式）" : "整套模考"} section="写作练习｜模考模式" onExit={onExit} />
      <div style={{ maxWidth: 1200, margin: "24px auto", padding: "0 20px" }}>
        {showCostModal && (
          <MockExamCostConfirmModal
            remaining={usageRemaining}
            onConfirm={handleCostConfirm}
            onCancel={() => setShowCostModal(false)}
            userCode={userCode}
          />
        )}

        {!session && (
          <MockExamStartCard
            savedCount={(hist.sessions || []).length}
            onStart={startExam}
            mode={mode}
            totalTimeLabel={formatMinutesLabel(getDefaultMockExamBlueprint(mode).reduce((sum, t) => sum + (t.seconds || 0), 0))}
          />
        )}

        {!!session && (
          <div className="tp-exam-grid" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>
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
              canRetryScoring={canRetryScoring}
              onRetryScoring={retryFailedScoring}
              reportLanguage={uiReportLanguage}
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
