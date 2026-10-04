"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, TopBar } from "../shared/ui";
import { fmt } from "../../lib/utils";
import { mockExamRunner } from "../../lib/mockExam/runner";
import { MOCK_EXAM_STATUS, TASK_IDS } from "../../lib/mockExam/contracts";
import { loadMockExamHistory, saveMockExamSession, saveMockCheckpoint, loadMockCheckpoint, clearMockCheckpoint, clearMockDrafts } from "../../lib/mockExam/storage";
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
import { prepareRealMockExam, markRealMockSeen, finishRealMockExamReliably } from "../../lib/realMockExam/client";
import { getRealMockConfig, REAL_MOCK_TEMPLATE_VERSION } from "../../lib/realMockExam/config";
import { buildRealWritingHistory, finalizeRealWriting, shouldKeepRealWritingCheckpoint } from "../../lib/realMockExam/linearWritingService";
import { describeRealMockError, RELEASE_ACTIVE_ATTEMPT_CONFIRM } from "../../lib/realMockExam/messages";

const MOCK_EXAM_COST = 3;
const REAL_ABORT_CONFIRM = "中止后本卷作废：已经展示过的题仍计为已做，不会给出成绩。确定中止吗？";

/** Checkpoint to resume on mount, or null. Real mode only resumes this account's unfinished writing paper. */
function loadResumableCheckpoint(realMock, scope) {
  const cp = loadMockCheckpoint(scope);
  const saved = cp?.session;
  if (!saved) return null;
  if (!realMock) return cp;
  return saved.realMockPaper?.section === "writing" && saved.realMockPaper.userCode === getSavedCode()
    && saved.realMockPaper.templateVersion === REAL_MOCK_TEMPLATE_VERSION
    && shouldKeepRealWritingCheckpoint(saved, cp.scoringPhase) ? cp : null;
}

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
        WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center",
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

