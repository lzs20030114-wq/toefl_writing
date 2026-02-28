"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import EM_DATA from "../../data/emailWriting/prompts.json";
import AD_DATA from "../../data/academicWriting/prompts.json";
import { wc } from "../../lib/utils";
import { saveSess, addDoneIds } from "../../lib/sessionStore";
import { mapScoringError } from "../../lib/ai/client";
import { evaluateWritingResponse } from "../../lib/ai/writingEval";
import { BANK_EXHAUSTED_ERRORS, DONE_STORAGE_KEYS, pickRandomPrompt } from "../../lib/questionSelector";
import { C, FONT, Btn, InfoStrip, PageShell, SurfaceCard, Toast, TopBar } from "../shared/ui";
import { ScoringReport } from "./ScoringReport";
import { WritingPromptPanel } from "./WritingPromptPanel";
import { WritingResponsePanel } from "./WritingResponsePanel";
import { formatMinutesLabel, PRACTICE_MODE } from "../../lib/practiceMode";
import { normalizeReportLanguage, readReportLanguage } from "../../lib/reportLanguage";

function normalizeEmailPrompt(input, fallbackId = "gen-email") {
  if (!input || typeof input !== "object") return null;
  const scenario = String(input.scenario || "").trim();
  const direction = String(input.direction || "").trim();
  const goals = Array.isArray(input.goals)
    ? input.goals.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!scenario || !direction || goals.length < 3) return null;
  return {
    id: String(input.id || fallbackId),
    to: String(input.to || "Professor").trim() || "Professor",
    from: String(input.from || "You").trim() || "You",
    scenario,
    direction,
    goals,
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
  return {
    id: String(input.id || fallbackId),
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
  const limit = Number.isFinite(timeLimitSeconds) && timeLimitSeconds > 0 ? timeLimitSeconds : defaultLimit;
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
    tr.current = setInterval(() => setTl(p => {
      if (p <= 1) { clearInterval(tr.current); setRun(false); return 0; }
      return p - 1;
    }), 1000);
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

  useEffect(() => { if (tl === 0 && phaseRef.current === "writing") { submitRef.current({ skipConfirm: true }); } }, [tl]);

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
  const introTitle = type === "email" ? "任务 2：邮件写作" : "任务 3：学术讨论写作";
  const introDescLine1 = type === "email"
    ? "你需要阅读题目信息，并据此完成一封邮件。"
    : "你需要阅读题目和其他学生的回应，再写出自己的观点。";
  const introDescLine2 = type === "email"
    ? "你将有 7 分钟完成邮件写作。"
    : "你将有 10 分钟完成作答。";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {!embedded && <TopBar title={type === "email" ? "邮件写作" : "学术讨论写作"} section={type === "email" ? "写作练习｜任务 2" : "写作练习｜任务 3"} timeLeft={phase !== "ready" ? tl : undefined} isRunning={run} onExit={onExit} />}
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
              {practiceMode === PRACTICE_MODE.CHALLENGE && <div>模式：<b>挑战模式</b>（限时更紧）</div>}
            </div>
            <div style={{ marginTop: 18 }}>
              <Btn
                data-testid="writing-intro-start"
                onClick={() => {
                  setIntro(false);
                  start();
                }}
              >
                继续并开始计时
              </Btn>
            </div>
          </SurfaceCard>
        ) : (
          <>
        <InfoStrip style={{ marginBottom: 20 }}>
          <b>作答说明：</b>{type === "email" ? `请完成一封覆盖 3 个目标点的邮件。${formatMinutesLabel(limit)}。建议 80-120 词。` : `阅读讨论内容并写出你的回应。${formatMinutesLabel(limit)}。建议不少于 100 词。`}
          {practiceMode === PRACTICE_MODE.CHALLENGE && <span> 当前为挑战模式，限时更紧。</span>}
        </InfoStrip>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <WritingPromptPanel type={type} pd={pd} />
          <WritingResponsePanel
            type={type}
            pd={pd}
            phase={phase}
            text={text}
            onTextChange={setText}
            w={w}
            minW={minW}
            fb={fb}
            deferScoring={deferScoring}
            requestState={requestState}
            scoreError={scoreError}
            onStart={start}
            onSubmit={submitScore}
            onRetry={retryScore}
            onExit={onExit}
            embedded={embedded}
          />
        </div>
          </>
        )}
        {phase === "done" && fb && (
          <div style={{ marginTop: 20 }}><ScoringReport result={fb} type={type} uiLang={uiReportLanguage} /><div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}><Btn onClick={next} variant="secondary">下一题</Btn><Btn onClick={retryCurrentPrompt} variant="secondary">再练一遍</Btn><Btn onClick={onExit} variant="secondary">{embedded ? "返回" : "返回练习"}</Btn></div></div>
        )}
          </>
        )}
      </PageShell>
    </div>
  );
}

