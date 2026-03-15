"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import EM_DATA from "../../data/emailWriting/prompts.json";
import AD_DATA from "../../data/academicWriting/prompts.json";
import { wc } from "../../lib/utils";
import { saveSess, addDoneIds } from "../../lib/sessionStore";
import { mapScoringError } from "../../lib/ai/client";
import { evaluateWritingResponse } from "../../lib/ai/writingEval";
import { BANK_EXHAUSTED_ERRORS, DONE_STORAGE_KEYS, pickRandomPrompt } from "../../lib/questionSelector";
import { C, FONT, Btn, InfoStrip, PageShell, SurfaceCard, DisclosureSection, Toast, TopBar } from "../shared/ui";
import { WritingFeedbackPanel } from "./WritingFeedbackPanel";
import { WritingPromptPanel } from "./WritingPromptPanel";
import { WritingResponsePanel } from "./WritingResponsePanel";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage, readReportLanguage } from "../../lib/reportLanguage";
import { useIsMobile } from "../../hooks/useIsMobile";

function normalizeEmailPrompt(input, fallbackId = "gen-email") {
  if (!input || typeof input !== "object") return null;
  const scenario = String(input.scenario || "").trim();
  const direction = String(input.direction || "").trim();
  const goals = Array.isArray(input.goals)
    ? input.goals.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!scenario || !direction || goals.length < 3) return null;
  const subject = String(input.subject || "").trim();
  return {
    id: String(input.id || fallbackId),
    to: String(input.to || "Professor").trim() || "Professor",
    scenario,
    direction,
    goals,
    ...(subject && { subject }),
  };
}

function normalizeDiscussionPrompt(input, fallbackId = "gen-discussion") {
  if (!input || typeof input !== "object") return null;
  const professorName = String(input?.professor?.name || "").trim();
  const professorText = String(input?.professor?.text || "").trim();
  const students = Array.isArray(input?.students)
    ? input.students
      .map((s) => ({
        name: String(s?.name || "").trim(),
        text: String(s?.text || "").trim(),
      }))
      .filter((s) => s.name && s.text)
      .slice(0, 2)
    : [];
  if (!professorName || !professorText || students.length < 2) return null;
  const course = String(input?.course || "").trim() || undefined;
  return {
    id: String(input.id || fallbackId),
    ...(course && { course }),
    professor: { name: professorName, text: professorText },
    students,
  };
}

function normalizePrompt(type, input, fallbackId) {
  return type === "email"
    ? normalizeEmailPrompt(input, fallbackId)
    : normalizeDiscussionPrompt(input, fallbackId);
}

