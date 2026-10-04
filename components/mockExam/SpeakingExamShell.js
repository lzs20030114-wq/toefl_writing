"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { C, FONT, Btn, TopBar, SurfaceCard } from "../shared/ui";
import { RepeatTask } from "../speaking/RepeatTask";
import { InterviewTask } from "../speaking/InterviewTask";
import { buildSpeakingExam } from "../../lib/mockExam/speakingPlanner";
import { calculateSpeakingBand } from "../../lib/mockExam/speakingBand";
import { saveSess, loadDoneIds, addDoneIds } from "../../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../../lib/questionSelector";
import { ExamAudioProvider, useExamAudio } from "../shared/ExamAudioProvider";
import { useNarration } from "../speaking/SpeakingIntroScreen";
import { SPEAKING_SECTION_NARRATION, INTERVIEW_TASK_NARRATION } from "../../lib/speakingGen/introTemplates";
import { prepareRealMockExam, markRealMockSeen, finishRealMockExamReliably } from "../../lib/realMockExam/client";
import { describeRealMockError, RELEASE_ACTIVE_ATTEMPT_CONFIRM } from "../../lib/realMockExam/messages";
import { REAL_MOCK_TEMPLATE_VERSION } from "../../lib/realMockExam/config";
import { scoreRealSpeaking } from "../../lib/realMockExam/linearScore";
import { loadMockCheckpoint, saveMockCheckpoint, clearMockCheckpoint } from "../../lib/mockExam/storage";
import { getSavedCode } from "../../lib/AuthContext";

// ------ Constants ------

const ACCENT = "#F59E0B";
const ACCENT_SOFT = "#FFFBEB";