export function MockExamShell({ onExit, mode = PRACTICE_MODE.STANDARD, reportLanguage, realMock = false }) {
  const uiReportLanguage = normalizeReportLanguage(reportLanguage || readReportLanguage());
  const checkpointScope = realMock ? { source: "real-bank", section: "writing", userCode: getSavedCode(), templateVersion: REAL_MOCK_TEMPLATE_VERSION } : null;
  const [session, setSession] = useState(() => loadResumableCheckpoint(realMock, checkpointScope)?.session || null);
  const [hist] = useState(() => loadMockExamHistory());
  const [sectionTimer, setSectionTimer] = useState(null);
  const currentTaskIdRef = useRef("");
  const lastSavedTimerRef = useRef(new Map());
  const [scoringPhase, setScoringPhase] = useState(() => {
    const cp = loadResumableCheckpoint(realMock, checkpointScope);
    // A persisted "pending" means scoring was interrupted (reload / crash / lost
    // connection mid-scoring). Restore as "idle" so the idempotent finalize effect
    // re-fires and re-scores the unscored tasks, instead of stranding a completed
    // exam on "AI 正在评分…请稍候" forever.
    const phase = cp?.scoringPhase || "idle";
    return phase === "pending" ? "idle" : phase;
  });
  const [scoringError, setScoringError] = useState("");
  const finalizedSessionIdsRef = useRef(new Set());
  // Async scoring may resolve after this exam left the page (「开始新模考」 or unmount).
  // These refs tell the result handlers which exam is on screen right now.
  const sessionIdRef = useRef(null);
  sessionIdRef.current = session?.id || null;
  const mountedRef = useRef(false);
  const [showCostModal, setShowCostModal] = useState(false);
  const [usageRemaining, setUsageRemaining] = useState(null);
  const [prepareError, setPrepareError] = useState("");
  const [blockedAttemptId, setBlockedAttemptId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [taskGate, setTaskGate] = useState({ id: "", state: "pending", error: "" });
  const [gateRetryTick, setGateRetryTick] = useState(0);
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const markedTaskIdsRef = useRef(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auto-checkpoint session to localStorage on every state change. Real mode does
  // not keep a finished (scored) or aborted paper — it would reopen for 2 hours.
  useEffect(() => {
    if (!session) return;
    if (realMock && !shouldKeepRealWritingCheckpoint(session, scoringPhase)) return;
    saveMockCheckpoint(session, scoringPhase, checkpointScope);
  }, [session, scoringPhase]);

  const userCode = getSavedCode();
  const tier = getSavedTier();
  const isFreeUser = tier !== "pro" && tier !== "legacy";

  const progress = useMemo(() => mockExamRunner.getExamProgress(session), [session]);
  const currentTask = useMemo(() => mockExamRunner.getCurrentTask(session), [session]);
  currentTaskIdRef.current = currentTask?.taskId || "";
  const paper = realMock ? session?.realMockPaper : null;
  const onTaskTimerChange = useCallback(({ timeLeft, isRunning, phase }) => {
    setSectionTimer(timeLeft);
    if (!realMock || !isRunning || phase === "transition" || !Number.isFinite(timeLeft)) return;
    const taskId = currentTaskIdRef.current;
    if (!taskId) return;
    const last = lastSavedTimerRef.current.get(taskId);
    if (last != null && Math.abs(last - timeLeft) < 5 && timeLeft !== 0) return;
    lastSavedTimerRef.current.set(taskId, timeLeft);
    setSession((previous) => previous ? { ...previous,
      realMockTaskDeadlines: { ...(previous.realMockTaskDeadlines || {}), [taskId]: Date.now() + timeLeft * 1000 },
    } : previous);
  }, [realMock]);
  const onRealMockBsProgress = useCallback((results) => {
    setSession((previous) => previous ? { ...previous, realMockBsProgress: results } : previous);
  }, []);
  const onRealMockSeen = useCallback((id) => {
    setSession((previous) => previous ? { ...previous, realMockSeenItemIds: [...new Set([...(previous.realMockSeenItemIds || []), id])] } : previous);
  }, []);

  useEffect(() => {
    if (!realMock || !paper || session?.status !== MOCK_EXAM_STATUS.RUNNING || !currentTask?.taskId) return;
    const taskId = currentTask.taskId;
    if (taskId === TASK_IDS.BUILD_SENTENCE || markedTaskIdsRef.current.has(taskId)) return;
    const item = taskId === TASK_IDS.EMAIL_WRITING ? paper.emailPrompt : paper.discussionPrompt;
    if (!item) return;
    let cancelled = false;
    setTaskGate({ id: taskId, state: "pending", error: "" });
    markRealMockSeen(paper, [item]).then(() => {
      markedTaskIdsRef.current.add(taskId);
      onRealMockSeen(item.id);
      if (!cancelled) setTaskGate({ id: taskId, state: "ready", error: "" });
    }).catch((error) => {
      if (!cancelled) setTaskGate({ id: taskId, state: "error", error: error?.message || "记录已见状态失败" });
    });
    return () => { cancelled = true; };
  }, [realMock, paper, session?.status, currentTask?.taskId, onRealMockSeen, gateRetryTick]);

  // Record part: this exam's own history row + local mock history (a real paper is
  // also finished, releasing its never-shown items). Safe for an exam no longer on screen.
  function persistFinalRecord(finalSession, phase = "done", err = "") {
    if (realMock) {
      saveMockExamSession(finalSession);
      upsertMockSess(buildRealWritingHistory(finalSession, phase, err), finalSession.id);
      clearMockDrafts(finalSession.id);
      if (finalSession.status === MOCK_EXAM_STATUS.COMPLETED || finalSession.status === MOCK_EXAM_STATUS.ABORTED) {
        finishRealMockExamReliably(finalSession.realMockPaper);
      }
      return;
    }
    const payload = buildPersistPayload(finalSession, { phase, error: err });
    saveMockExamSession(payload.sessionSnapshot);
    upsertMockSess(payload.historyPayload, payload.mockSessionId);
  }

  // Checkpoint part. The checkpoint key is shared by every exam of this scope.
  function syncFinalCheckpoint(finalSession, phase) {
    if (!realMock) {
      clearMockCheckpoint(); // session persisted, checkpoint no longer needed
      return;
    }
    if (shouldKeepRealWritingCheckpoint(finalSession, phase)) saveMockCheckpoint(finalSession, phase, checkpointScope);
    else clearMockCheckpoint(checkpointScope);
  }

  function persistFinalSession(finalSession, phase = "done", err = "") {
    persistFinalRecord(finalSession, phase, err);
    syncFinalCheckpoint(finalSession, phase);
  }

  /**
   * Apply a scoring result that resolved asynchronously. If that exam is no longer on
   * screen (a new exam started, or the page unmounted), only its own record is saved:
   * page state stays with the new exam, and the shared checkpoint is touched only
   * while it still holds this very exam.
   */
  function applyScoringResult(finalSession, phase, err) {
    finalizedSessionIdsRef.current.add(finalSession.id);
    if (!mountedRef.current || sessionIdRef.current !== finalSession.id) {
      persistFinalRecord(finalSession, phase, err);
      if (loadMockCheckpoint(checkpointScope)?.session?.id === finalSession.id) syncFinalCheckpoint(finalSession, phase);
      return;
    }
    setSession(finalSession);
    setScoringPhase(phase);
    setScoringError(err);
    persistFinalSession(finalSession, phase, err);
  }

  async function doStartExam(restartAttemptId = "") {
    if (preparingRef.current) return; // a second click while a paper is being prepared is ignored
    preparingRef.current = true;
    setPreparing(true);
    setPrepareError("");
    try {
      let selectedPaper = null;
      if (realMock) {
        try {
          // Restarting from a result / aborted page hands the old paper to the server,
          // which finishes it (if still active) before planning the new one.
          const oldAttemptId = restartAttemptId || session?.realMockPaper?.attemptId || "";
          selectedPaper = await prepareRealMockExam("writing", oldAttemptId ? { restartAttemptId: oldAttemptId } : {});
        } catch (error) {
          const info = describeRealMockError(error, "真题组卷失败，请稍后重试。");
          setBlockedAttemptId(info.kind === "active-attempt" ? info.activeAttemptId || "" : "");
          setPrepareError(info.message);
          return;
        }
      }
      clearMockCheckpoint(checkpointScope); // clear any stale checkpoint before starting fresh
      setBlockedAttemptId("");
      const blueprint = getDefaultMockExamBlueprint(realMock ? PRACTICE_MODE.STANDARD : mode).map((task) => realMock ? {
        ...task, seconds: task.taskId === TASK_IDS.BUILD_SENTENCE ? selectedPaper.timing.taskSeconds.bs
          : task.taskId === TASK_IDS.EMAIL_WRITING ? selectedPaper.timing.taskSeconds.email
          : selectedPaper.timing.taskSeconds.discussion,
      } : task);
      const next = { ...mockExamRunner.startNewExam(blueprint), mode: realMock ? PRACTICE_MODE.STANDARD : mode, ...(selectedPaper ? { realMockPaper: selectedPaper, realMockSeenItemIds: [], source: "real-bank", userCode: selectedPaper.userCode, templateVersion: selectedPaper.templateVersion } : {}) };
      sessionIdRef.current = next.id; // before the re-render: a result resolving in between is already stale
      setSession(next);
      setSectionTimer(null);
      setScoringPhase("idle");
      setScoringError("");
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  function releaseBlockedAttempt() {
    if (preparingRef.current || !blockedAttemptId) return;
    if (!window.confirm(RELEASE_ACTIVE_ATTEMPT_CONFIRM)) return;
    doStartExam(blockedAttemptId);
  }

  async function startExam() {
    if (realMock) { await doStartExam(); return; }
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

  async function submitTaskResult(payload) {
    if (!session) return;
    if (realMock) {
      const taskId = currentTask?.taskId;
      const items = taskId === TASK_IDS.BUILD_SENTENCE
        ? paper.bsQuestions.filter((item) => payload.meta?.seenItemIds?.includes(item.id))
        : [taskId === TASK_IDS.EMAIL_WRITING ? paper.emailPrompt : paper.discussionPrompt];
      try { if (items.length) await markRealMockSeen(paper, items, { answered: true }); }
      catch (error) {
        setPendingSubmission(payload);
        setTaskGate({ id: taskId, state: "error", error: error?.message || "提交状态同步失败，请重试" });
        return;
      }
      setPendingSubmission(null);
    }
    const next = mockExamRunner.submitAndAdvance(session, payload);
    setSession(next);
  }

  function abortExam() {
    if (!session) return;
    if (realMock) {
      if (session.status !== MOCK_EXAM_STATUS.RUNNING) return;
      if (!window.confirm(REAL_ABORT_CONFIRM)) return;
    }
    const next = mockExamRunner.abort(session);
    setSession(next);
    // Real: an aborted record (no score) + finish, so the never-shown items go back to the pool.
    persistFinalSession(next, "aborted", "");
  }

  useEffect(() => {
    async function finalizeDeferredScoring() {
      if (!session || session.status !== MOCK_EXAM_STATUS.COMPLETED) return;
      if (scoringPhase !== "idle") return;
      if (finalizedSessionIdsRef.current.has(session.id)) return;
      const hasDeferred = [TASK_IDS.EMAIL_WRITING, TASK_IDS.ACADEMIC_WRITING].some((taskId) => {
        const a = session.attempts?.[taskId];
        // finalizeRealWriting also re-scores a failed task's retryPayload (reload mid-retry).
        return a && a.score == null && (a.meta?.deferredPayload || (realMock && a.meta?.retryPayload));
      });
      if (!hasDeferred) {
        if (realMock) {
          const result = await finalizeRealWriting(session, evaluateWritingResponse, mockExamRunner.updateTaskScore);
          applyScoringResult(result.session, result.phase, result.error);
          return;
        }
        persistFinalSession(session, "done", "");
        finalizedSessionIdsRef.current.add(session.id);
        return;
      }

      setScoringPhase("pending");
      setScoringError("");

      try {
        if (realMock) {
          const result = await finalizeRealWriting(session, evaluateWritingResponse, mockExamRunner.updateTaskScore);
          applyScoringResult(result.session, result.phase, result.error);
          return;
        }
        const result = await finalizeDeferredScoringSession(session, {
          evaluateResponse: evaluateWritingResponse,
          updateTaskScore: mockExamRunner.updateTaskScore,
          recomputeAggregate: mockExamRunner.recomputeAggregate,
        });
        applyScoringResult(result.session, result.phase, result.error || "");
      } catch (e) {
        applyScoringResult(session, "error", e?.message || "AI scoring failed");
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
      if (realMock) {
        const result = await finalizeRealWriting(session, evaluateWritingResponse, mockExamRunner.updateTaskScore);
        applyScoringResult(result.session, result.phase, result.error);
        return;
      }
      const result = await retryTimeoutScoringSession(session, {
        evaluateResponse: evaluateWritingResponse,
        updateTaskScore: mockExamRunner.updateTaskScore,
        recomputeAggregate: mockExamRunner.recomputeAggregate,
      });
      applyScoringResult(result.session, result.phase, result.error || "");
    } catch (e) {
      applyScoringResult(session, "error", e?.message || "Retry scoring failed");
    }
  }

  const realTaskSeconds = realMock ? getRealMockConfig("writing")?.taskSeconds || null : null;
  const prepareStatus = (
    <>
      {preparing && <p style={{ color: C.t2 }}>正在检查完整真题题量与未做记录…</p>}
      {prepareError && <div role="alert" style={{ color: C.red, marginTop: 12, lineHeight: 1.6 }}>{prepareError}</div>}
      {blockedAttemptId && <button onClick={releaseBlockedAttempt} disabled={preparing} style={{ marginTop: 10, padding: "9px 14px", border: `1px solid ${C.bdr}`, background: "#fff", borderRadius: 8, cursor: preparing ? "not-allowed" : "pointer" }}>释放上次未完成试卷，重新组卷</button>}
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <TopBar title={realMock ? "写作真题模考" : mode === PRACTICE_MODE.CHALLENGE ? "整套模考（挑战模式）" : "整套模考"} section={realMock ? "真题专区｜写作模考" : "写作练习｜模考模式"} onExit={onExit} />
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
          <>
          <MockExamStartCard
            savedCount={(hist.sessions || []).length}
            onStart={startExam}
            mode={mode}
            realMock={realMock}
            taskSeconds={realTaskSeconds}
            totalTimeLabel={formatMinutesLabel(realTaskSeconds
              ? realTaskSeconds.bs + realTaskSeconds.email + realTaskSeconds.discussion
              : getDefaultMockExamBlueprint(mode).reduce((sum, t) => sum + (t.seconds || 0), 0))}
          />
          {prepareStatus}
          </>
        )}

        {!!session && (
          <>
            {/* 结果页 / 中止页上点「开始新模考」也会组卷失败（题量不足、另一份卷未完成），
                提示必须在这里也看得到，不能只挂在开始卡下面。 */}
            {(preparing || prepareError || blockedAttemptId) && <div style={{ marginBottom: 16 }}>{prepareStatus}</div>}
            {/* Mobile-only sticky countdown: the desktop SectionTimerPanel gets pushed
                far below the answer area on phones, so reuse the already-lifted
                sectionTimer as a fixed top bar. Hidden on desktop (display:none →
                flipped to flex by app/mobile.css). */}
            {session.status === MOCK_EXAM_STATUS.RUNNING && sectionTimer != null && (
              <div
                className="tp-mobile-timer"
                style={{
                  display: "none",
                  position: "fixed", top: 0, left: 0, right: 0, zIndex: 60,
                  alignItems: "center", justifyContent: "space-between",
                  background: "#fff", borderBottom: "1px solid " + C.bdr,
                  padding: "8px 14px", fontFamily: FONT,
                }}
              >
                <span style={{ fontSize: 12, color: C.t2, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>
                  {currentTask ? currentTask.title : ""}
                </span>
                <span style={{
                  fontSize: 20, fontWeight: 800,
                  fontFamily: "Consolas, Menlo, 'Courier New', monospace",
                  color: sectionTimer <= 60 ? C.red : C.nav,
                }}>
                  {fmt(sectionTimer)}
                </span>
              </div>
            )}
            {/* 主栏写 minmax(0, 1fr)：裸 1fr = minmax(auto, 1fr)，主栏里的任务内容一旦有
                不可断行的长串就会把整个 grid 顶宽，连带 280px 侧栏被推出可视区。 */}
            <div className={"tp-exam-grid" + (session.status === MOCK_EXAM_STATUS.RUNNING && sectionTimer != null ? " tp-exam-grid--timer" : "")} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 16, alignItems: "start" }}>
            {realMock && pendingSubmission ? <div style={{ background: "#fff", padding: 24, color: C.red }} role="alert">{taskGate.error}<button onClick={() => submitTaskResult(pendingSubmission)}>重试提交</button></div>
              : realMock && currentTask?.taskId !== TASK_IDS.BUILD_SENTENCE && session.status === MOCK_EXAM_STATUS.RUNNING && (taskGate.id !== currentTask?.taskId || taskGate.state !== "ready") ? <div role={taskGate.state === "error" ? "alert" : undefined} style={{ background: "#fff", padding: 24, color: taskGate.state === "error" ? C.red : C.t2 }}>{taskGate.state === "error" ? <>{taskGate.error}<button onClick={() => setGateRetryTick((tick) => tick + 1)} style={{ marginLeft: 12 }}>重试确认</button></> : "正在确认题目状态…"}</div>
              : <MockExamMainPanel
              session={session}
              currentTask={currentTask}
              scoringPhase={scoringPhase}
              scoringError={scoringError}
              examResultRows={examResultRows}
              onTimerChange={onTaskTimerChange}
              onSubmitTaskResult={submitTaskResult}
              onAbort={abortExam}
              onStartNew={startExam}
              onExit={onExit}
              mode={mode}
              canRetryScoring={canRetryScoring}
              onRetryScoring={retryFailedScoring}
              reportLanguage={uiReportLanguage}
              realMockPaper={paper}
              realMockBsProgress={session.realMockBsProgress || null}
              onRealMockBsProgress={onRealMockBsProgress}
              realMockSeenItemIds={session.realMockSeenItemIds || []}
              onRealMockSeen={onRealMockSeen}
              realMockTaskDeadline={session.realMockTaskDeadlines?.[currentTask?.taskId] || null}
            />}
            <SectionTimerPanel
              currentTask={currentTask}
              progress={progress}
              sectionTimer={sectionTimer}
              status={session.status}
              scoringPhase={scoringPhase}
              aggregate={session.aggregate}
              isAborted={session.status === MOCK_EXAM_STATUS.ABORTED}
              realMock={realMock}
            />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