function summarizePrompt(type, pd) {
  if (!pd) return "";
  const src = type === "email" ? pd.scenario : pd?.professor?.text;
  const text = String(src || "").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function confirmEarlySubmit() {
  const confirmFn = typeof window !== "undefined" ? window.confirm : null;
  if (typeof confirmFn !== "function") return true;
  const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(String(navigator.userAgent || ""));
  if (isJsdom && !confirmFn._isMockFunction) return true;
  try {
    return confirmFn("还有剩余时间，确定要提前提交吗？");
  } catch {
    // jsdom and some embedded contexts do not implement confirm; default allow.
  }
  return true;
}

function isPromptExhaustedError(err) {
  return String(err?.message || "").includes(BANK_EXHAUSTED_ERRORS.PROMPT);
}

function createPracticeRootId(type, promptId) {
  const safeType = String(type || "writing");
  const safePrompt = String(promptId || "prompt");
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${safeType}-${safePrompt}-${ts}-${rand}`;
}

export function WritingTask({
  onExit,
  type,
  embedded = false,
  persistSession = true,
  onComplete = null,
  deferScoring = false,
  onTimerChange = null,
  timeLimitSeconds = null,
  practiceMode = PRACTICE_MODE.STANDARD,
  showTaskIntro = true,
  autoStartOnMount = false,
  reportLanguage,
  initialPromptId = "",
  initialPracticeRootId = "",
  initialPracticeAttempt = 1,
}) {
  const isPracticeMode = practiceMode === PRACTICE_MODE.PRACTICE;
  const isMobile = useIsMobile();
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const uiReportLanguage = normalizeReportLanguage(reportLanguage || readReportLanguage());
  const dataRaw = type === "email" ? EM_DATA : AD_DATA;
  const data = useMemo(
    () =>
      (Array.isArray(dataRaw)
        ? dataRaw
          .map((d, i) => normalizePrompt(type, d, `${type}-${i + 1}`))
          .filter(Boolean)
        : []),
    [dataRaw, type]
  );
  const defaultLimit = type === "email" ? 420 : 600;
  const limit = isPracticeMode ? 0 : (Number.isFinite(timeLimitSeconds) && timeLimitSeconds > 0 ? timeLimitSeconds : defaultLimit);
  const minW = type === "email" ? 80 : 100;
  const storageKey = type === "email" ? DONE_STORAGE_KEYS.EMAIL : DONE_STORAGE_KEYS.DISCUSSION;

  const usedRef = useRef(new Set());
  const [initialSelection] = useState(() => {
    if (data.length === 0) return { error: "题库为空或数据异常。", index: -1 };
    const forcedPromptId = String(initialPromptId || "").trim();
    if (forcedPromptId) {
      const forcedIdx = data.findIndex((x) => String(x?.id || "") === forcedPromptId);
      if (forcedIdx >= 0) {
        usedRef.current.add(forcedIdx);
        return { error: "", index: forcedIdx };
      }
      return { error: "指定题目不存在或已下线。", index: -1 };
    }
    try {
      const i = pickRandomPrompt(data, usedRef.current, storageKey);
      usedRef.current.add(i);
      return { error: "", index: i };
    } catch (e) {
      return { error: isPromptExhaustedError(e) ? "当前账号该题库已全部答完。" : "题库为空或数据异常。", index: -1 };
    }
  });
  const initialError = initialSelection?.error || "";
  const [pi, setPi] = useState(() => {
    if (initialError) return -1;
    if (Number.isInteger(initialSelection?.index)) return initialSelection.index;
    const first = Array.from(usedRef.current)[0];
    return Number.isInteger(first) ? first : 0;
  });
  const [pd, setPd] = useState(() => (pi >= 0 ? data[pi] || null : null));
  const [text, setText] = useState("");
  const [tl, setTl] = useState(limit);
  const [run, setRun] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [fb, setFb] = useState(null);
  const [requestState, setRequestState] = useState("idle");
  const [scoreError, setScoreError] = useState("");
  const [toast, setToast] = useState(null);
  const [intro, setIntro] = useState(showTaskIntro);
  const tr = useRef(null);
  const submitLockRef = useRef(false);
  const practiceRootIdRef = useRef("");
  const practiceAttemptRef = useRef(1);

  useEffect(() => {
    if (!pd?.id) return;
    const forcedRoot = String(initialPracticeRootId || "").trim();
    if (forcedRoot && !practiceRootIdRef.current) {
      practiceRootIdRef.current = forcedRoot;
      const parsedAttempt = Number(initialPracticeAttempt);
      practiceAttemptRef.current = Number.isFinite(parsedAttempt) && parsedAttempt > 0 ? Math.floor(parsedAttempt) : 1;
      return;
    }
    practiceRootIdRef.current = createPracticeRootId(type, pd.id);
    practiceAttemptRef.current = 1;
  }, [type, pd?.id, initialPracticeRootId, initialPracticeAttempt]);

  useEffect(() => { setPd(pi >= 0 ? data[pi] || null : null); }, [pi, data]);
  useEffect(() => { setIntro(showTaskIntro); }, [showTaskIntro, type]);

  const submitRef = useRef(null);
  const phaseRef = useRef(phase);
  const completionSentRef = useRef(false);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => {
    if (typeof onTimerChange === "function") {
      onTimerChange({ timeLeft: tl, isRunning: run, phase });
    }
  }, [tl, run, phase, onTimerChange]);

  function start() {
    if (phase !== "ready") return;
    if (run) return;
    if (tr.current) clearInterval(tr.current);
    setRequestState("idle");
    setScoreError("");
    setPhase("writing");
    setRun(true);
    if (!isPracticeMode) {
      tr.current = setInterval(() => setTl(p => {
        if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; }
        return p - 1;
      }), 1000);
    }
  }

  async function runScoringAttempt() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    clearInterval(tr.current);
    setRun(false);
    setPhase("scoring");
    setRequestState("pending");
    setScoreError("");
    setFb(null);
    try {
      if (!pd) {
        throw new Error("题目数据缺失。");
      }
      const r = await evaluateWritingResponse(type, pd, text, uiReportLanguage);
      setFb(r);
      setPhase("done");
      if (r) {
        const payload = {
          type, score: r.score, band: r.band, wordCount: wc(text), weaknesses: r.weaknesses, next_steps: r.next_steps, mode: practiceMode,
          details: {
            promptSummary: summarizePrompt(type, pd),
            promptId: String(pd?.id || ""),
            promptData: pd,
            userText: text,
            feedback: r,
            practiceRootId: practiceRootIdRef.current || createPracticeRootId(type, pd?.id),
            practiceAttempt: practiceAttemptRef.current,
          }
        };
        if (persistSession) {
          saveSess(payload);
          addDoneIds(storageKey, [pd.id]);
        }
        if (typeof onComplete === "function" && !completionSentRef.current) {
          completionSentRef.current = true;
          onComplete(payload);
        }
        setRequestState("success");
      } else {
        setRequestState("error");
        setScoreError("评分结果无效，请重试");
      }
    } catch (e) {
      setPhase("done");
      setRequestState("error");
      setScoreError(mapScoringError(e));
    } finally {
      submitLockRef.current = false;
    }
  }

  useEffect(() => {
    if (intro) return;
    if (!autoStartOnMount) return;
    if (phase !== "ready") return;
    start();
  }, [intro, autoStartOnMount, phase]);

  function shouldConfirmEarlySubmit() {
    if (isPracticeMode) return false;
    return phaseRef.current === "writing" && Number.isFinite(tl) && tl > 0;
  }

  async function submitScore({ skipConfirm = false } = {}) {
    if (!skipConfirm && shouldConfirmEarlySubmit()) {
      const ok = confirmEarlySubmit();
      if (!ok) return;
    }
    if (deferScoring) {
      if (submitLockRef.current) return;
      submitLockRef.current = true;
      clearInterval(tr.current);
      setRun(false);
      setPhase("done");
      if (!pd) {
        submitLockRef.current = false;
        setRequestState("error");
        setScoreError("题目数据缺失。");
        return;
      }
      setRequestState("success");
      setScoreError("");
      if (typeof onComplete === "function" && !completionSentRef.current) {
        completionSentRef.current = true;
        onComplete({
          type,
          wordCount: wc(text),
          mode: practiceMode,
          details: {
            promptData: pd,
            promptSummary: summarizePrompt(type, pd),
            userText: text,
            reportLanguage: uiReportLanguage,
          },
        });
      }
      submitLockRef.current = false;
      return;
    }
    await runScoringAttempt();
  }
  submitRef.current = submitScore;

  async function retryScore() { await runScoringAttempt(); }

  useEffect(() => { if (!isPracticeMode && tl === 0 && phaseRef.current === "writing") { submitRef.current({ skipConfirm: true }); } }, [tl]);

  useEffect(() => {
    function handleKey(e) { if (e.ctrlKey && e.key === "Enter" && phaseRef.current === "writing") { e.preventDefault(); submitRef.current(); } }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function next() {
    clearInterval(tr.current);
    let n = 0;
    try {
      n = pickRandomPrompt(data, usedRef.current, storageKey);
    } catch (e) {
      setToast(isPromptExhaustedError(e) ? "题库中没有新题了，你已完成该题库全部题目。" : "题库不可用，请稍后重试。");
      return;
    }
    usedRef.current.add(n);
    practiceRootIdRef.current = createPracticeRootId(type, data[n]?.id);
    practiceAttemptRef.current = 1;
    setPi(n); setPd(data[n]); setText(""); setTl(limit); setRun(false); setPhase("ready"); setFb(null); setRequestState("idle"); setScoreError(""); submitLockRef.current = false; completionSentRef.current = false; setIntro(showTaskIntro);
  }

  function retryCurrentPrompt() {
    if (!pd) return;
    clearInterval(tr.current);
    practiceAttemptRef.current += 1;
    setText("");
    setTl(limit);
    setRun(false);
    setPhase("ready");
    setFb(null);
    setRequestState("idle");
    setScoreError("");
    submitLockRef.current = false;
    completionSentRef.current = false;
    setIntro(showTaskIntro);
  }
  useEffect(() => () => clearInterval(tr.current), []);

  const w = wc(text);
  const introTitle = type === "email" ? "Write an Email" : "Task 3: Writing for an Academic Discussion";
  const introDescLine1 = type === "email"
    ? "You will read some information and use the information to write an email."
    : "Read the professor's prompt and two student responses, then write your own contribution.";
  const introDescLine2 = isPracticeMode
    ? "No time limit in Practice mode."
    : type === "email"
    ? "You will have 7 minutes to write the email."
    : "You will have 10 minutes to complete your response.";

  const topBarHeight = embedded ? 0 : 56;
  const directionsText = type === "email"
    ? `Write an email addressing all 3 goals.${isPracticeMode ? "" : ` ${formatMinutesLabel(limit)}.`} Aim for 80–120 words.`
    : `Read the discussion and write your response.${isPracticeMode ? "" : ` ${formatMinutesLabel(limit)}.`} Aim for 100+ words.`;
  const mobileActiveWriting = isMobile && !initialError && pd && !(intro && phase === "ready");

  return (
    <div style={{
      background: C.bg, fontFamily: FONT,
      ...(mobileActiveWriting
        ? { height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }
        : { minHeight: "100vh" }),
    }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {!embedded && <TopBar title={type === "email" ? "Email Writing" : "Academic Discussion Writing"} section={type === "email" ? "Writing Practice | Task 2" : "Writing Practice | Task 3"} timeLeft={isPracticeMode ? undefined : (phase !== "ready" ? tl : undefined)} isRunning={run} onExit={onExit} />}

      {phase === "done" && fb ? (
        <WritingFeedbackPanel
          fb={fb}
          type={type}
          pd={pd}
          userText={text}
          topBarHeight={topBarHeight}
          onNext={next}
          onRetry={retryCurrentPrompt}
          onExit={onExit}
        />
      ) : mobileActiveWriting ? (
        /* 移动端答题：全屏 flex 布局，无 PageShell */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "6px 10px 0" }}>
          <div style={{ flexShrink: 0, background: "#ecfdf5", borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: 11, color: C.t2, lineHeight: 1.5 }}>
            <b>Directions: </b>{directionsText}
            {practiceMode === PRACTICE_MODE.CHALLENGE && <span> Challenge mode active.</span>}
            {isPracticeMode && <span> Practice mode — no time limit.</span>}
          </div>
          <div style={{ flexShrink: 0 }}>
            <DisclosureSection
              title={type === "email" ? "Email Prompt" : "Discussion Prompt"}
              preview={promptCollapsed ? (pd.title || pd.topic || "").slice(0, 40) + "…" : ""}
              open={!promptCollapsed}
              onToggle={() => setPromptCollapsed((v) => !v)}
              icon="📝"
            >
              <div style={{ padding: "10px 12px", maxHeight: "30vh", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
                <WritingPromptPanel type={type} pd={pd} />
              </div>
            </DisclosureSection>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, marginTop: 6 }}>
            <WritingResponsePanel
              type={type} pd={pd} phase={phase}
              text={text} onTextChange={setText}
              w={w} minW={minW} fb={fb}
              deferScoring={deferScoring}
              requestState={requestState} scoreError={scoreError}
              onStart={start} onSubmit={submitScore}
              onRetry={retryScore} onExit={onExit}
              embedded={embedded} isMobile={true}
            />
          </div>
        </div>
      ) : (
        <PageShell narrow>
          {initialError && (
            <SurfaceCard style={{ padding: 28, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>题库不可用</div>
              <div style={{ fontSize: 14, color: C.t2 }}>{initialError}</div>
              <div style={{ marginTop: 16 }}><Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回练习"}</Btn></div>
            </SurfaceCard>
          )}
          {!initialError && !pd && (
            <SurfaceCard style={{ padding: 28, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.red, marginBottom: 8 }}>题目不可用</div>
              <div style={{ fontSize: 14, color: C.t2 }}>请刷新后重试。</div>
            </SurfaceCard>
          )}
          {!initialError && pd && (
            <>
              {intro && phase === "ready" ? (
                <SurfaceCard style={{ padding: 28 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.nav, marginBottom: 10 }}>{introTitle}</div>
                  <div style={{ fontSize: 14, color: C.t1, lineHeight: 1.7, marginBottom: 12 }}>
                    <div>{introDescLine1}</div>
                    <div>{introDescLine2}</div>
                  </div>
                  <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.7 }}>
                    {practiceMode === PRACTICE_MODE.CHALLENGE && <div>Mode: <b>Challenge</b> (reduced time limit)</div>}
                    {isPracticeMode && <div>Mode: <b>Practice</b> (no time limit)</div>}
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <Btn
                      data-testid="writing-intro-start"
                      onClick={() => { setIntro(false); start(); }}
                    >
                      Start Writing
                    </Btn>
                  </div>
                </SurfaceCard>
              ) : (
                <>
                  <InfoStrip style={{ marginBottom: 20 }}>
                    <b>Directions: </b>{directionsText}
                    {practiceMode === PRACTICE_MODE.CHALLENGE && <span> Challenge mode active — time limit is reduced.</span>}
                    {isPracticeMode && <span> Practice mode — no time limit.</span>}
                  </InfoStrip>
                  {/* 桌面端：左右双栏 */}
                  <div className="tp-writing-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <WritingPromptPanel type={type} pd={pd} />
                    <WritingResponsePanel
                      type={type} pd={pd} phase={phase}
                      text={text} onTextChange={setText}
                      w={w} minW={minW} fb={fb}
                      deferScoring={deferScoring}
                      requestState={requestState} scoreError={scoreError}
                      onStart={start} onSubmit={submitScore}
                      onRetry={retryScore} onExit={onExit}
                      embedded={embedded}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </PageShell>
      )}
    </div>
  );
}