const BAND_COLORS = {
  green: { bg: "#dcfce7", border: "#22c55e", text: "#15803d", ring: "#22c55e" },
  blue: { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", ring: "#3b82f6" },
  yellow: { bg: "#fef9c3", border: "#eab308", text: "#a16207", ring: "#eab308" },
  orange: { bg: "#ffedd5", border: "#f97316", text: "#c2410c", ring: "#f97316" },
  red: { bg: "#fee2e2", border: "#ef4444", text: "#b91c1c", ring: "#ef4444" },
};

// 真题模考不出估分时的中性配色（不借用任何等级的颜色，免得暗示一个等级）。
const NO_BAND_COLORS = { bg: "#f1f5f9", border: "#cbd5e1", text: "#475569", ring: "#94a3b8" };

const LEVEL_LABELS = {
  green: "\u9AD8\u7EA7",
  blue: "\u4E2D\u9AD8\u7EA7",
  yellow: "\u4E2D\u7EA7",
  orange: "\u521D\u4E2D\u7EA7",
  red: "\u521D\u7EA7",
};

// ------ Scoring helpers ------
//
// Band is computed on the ETS raw-score structure (repeat 0-35 + interview 0-20 =
// 0-55 → 1-6), see lib/mockExam/speakingBand.js. The previous 40/60 weighted-average
// of two 0-5 means did not reflect the official raw structure and inverted the
// task weighting (repeat is 35/55 of the raw points, not 40%).

function bandToCEFR(band) {
  if (band >= 5.5) return "C1+";
  if (band >= 4.5) return "B2-C1";
  if (band >= 3.5) return "B1-B2";
  if (band >= 2.5) return "A2-B1";
  return "A1-A2";
}

function getScoreColor(band) {
  if (band >= 5.5) return "green";
  if (band >= 4.5) return "blue";
  if (band >= 3.5) return "yellow";
  if (band >= 2.5) return "orange";
  return "red";
}

// ------ Main Shell ------

/**
 * SpeakingExamShell — orchestrates a speaking mock exam.
 *
 * Phases: intro -> repeatNarration -> repeat -> interviewNarration -> interview
 *         -> results
 *
 * The two *Narration phases play the verbatim real-exam task-level narration
 * ("Speaking section…" before Task 1, "Take an interview…" before Task 2) —
 * separate from each task's own per-set setting intro (rendered inside
 * RepeatTask / InterviewTask). Neither narration phase runs the exam stopwatch.
 *
 * NOT adaptive — it is a straight-through 2-task exam.
 */
export function SpeakingExamShell(props) {
  // The Provider wraps the whole shell so the persistent exam audio element
  // (unlocked once in the start-exam click) survives intro→repeat→transition
  // →interview→results without ever unmounting.
  return (
    <ExamAudioProvider>
      <SpeakingExamShellInner {...props} />
    </ExamAudioProvider>
  );
}

function SpeakingExamShellInner({ onExit, realMock = false }) {
  const checkpointScope = realMock ? { source: "real-bank", section: "speaking", userCode: getSavedCode(), templateVersion: REAL_MOCK_TEMPLATE_VERSION } : null;
  const restored = useRef((() => {
    const saved = realMock ? loadMockCheckpoint(checkpointScope)?.session : null;
    return saved?.exam?.section === "speaking" && saved.exam.userCode === getSavedCode() && saved.exam.templateVersion === REAL_MOCK_TEMPLATE_VERSION ? saved : null;
  })());
  // Shared exam audio controller (null when the kill switch disables it).
  const examAudio = useExamAudio();
  const examController = examAudio ? examAudio.controller : null;
  const [phase, setPhase] = useState(["repeat", "interview"].includes(restored.current?.phase) ? "resumeBlocked" : restored.current?.phase || "intro");
  const [exam, setExam] = useState(restored.current?.exam || null);
  const [repeatResults, setRepeatResults] = useState(restored.current?.repeatResults || null);
  const [interviewResults, setInterviewResults] = useState(restored.current?.interviewResults || null);
  const [finalScore, setFinalScore] = useState(restored.current?.finalScore || null);
  const [error, setError] = useState(null);
  // 真题模式：describeRealMockError 的 kind，决定错误卡给哪些按钮（常规模考恒为 ""）。
  const [errorKind, setErrorKind] = useState("");
  // 错误卡「重试」要重放的那一步：{ kind: prepare | repeatNarration | repeat |
  // interviewNarration | interview, result?, restartAttemptId? }。只有 transient 错误才有。
  const [pendingTransition, setPendingTransition] = useState(null);
  const [preparing, setPreparing] = useState(false);
  // 重试进行中：错误卡留着、按钮禁用，成功后由那一步自己收起错误。
  const [syncing, setSyncing] = useState(false);
  const [blockedAttemptId, setBlockedAttemptId] = useState("");
  // 这次成绩存进历史时用的 date —— 结果页「查看本次记录」按它深链到真题练习记录里的这一条。
  const [recordDate, setRecordDate] = useState("");

  // Timer
  const [elapsed, setElapsed] = useState(restored.current?.elapsed || 0);
  const timerRef = useRef(null);

  // Elapsed timer (runs during repeat and interview phases)
  useEffect(() => {
    if (phase !== "repeat" && phase !== "interview") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  useEffect(() => {
    if (!realMock || !exam || phase === "results") return;
    saveMockCheckpoint({ phase, exam, repeatResults, interviewResults, finalScore, elapsed }, phase, checkpointScope);
  }, [realMock, phase, exam, repeatResults, interviewResults, finalScore, elapsed]);

  // ------ Phase transitions ------

  function clearError() {
    setError(null);
    setErrorKind("");
    setPendingTransition(null);
    setBlockedAttemptId("");
  }

  // 这份卷在服务端已经结束 / 过期 / 不存在：本卷不可能再续答。丢掉内存里的卷和本地存档
  // （留着只会让刷新后的人回到一份死卷），错误卡只给「重新组卷」和「返回真题专区」。
  function abandonDeadPaper() {
    clearMockCheckpoint(checkpointScope);
    setExam(null);
    setRepeatResults(null);
    setInterviewResults(null);
    setFinalScore(null);
    setElapsed(0);
    setPhase("intro");
  }

  // 真题模式的请求失败 → 错误卡。pending 是「重试」要重放的那一步，只有 transient 才给重试；
  // 考试中途的错误卡绝不给 handleRestart（那会把已经做完的部分整个丢掉）。
  function showRealMockError(e, fallback, pending) {
    const info = describeRealMockError(e, fallback);
    if (info.kind === "dead-attempt") abandonDeadPaper();
    setErrorKind(info.kind);
    setBlockedAttemptId(info.kind === "active-attempt" ? info.activeAttemptId || "" : "");
    setPendingTransition(info.canRetry ? pending : null);
    setError(info.message);
  }

  async function handleStartExam(restartAttemptId = "") {
    // Unlock the shared exam audio element synchronously inside this click —
    // the one real user gesture WebKit will honor for the whole exam.
    if (examController) examController.unlock();
    setPreparing(true);
    // 真题模式：显式给的旧卷（放弃另一份进行中的卷）优先，否则带上内存里这份卷 ——
    // 服务端若它仍是进行中的那份，会先结束它再组新卷（以前是客户端先 finish、失败就卡住开考）。
    const restartId = realMock ? restartAttemptId || exam?.attemptId || "" : "";
    try {
      // Prefer sets the user hasn't practised yet (shared done-set with practice
      // mode). repeat ids (rpt_*) and interview ids (intv_*) never collide, so a
      // single merged Set is safe; the planner's pickSet still falls back to the
      // full pool when everything's been seen (Interview has only ~11 sets).
      const doneIds = new Set([
        ...loadDoneIds(DONE_STORAGE_KEYS.SPEAKING_REPEAT),
        ...loadDoneIds(DONE_STORAGE_KEYS.SPEAKING_INTERVIEW),
      ]);
      const built = realMock ? await prepareRealMockExam("speaking", restartId ? { restartAttemptId: restartId } : {}) : buildSpeakingExam(doneIds);
      if (!built.repeatSet || !built.interviewSet) {
        setError("\u9898\u5E93\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u5F00\u59CB\u8003\u8BD5\u3002\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002");
        return;
      }
      setExam(built);
      setRepeatResults(null);
      setInterviewResults(null);
      setFinalScore(null);
      setElapsed(0);
      clearError();
      if (realMock) clearMockCheckpoint(checkpointScope);
      setPhase("repeatNarration");
    } catch (e) {
      if (realMock) {
        showRealMockError(e, "初始化考试失败", { kind: "prepare", restartAttemptId: restartId });
        return;
      }
      const gaps = (e?.deficits || []).filter((d) => d.gap > 0).map((d) => `${d.taskType} 需要 ${d.need}／可用 ${d.available}／缺 ${d.gap}`);
      setError([e?.message || "初始化考试失败", ...gaps].join("；"));
    } finally {
      setPreparing(false);
    }
  }

  async function handleRepeatComplete(result) {
    if (realMock) {
      try { await markRealMockSeen(exam, [exam.repeatSet], { answered: true }); }
      catch (e) { showRealMockError(e, "跟读提交同步失败", { kind: "repeat", result }); return; }
    }
    clearError();
    setRepeatResults(result);
    setPhase("interviewNarration");
  }

  // Task-level narration screens → the corresponding task. The exam audio is
  // already unlocked (start-exam click), and the narration itself is read via
  // the browser's Web Speech API, so no controller gesture is needed here.
  async function handleRepeatNarrationContinue() {
    if (realMock) {
      try { await markRealMockSeen(exam, [exam.repeatSet]); }
      catch (e) { showRealMockError(e, "记录跟读题已见失败", { kind: "repeatNarration" }); return; }
    }
    clearError();
    setPhase("repeat");
  }

  async function handleInterviewNarrationContinue() {
    if (realMock) {
      try { await markRealMockSeen(exam, [exam.interviewSet]); }
      catch (e) { showRealMockError(e, "记录访谈题已见失败", { kind: "interviewNarration" }); return; }
    }
    clearError();
    setPhase("interview");
  }

  async function handleInterviewComplete(result) {
    if (realMock) {
      try { await markRealMockSeen(exam, [exam.interviewSet], { answered: true }); }
      catch (e) { showRealMockError(e, "访谈提交同步失败", { kind: "interview", result }); return; }
    }
    clearError();
    setInterviewResults(result);
    computeScore(repeatResults, result);
    // 记录已存、结果页已出。finish 只是释放这份卷剩下的预留（2 小时租约本来也会放），
    // 所以不等它、它失败也不挡成绩 —— 没落地的会被记下，下次组卷前先补上。
    if (realMock) finishRealMockExamReliably(exam);
  }

  // 错误卡「重试」：重放失败的那一步。进行中错误卡保持显示（按钮禁用），成功由那一步自己收起。
  async function retryPendingTransition() {
    const pending = pendingTransition;
    if (!pending || syncing) return;
    setSyncing(true);
    try {
      if (pending.kind === "prepare") await handleStartExam(pending.restartAttemptId);
      else if (pending.kind === "repeatNarration") await handleRepeatNarrationContinue();
      else if (pending.kind === "repeat") await handleRepeatComplete(pending.result);
      else if (pending.kind === "interviewNarration") await handleInterviewNarrationContinue();
      else await handleInterviewComplete(pending.result);
    } finally {
      setSyncing(false);
    }
  }

  // 放弃另一份进行中的同科试卷：服务端结束它（已展示的题仍记为已做）再组新卷 —— 必须用户确认。
  function handleReleaseActiveAttempt() {
    if (!blockedAttemptId || !window.confirm(RELEASE_ACTIVE_ATTEMPT_CONFIRM)) return;
    handleStartExam(blockedAttemptId);
  }

  function computeScore(rptResults, intvResults) {
    // Repeat: use the per-sentence official 0-5 level (repeatScorer.officialLevel),
    // falling back to `score` for older result shapes.
    const rptItems = rptResults?.items || [];
    const scoredRpt = rptItems.filter((s) => s.score);
    const repeatLevels = scoredRpt
      .map((s) => (Number.isFinite(s.score.officialLevel) ? s.score.officialLevel : s.score.score))
      .filter((v) => Number.isFinite(v));
    const avgRepeatLevel = repeatLevels.length
      ? repeatLevels.reduce((a, b) => a + b, 0) / repeatLevels.length
      : 0;
    const repeatScore = Math.round(avgRepeatLevel * 2) / 2;
    const avgRepeatAccuracy = scoredRpt.length
      ? scoredRpt.reduce((sum, s) => sum + (s.score.accuracy || 0), 0) / scoredRpt.length
      : 0;

    // Interview: AI 0-5 per answered question.
    const intvItems = intvResults?.items || [];
    const validIntvScores = intvItems.filter((s) => s.aiScore && !s.aiScore.error);
    const interviewScores = validIntvScores
      .map((s) => s.aiScore.score)
      .filter((v) => Number.isFinite(v));
    const interviewScore = interviewScores.length
      ? Math.round((interviewScores.reduce((a, b) => a + b, 0) / interviewScores.length) * 2) / 2
      : 0;

    // Band on the ETS raw structure (repeat 0-35 + interview 0-20 = 0-55 → 1-6).
    const normalScore = calculateSpeakingBand(
      repeatLevels,
      interviewScores,
    );
    const realScore = realMock ? scoreRealSpeaking(rptItems, intvItems) : null;
    const { band, rawTotal, repeatRaw, interviewRaw } = realMock
      ? { band: realScore.band, rawTotal: realScore.raw, repeatRaw: realScore.repeatRaw, interviewRaw: realScore.interviewRaw }
      : normalScore;
    const cefr = Number.isFinite(band) ? bandToCEFR(band) : "";
    // 真题模式不出估分时不给等级（以前回退成 "yellow"，结果页挂着「中级」）；常规模考照旧。
    const color = Number.isFinite(band) ? getScoreColor(band) : realMock ? null : "yellow";
    // 真题模式：未作答按 0 分计入原始分，分项的 0-5 均分也走同一口径（原始分 ÷ 题数），
    // 否则「6 句跳过 + 1 句 5 分」会显示 5.0/5，旁边的原始分却只有 5/35。
    const repeatPartScore = realMock && Number.isFinite(repeatRaw) ? Math.round((repeatRaw / 7) * 2) / 2 : repeatScore;
    const interviewPartScore = realMock && Number.isFinite(interviewRaw) ? Math.round((interviewRaw / 4) * 2) / 2 : interviewScore;

    const score = {
      band,
      cefr,
      color,
      repeatScore: repeatPartScore,
      interviewScore: interviewPartScore,
      avgRepeatAccuracy: Math.round(avgRepeatAccuracy),
      rawTotal: Number.isFinite(rawTotal) ? Math.round(rawTotal * 10) / 10 : null,
      repeatRaw: Number.isFinite(repeatRaw) ? Math.round(repeatRaw * 10) / 10 : null,
      interviewRaw: Number.isFinite(interviewRaw) ? Math.round(interviewRaw * 10) / 10 : null,
      ...(realMock ? { unanswered: realScore.unanswered, unscored: realScore.unscored } : {}),
      repeatItems: rptItems,
      interviewItems: intvItems,
    };

    setFinalScore(score);

    // Save session under the unified "speaking" type so SpeakingProgressView
    // + the section-page link card surface it like a practice record. The
    // previous "speaking-exam" type was a write-only orphan (mirrors the
    // listening/reading adaptive bug fixed in f531a90).
    // (Real-bank mocks are the exception: SpeakingProgressView skips them —
    // they live in 真题练习记录, which the results page deep-links by this date.)
    const recordDate = new Date().toISOString();
    setRecordDate(recordDate);
    try {
      saveSess({
        type: "speaking",
        mode: "mock",
        date: recordDate,
        band,
        details: {
          subtype: "mock",
          ...(realMock ? { real: true, source: "real-bank", realMock: true, section: "speaking",
            attemptId: exam?.attemptId, templateVersion: exam?.templateVersion,
            itemIds: [exam?.repeatSet?.id, exam?.interviewSet?.id].filter(Boolean),
            seenItemIds: [exam?.repeatSet?.id, exam?.interviewSet?.id].filter(Boolean),
            items: [exam?.repeatSet, exam?.interviewSet].filter(Boolean),
            paperSnapshot: exam, tasks: [
              { taskType: "repeat", setId: exam?.repeatSet?.id, itemIds: [exam?.repeatSet?.id], items: rptItems, score: repeatRaw },
              { taskType: "interview", setId: exam?.interviewSet?.id, itemIds: [exam?.interviewSet?.id], items: intvItems, score: interviewRaw },
            ], repeatItems: rptItems, interviewItems: intvItems,
            unanswered: realScore.unanswered, unscored: realScore.unscored } : {}),
          band,
          cefr,
          repeatScore: repeatPartScore,
          interviewScore: interviewPartScore,
          avgRepeatAccuracy: Math.round(avgRepeatAccuracy),
          rawTotal: Number.isFinite(rawTotal) ? Math.round(rawTotal * 10) / 10 : null,
          repeatSetId: exam?.repeatSet?.id,
          interviewSetId: exam?.interviewSet?.id,
          elapsed,
        },
      });
    } catch {}
    if (realMock) clearMockCheckpoint(checkpointScope);

    // Mark this exam's sets done so future mocks (and practice) prefer unseen
    // ones. Speaking mock always runs straight through to here, so this is the
    // single completion point (no timeout/partial path like reading/listening).
    try {
      if (exam?.repeatSet?.id) addDoneIds(DONE_STORAGE_KEYS.SPEAKING_REPEAT, [exam.repeatSet.id]);
      if (exam?.interviewSet?.id) addDoneIds(DONE_STORAGE_KEYS.SPEAKING_INTERVIEW, [exam.interviewSet.id]);
    } catch {}

    setPhase("results");
  }

  function handleRestart() {
    if (realMock) clearMockCheckpoint(checkpointScope);
    setPhase("intro");
    setExam(null);
    setRepeatResults(null);
    setInterviewResults(null);
    setFinalScore(null);
    clearError();
    setElapsed(0);
  }

  // ------ Render ------

  const topBarTitle =
    phase === "repeat"
      ? "Task 1 \u00B7 Listen & Repeat"
      : phase === "interview"
        ? "Task 2 \u00B7 Take an Interview"
        : phase === "repeatNarration"
          ? "Speaking Section"
          : phase === "interviewNarration"
            ? "Task 2 \u00B7 Take an Interview"
            : phase === "results"
            ? "\u8003\u8BD5\u7ED3\u679C"
            : "\u53E3\u8BED\u6A21\u8003";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {/* Top bar — only show on intro, transition, and results */}
      {(phase === "intro" || phase === "resumeBlocked" || phase === "repeatNarration" || phase === "interviewNarration" || phase === "results") && (
        <TopBar
          title={realMock ? "口语真题模考" : topBarTitle}
          section={realMock ? "真题专区｜口语模考" : "Speaking | 模考模式"}
          elapsedTime={phase !== "intro" ? elapsed : undefined}
          onExit={onExit}
        />
      )}

      {/* Intro Phase */}
      {phase === "intro" && !error && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <IntroCard onStart={() => handleStartExam()} onExit={onExit} realMock={realMock} preparing={preparing} />
        </div>
      )}

      {phase === "resumeBlocked" && !error && <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}><SurfaceCard style={{ padding: 28, textAlign: "center" }}>
        <h2 style={{ color: C.t1, fontSize: 19 }}>这项口语任务无法从录音中途恢复</h2>
        <p style={{ color: C.t2, lineHeight: 1.6 }}>刷新前的录音和逐题评分没有完整保存。已经展示的整套真题仍记为已见；可释放本卷，重新抽取未见真题。</p>
        <Btn onClick={() => handleStartExam()} disabled={preparing}>{preparing ? "正在重新组卷…" : "重新组卷"}</Btn>
        <Btn onClick={onExit} variant="secondary">返回真题专区</Btn>
      </SurfaceCard></div>}

      {/* Error state */}
      {error && (
        <div data-testid="speaking-exam-error" style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <SurfaceCard style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9888;&#65039;</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 8 }}>{error}</div>
            {realMock ? (
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {errorKind === "active-attempt" && blockedAttemptId && (
                  <Btn onClick={handleReleaseActiveAttempt} disabled={preparing}>
                    {preparing ? "正在重新组卷…" : "放弃那份试卷并重新组卷"}
                  </Btn>
                )}
                {errorKind === "dead-attempt" && (
                  <Btn onClick={() => handleStartExam()} disabled={preparing}>
                    {preparing ? "正在重新组卷…" : "重新组卷"}
                  </Btn>
                )}
                {pendingTransition && (
                  <Btn onClick={retryPendingTransition} disabled={syncing || preparing}>
                    {syncing || preparing ? "正在重试…" : pendingTransition.kind === "prepare" ? "重试" : "重试同步"}
                  </Btn>
                )}
                {/* 考试中途只给重试：做完的部分只在这页内存里，重来或离开都会丢掉它。 */}
                {(!pendingTransition || pendingTransition.kind === "prepare") && (
                  <Btn onClick={onExit} variant="secondary">返回真题专区</Btn>
                )}
              </div>
            ) : (
              <Btn onClick={handleRestart} variant="secondary">返回</Btn>
            )}
          </SurfaceCard>
        </div>
      )}

      {/* Task-level narration before Task 1 (verbatim real-exam "Speaking section…").
          Hidden while an error is shown — retry goes through the error card. */}
      {phase === "repeatNarration" && !error && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <NarrationCard
            title="Speaking Section"
            body={SPEAKING_SECTION_NARRATION}
            onContinue={handleRepeatNarrationContinue}
          />
        </div>
      )}

      {/* Repeat Phase — embed RepeatTask full-screen */}
      {phase === "repeat" && exam?.repeatSet && (
        <RepeatTask
          items={exam.repeatSet.sentences || []}
          setInfo={exam.repeatSet}
          onComplete={handleRepeatComplete}
          onExit={onExit}
          isPractice={false}
          realMock={realMock}
        />
      )}

      {/* Task-level narration before Task 2 (verbatim real-exam "Take an interview…") */}
      {phase === "interviewNarration" && !error && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <NarrationCard
            title="Take an Interview"
            body={INTERVIEW_TASK_NARRATION}
            onContinue={handleInterviewNarrationContinue}
          />
        </div>
      )}

      {/* Interview Phase — embed InterviewTask full-screen */}
      {phase === "interview" && exam?.interviewSet && (
        <InterviewTask
          items={exam.interviewSet.questions || []}
          setInfo={exam.interviewSet}
          onComplete={handleInterviewComplete}
          onExit={onExit}
          isPractice={false}
          realMock={realMock}
        />
      )}

      {/* Results Phase */}
      {phase === "results" && finalScore && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <ResultsCard
            score={finalScore}
            elapsed={elapsed}
            onRestart={handleRestart}
            onExit={onExit}
            realMock={realMock}
            recordDate={recordDate}
          />
        </div>
      )}
    </div>
  );
}

// ------ Sub-components ------

function IntroCard({ onStart, onExit, realMock = false, preparing = false }) {
  return (
    <SurfaceCard style={{ padding: "32px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{"\uD83C\uDFA4"}</div>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: C.t1,
          marginBottom: 8,
        }}
      >
        {realMock ? "口语真题模考" : "口语模考"} · TOEFL 2026 Speaking Section
      </h2>
      <p
        style={{
          fontSize: 14,
          color: C.t2,
          lineHeight: 1.7,
          marginBottom: 20,
          maxWidth: 500,
          margin: "0 auto 20px",
        }}
      >
          {realMock ? "从未做过的完整真题套中预选 7 句复述与 4 道访谈问题，约 8 分钟。" : "模拟 TOEFL 2026 口语部分。先完成 7 句复述，再回答 4 道面试题。"}
      </p>

      {/* Info grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 24,
          maxWidth: 420,
          margin: "0 auto 24px",
        }}
      >
        <InfoBox label="Task 1" value="Listen & Repeat (7句)" />
        <InfoBox label="Task 2" value="Interview (4题)" />
        <InfoBox label="总时长" value="约 8 分钟" />
        <InfoBox label="评分" value="Band 1-6" />
      </div>

      {/* Explanation */}
      <div
        style={{
          background: ACCENT_SOFT,
          border: `1px solid ${ACCENT}25`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 24,
          fontSize: 12,
          color: C.t2,
          lineHeight: 1.6,
          textAlign: "left",
        }}
      >
        <strong style={{ color: ACCENT }}>{"评分\u89C4\u5219:"}</strong>{" "}
        {"\u590D\u8FF0\u6309 ETS \u5B98\u65B9 0-5 \u6863\u9010\u53E5评分\uFF08\u6EE1\u5206 35\uFF09\uFF0C\u9762\u8BD5\u7531 AI \u8BC4 0-5 \u5206\uFF08\u6EE1\u5206 20\uFF09\uFF0C\u539F\u59CB\u5206\u5408\u8BA1 55 \u5206\u6362\u7B97\u4E3A 1-6 Band\u3002"}
      </div>

      {/* Mic notice */}
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FCD34D",
          borderRadius: 10,
          padding: "10px 16px",
          marginBottom: 24,
          fontSize: 12,
          color: "#92400E",
          textAlign: "left",
        }}
      >
        {"\uD83C\uDFA4 \u53E3\u8BED\u6A21\u8003\u9700\u8981\u9EA6\u514B\u98CE\u6743\u9650\u3002\u8BF7\u786E\u4FDD\u6D4F\u89C8\u5668\u5DF2\u6388\u6743\u5F55\u97F3\u3002"}
        {realMock && (
          <div style={{ marginTop: 6, fontWeight: 600, lineHeight: 1.6 }}>
            开考后展示过的题会永久计为已做；口语录音中途刷新或离开，本卷作废、需要重新组卷。
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <Btn
          onClick={onStart}
          disabled={preparing}
          style={{
            background: ACCENT,
            borderColor: ACCENT,
            padding: "12px 32px",
            fontSize: 15,
          }}
        >
          {preparing ? "正在检查真题…" : "开始考试"}
        </Btn>
        <Btn onClick={onExit} variant="secondary">
          {"\u8FD4\u56DE"}
        </Btn>
      </div>
    </SurfaceCard>
  );
}

function InfoBox({ label, value }) {
  return (
    <div
      style={{
        background: ACCENT_SOFT,
        border: `1px solid ${ACCENT}20`,
        borderRadius: 10,
        padding: "10px 12px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: ACCENT,
          marginBottom: 4,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: C.t1, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/**
 * Task-level narration screen — reads the verbatim real-exam section/task
 * narration aloud (best-effort Web Speech) while the same text is on screen,
 * then advances on an explicit 继续 gesture. Not counted in the exam stopwatch.
 */
function NarrationCard({ title, body, onContinue }) {
  useNarration(body);

  return (
    <SurfaceCard style={{ padding: "36px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>{"\uD83D\uDD0A"}</div>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: C.t1, marginBottom: 16 }}>{title}</h3>
      <p
        style={{
          fontSize: 15,
          color: C.t2,
          lineHeight: 1.8,
          textAlign: "left",
          maxWidth: 560,
          margin: "0 auto 26px",
        }}
      >
        {body}
      </p>
      <Btn
        onClick={onContinue}
        style={{ background: ACCENT, borderColor: ACCENT, padding: "12px 40px", fontSize: 15 }}
      >
        {"\u7EE7\u7EED"}
      </Btn>
    </SurfaceCard>
  );
}

function ResultsCard({ score, elapsed, onRestart, onExit, realMock = false, recordDate = "" }) {
  const hasBand = Number.isFinite(score.band);
  // 真题模式不出估分时 color 为 null：中性配色、不挂等级（常规模考 color 恒有值，照旧）。
  const palette = BAND_COLORS[score.color] || (realMock ? NO_BAND_COLORS : BAND_COLORS.yellow);
  const levelLabel = LEVEL_LABELS[score.color] || "";

  const formatTime = (s) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Interview dimension averages
  const validIntvItems = (score.interviewItems || []).filter(
    (s) => s.aiScore && !s.aiScore.error
  );
  const dimKeys = ["fluency", "intelligibility", "language", "organization"];
  const dimLabels = {
    fluency: { zh: "\u6D41\u5229\u5EA6", en: "Fluency" },
    intelligibility: { zh: "\u53EF\u7406\u89E3\u5EA6", en: "Intelligibility" },
    language: { zh: "\u8BED\u8A00\u4F7F\u7528", en: "Language" },
    organization: { zh: "\u7EC4\u7EC7\u7ED3\u6784", en: "Organization" },
  };
  const dimColors = {
    fluency: "#F59E0B",
    intelligibility: "#0891B2",
    language: "#7C3AED",
    organization: "#16A34A",
  };

  const dimAverages = {};
  dimKeys.forEach((key) => {
    const vals = validIntvItems
      .map((s) => s.aiScore?.dimensions?.[key]?.score)
      .filter((v) => v != null);
    dimAverages[key] =
      vals.length > 0
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2) / 2
        : null;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Band Score Hero */}
      <SurfaceCard
        style={{
          padding: "32px 24px",
          textAlign: "center",
          border: `2px solid ${palette.border}`,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: C.t2,
            marginBottom: 8,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {"\u53E3\u8BED\u6A21\u8003\u7ED3\u679C"}
        </div>

        {/* Band circle */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            width: 120,
            height: 120,
            borderRadius: "50%",
            border: `4px solid ${palette.ring}`,
            background: palette.bg,
            margin: "8px auto 12px",
          }}
        >
          <span
            style={{
              fontSize: 42,
              fontWeight: 800,
              color: palette.text,
              lineHeight: 1,
              fontFamily: FONT,
            }}
          >
            {Number.isFinite(score.band) ? score.band.toFixed(1) : "--"}
          </span>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: palette.text, marginTop: 2 }}
          >
            Band
          </span>
        </div>

        <div
          style={{
            display: "inline-block",
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            borderRadius: 14,
            padding: "3px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: palette.text,
            marginBottom: 8,
          }}
        >
          {realMock ? (hasBand ? "本站模考估分" : "本次不出估分") : `CEFR: ${score.cefr}`} {levelLabel && `· ${levelLabel}`}
        </div>

        {/* 真题模式：说清楚为什么没有估分 / 分数里含了哪些 0 分。 */}
        {realMock && (score.unscored > 0 || score.unanswered > 0) && (
          <div data-testid="real-speaking-score-note" style={{ fontSize: 12.5, color: C.t2, lineHeight: 1.7, maxWidth: 480, margin: "4px auto 0" }}>
            {score.unscored > 0 && <div>有 {score.unscored} 题录了音但评分没完成（语音识别或 AI 评分失败），本次不出估分。</div>}
            {score.unanswered > 0 && <div>{score.unanswered} 题没有作答，按 0 分计入。</div>}
          </div>
        )}

        <div style={{ fontSize: 13, color: C.t3, marginTop: 4 }}>
          {"\u7528\u65F6: "}{formatTime(elapsed)}
        </div>
      </SurfaceCard>

      {/* Score breakdown */}
      <SurfaceCard style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid " + C.bdr,
            fontSize: 13,
            fontWeight: 700,
            color: C.t1,
          }}
        >
          {"\u5206\u9879\u7ED3\u679C"}
        </div>

        {/* Repeat section */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: C.t1, fontWeight: 600 }}>
                Task 1: Listen & Repeat
              </div>
              <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
                {"\u539F\u59CB\u5206 "}{score.repeatRaw != null ? score.repeatRaw : "\u2014"}/35
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>
                {realMock && score.repeatRaw == null ? "--" : `${score.repeatScore.toFixed(1)}/5`}
              </div>
              <div style={{ fontSize: 11, color: C.t2 }}>
                {score.avgRepeatAccuracy}% {"\u51C6\u786E\u7387"}
              </div>
            </div>
          </div>

          {/* Per-sentence mini bar */}
          <div style={{ display: "flex", gap: 3 }}>
            {(score.repeatItems || []).map((item, i) => {
              const acc = item.score?.accuracy || 0;
              const bg =
                acc >= 80 ? "#22c55e" : acc >= 60 ? "#eab308" : acc > 0 ? "#ef4444" : "#e2e8f0";
              return (
                <div
                  key={i}
                  title={`S${i + 1}: ${acc}%`}
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: bg,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Interview section */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: C.t1, fontWeight: 600 }}>
                Task 2: Take an Interview
              </div>
              <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
                {"\u539F\u59CB\u5206 "}{score.interviewRaw != null ? score.interviewRaw : "\u2014"}/20
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>
                {realMock && score.interviewRaw == null ? "--" : `${score.interviewScore.toFixed(1)}/5`}
              </div>
              {/* 真题模式四题全跳过时原始分是 0、不是识别失败（未作答已在上面说明）。 */}
              {validIntvItems.length === 0 && !(realMock && score.interviewRaw != null) && (
                <div style={{ fontSize: 11, color: "#DC2626" }}>
                  {"\u8BED\u97F3\u8BC6\u522B\u5931\u8D25"}
                </div>
              )}
            </div>
          </div>

          {/* Per-question scores */}
          <div style={{ display: "flex", gap: 3 }}>
            {(score.interviewItems || []).map((item, i) => {
              const sc = item.aiScore?.score || 0;
              const bg =
                sc >= 4 ? "#22c55e" : sc >= 3 ? "#eab308" : sc > 0 ? "#ef4444" : "#e2e8f0";
              return (
                <div
                  key={i}
                  title={`Q${i + 1}: ${sc}/5`}
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: bg,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Interview dimension averages */}
        {validIntvItems.length > 0 && (
          <div style={{ padding: "14px 16px" }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.t3,
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {"\u9762\u8BD5\u7EF4\u5EA6\u5F97\u5206"}
            </div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              {dimKeys.map((key) => {
                const avg = dimAverages[key];
                if (avg == null) return null;
                return (
                  <div key={key} style={{ textAlign: "center", minWidth: 60 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        color: dimColors[key],
                      }}
                    >
                      {avg}
                    </div>
                    <div style={{ fontSize: 10, color: C.t3, fontWeight: 600 }}>
                      {dimLabels[key].zh}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Overall bar */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 12, color: C.t3, marginBottom: 6 }}>
            {"\u7EFC\u5408\u5F97\u5206"}
          </div>
          <div
            style={{
              height: 8,
              background: "#e2e8f0",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 4,
                background: `linear-gradient(90deg, ${palette.border}, ${palette.ring})`,
                width: `${(Number.isFinite(score.band) ? score.band / 6 : 0) * 100}%`,
                transition: "width 600ms ease",
              }}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: C.t3,
              marginTop: 4,
              textAlign: "right",
            }}
          >
            {Number.isFinite(score.band) ? score.band.toFixed(1) : "--"} / 6.0
          </div>
        </div>
      </SurfaceCard>

      {/* Review hint — speaking mocks save a score summary (no per-question
          answer key, unlike reading/listening), so word this as "回看成绩". */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        background: "#FFF7ED", border: "1px solid #FED7AA",
        borderRadius: 8, padding: "11px 14px",
        fontSize: 13, color: C.t2, lineHeight: 1.6,
      }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{"💡"}</span>
        {realMock ? (
          // 真题模考记录住在「真题练习记录」（口语练习记录不收它），按保存时的 date 深链到这一条。
          <span>
            本次模考记录已保存到「真题练习记录」。{" "}
            {/* 站内跳转（不是整页刷新）：刚存的记录还在内存里的历史缓存中，云端写入未完成也能深链到。 */}
            <Link
              data-testid="real-speaking-record-link"
              href={`/real-bank/progress${recordDate ? `?mock=${encodeURIComponent(recordDate)}` : ""}`}
              style={{ color: ACCENT, fontWeight: 700 }}
            >
              查看本次记录 →
            </Link>
          </span>
        ) : (
          <span>{"本次模考成绩已保存，可在首页 "}<strong style={{ color: ACCENT }}>{"口语练习记录"}</strong>{" 中回看。"}</span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <Btn onClick={onRestart} style={{ background: ACCENT, borderColor: ACCENT }}>
          {"\u91CD\u65B0\u8003\u8BD5"}
        </Btn>
        <Btn onClick={onExit} variant="secondary">
          {realMock ? "返回真题专区" : "\u8FD4\u56DE\u9996\u9875"}
        </Btn>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 12,
          color: "#92400e",
          lineHeight: 1.6,
        }}
      >
        {realMock ? "原始分按公开题型评分口径汇总；1–6 为本站未校准估分，未经 ETS 等值，不代表官方成绩。" : "该分数基于模拟考试算法估算，不代表官方 ETS 成绩。TOEFL 为 ETS 注册商标。"}
      </div>
    </div>
  );
}
