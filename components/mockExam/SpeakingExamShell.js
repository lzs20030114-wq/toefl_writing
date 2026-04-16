"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT, Btn, TopBar, SurfaceCard } from "../shared/ui";
import { RepeatTask } from "../speaking/RepeatTask";
import { InterviewTask } from "../speaking/InterviewTask";
import { buildSpeakingExam } from "../../lib/mockExam/speakingPlanner";
import { saveSess } from "../../lib/sessionStore";

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

const LEVEL_LABELS = {
  green: "\u9AD8\u7EA7",
  blue: "\u4E2D\u9AD8\u7EA7",
  yellow: "\u4E2D\u7EA7",
  orange: "\u521D\u4E2D\u7EA7",
  red: "\u521D\u7EA7",
};

// ------ Scoring helpers ------

/**
 * Map repeat accuracy (0-100) to a 0-5 score.
 */
function accuracyToScore(accuracy) {
  if (accuracy == null || accuracy < 0) return 0;
  // Linear map: 100% -> 5, 0% -> 0
  return Math.round((accuracy / 100) * 5 * 2) / 2; // round to nearest 0.5
}

/**
 * Calculate the speaking exam band (1-6).
 *
 * repeatScore: 0-5 (from accuracy)
 * interviewScore: 0-5 (average of AI dimension scores)
 * Weight: repeat 40%, interview 60%
 * Map to 1-6 band
 */
function calculateSpeakingBand(repeatScore, interviewScore) {
  const safeRepeat = typeof repeatScore === "number" ? repeatScore : 0;
  const safeInterview = typeof interviewScore === "number" ? interviewScore : 0;
  const weighted = safeRepeat * 0.4 + safeInterview * 0.6;
  // Map 0-5 weighted score to 1-6 band
  const rawBand = (weighted / 5) * 6;
  const band = Math.max(1.0, Math.round(rawBand * 2) / 2);
  return Math.min(6.0, band);
}

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
 * Phases: intro -> repeat -> transition -> interview -> results
 *
 * NOT adaptive — it is a straight-through 2-task exam.
 */
export function SpeakingExamShell({ onExit }) {
  const [phase, setPhase] = useState("intro");
  const [exam, setExam] = useState(null);
  const [repeatResults, setRepeatResults] = useState(null);
  const [interviewResults, setInterviewResults] = useState(null);
  const [finalScore, setFinalScore] = useState(null);
  const [error, setError] = useState(null);

  // Timer
  const [elapsed, setElapsed] = useState(0);
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

  // ------ Phase transitions ------

  function handleStartExam() {
    try {
      const built = buildSpeakingExam();
      if (!built.repeatSet || !built.interviewSet) {
        setError("\u9898\u5E93\u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u5F00\u59CB\u8003\u8BD5\u3002\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002");
        return;
      }
      setExam(built);
      setRepeatResults(null);
      setInterviewResults(null);
      setFinalScore(null);
      setElapsed(0);
      setError(null);
      setPhase("repeat");
    } catch (e) {
      setError("\u521D\u59CB\u5316\u8003\u8BD5\u5931\u8D25: " + (e.message || "unknown error"));
    }
  }

  function handleRepeatComplete(result) {
    setRepeatResults(result);
    setPhase("transition");
    // Auto-advance after 2 seconds
    setTimeout(() => {
      setPhase("interview");
    }, 2000);
  }

  function handleInterviewComplete(result) {
    setInterviewResults(result);
    computeScore(repeatResults, result);
  }

  function computeScore(rptResults, intvResults) {
    // Extract repeat score from accuracy
    const rptItems = rptResults?.items || [];
    const validRptScores = rptItems.filter((s) => s.score);
    const avgRepeatAccuracy = validRptScores.length
      ? validRptScores.reduce((sum, s) => sum + s.score.accuracy, 0) / validRptScores.length
      : 0;
    const repeatScore = accuracyToScore(avgRepeatAccuracy);

    // Extract interview score from AI scores
    const intvItems = intvResults?.items || [];
    const validIntvScores = intvItems.filter((s) => s.aiScore && !s.aiScore.error);
    const interviewScore = validIntvScores.length
      ? Math.round(
          (validIntvScores.reduce((sum, s) => sum + s.aiScore.score, 0) / validIntvScores.length) * 2
        ) / 2
      : 0;

    const band = calculateSpeakingBand(repeatScore, interviewScore);
    const cefr = bandToCEFR(band);
    const color = getScoreColor(band);

    const score = {
      band,
      cefr,
      color,
      repeatScore,
      interviewScore,
      avgRepeatAccuracy: Math.round(avgRepeatAccuracy),
      repeatItems: rptItems,
      interviewItems: intvItems,
    };

    setFinalScore(score);

    // Save session
    try {
      saveSess({
        type: "speaking-exam",
        date: new Date().toISOString(),
        band,
        cefr,
        details: {
          repeatScore,
          interviewScore,
          avgRepeatAccuracy: Math.round(avgRepeatAccuracy),
          repeatSetId: exam?.repeatSet?.id,
          interviewSetId: exam?.interviewSet?.id,
          elapsed,
        },
      });
    } catch {}

    setPhase("results");
  }

  function handleRestart() {
    setPhase("intro");
    setExam(null);
    setRepeatResults(null);
    setInterviewResults(null);
    setFinalScore(null);
    setError(null);
    setElapsed(0);
  }

  // ------ Render ------

  const topBarTitle =
    phase === "repeat"
      ? "Task 1 \u00B7 Listen & Repeat"
      : phase === "interview"
        ? "Task 2 \u00B7 Take an Interview"
        : phase === "transition"
          ? "\u51C6\u5907\u4E0B\u4E00\u9898..."
          : phase === "results"
            ? "\u8003\u8BD5\u7ED3\u679C"
            : "\u53E3\u8BED\u6A21\u8003";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      {/* Top bar — only show on intro, transition, and results */}
      {(phase === "intro" || phase === "transition" || phase === "results") && (
        <TopBar
          title={topBarTitle}
          section="Speaking | \u6A21\u8003\u6A21\u5F0F"
          elapsedTime={phase !== "intro" ? elapsed : undefined}
          onExit={onExit}
        />
      )}

      {/* Intro Phase */}
      {phase === "intro" && !error && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <IntroCard onStart={handleStartExam} onExit={onExit} />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <SurfaceCard style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9888;&#65039;</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 8 }}>{error}</div>
            <Btn onClick={handleRestart} variant="secondary">
              \u8FD4\u56DE
            </Btn>
          </SurfaceCard>
        </div>
      )}

      {/* Repeat Phase — embed RepeatTask full-screen */}
      {phase === "repeat" && exam?.repeatSet && (
        <RepeatTask
          items={exam.repeatSet.sentences || []}
          onComplete={handleRepeatComplete}
          onExit={onExit}
          isPractice={false}
        />
      )}

      {/* Transition Phase */}
      {phase === "transition" && (
        <div style={{ maxWidth: 800, margin: "24px auto", padding: "0 20px" }}>
          <TransitionCard />
        </div>
      )}

      {/* Interview Phase — embed InterviewTask full-screen */}
      {phase === "interview" && exam?.interviewSet && (
        <InterviewTask
          items={exam.interviewSet.questions || []}
          onComplete={handleInterviewComplete}
          onExit={onExit}
          isPractice={false}
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
          />
        </div>
      )}
    </div>
  );
}

// ------ Sub-components ------

function IntroCard({ onStart, onExit }) {
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
        {"\u53E3\u8BED\u6A21\u8003"} {"\u00B7"} TOEFL 2026 Speaking Section
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
        {"\u6A21\u62DF TOEFL 2026 \u53E3\u8BED\u90E8\u5206\u3002\u5148\u5B8C\u6210 7 \u53E5\u590D\u8FF0\uFF0C\u518D\u56DE\u7B54 4 \u9053\u9762\u8BD5\u9898\u3002"}
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
        <InfoBox label="Task 1" value="Listen & Repeat (7\u53E5)" />
        <InfoBox label="Task 2" value="Interview (4\u9898)" />
        <InfoBox label="\u603B\u65F6\u957F" value="\u7EA6 8 \u5206\u949F" />
        <InfoBox label="\u8BC4\u5206" value="Band 1-6" />
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
        <strong style={{ color: ACCENT }}>{"\u8BC4\u5206\u89C4\u5219:"}</strong>{" "}
        {"\u590D\u8FF0\u90E8\u5206\u6839\u636E\u8BED\u97F3\u8BC6\u522B\u7CBE\u51C6\u5EA6\u8BC4\u5206 (40%)\uFF0C\u9762\u8BD5\u90E8\u5206\u7531 AI \u8BC4\u5206 (60%)\u3002\u7EFC\u5408\u5F97\u5206\u8F6C\u6362\u4E3A 1-6 Band\u3002"}
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
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <Btn
          onClick={onStart}
          style={{
            background: ACCENT,
            borderColor: ACCENT,
            padding: "12px 32px",
            fontSize: 15,
          }}
        >
          {"\u5F00\u59CB\u8003\u8BD5"}
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

function TransitionCard() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 1800;
    function tick() {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / duration);
      setProgress(p);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, []);

  return (
    <SurfaceCard style={{ padding: "48px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>{"\uD83C\uDFA4"}</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
        {"\u63A5\u4E0B\u6765\u662F\u6A21\u62DF\u9762\u8BD5\u73AF\u8282..."}
      </h3>
      <p style={{ fontSize: 14, color: C.t2, marginBottom: 20 }}>
        {"\u4F60\u5C06\u56DE\u7B54 4 \u9053\u9762\u8BD5\u95EE\u9898\uFF0C\u6BCF\u9898 45 \u79D2"}
      </p>

      {/* Progress bar */}
      <div
        style={{
          maxWidth: 300,
          margin: "0 auto",
          height: 6,
          background: "#e2e8f0",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: ACCENT,
            borderRadius: 3,
            transition: "width 50ms linear",
          }}
        />
      </div>
    </SurfaceCard>
  );
}

function ResultsCard({ score, elapsed, onRestart, onExit }) {
  const palette = BAND_COLORS[score.color] || BAND_COLORS.yellow;
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
            {score.band.toFixed(1)}
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
          CEFR: {score.cefr} {levelLabel && `\u00B7 ${levelLabel}`}
        </div>

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
                {"\u6743\u91CD: 40%"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>
                {score.repeatScore.toFixed(1)}/5
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
                {"\u6743\u91CD: 60%"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>
                {score.interviewScore.toFixed(1)}/5
              </div>
              {validIntvItems.length === 0 && (
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
                width: `${(score.band / 6) * 100}%`,
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
            {score.band.toFixed(1)} / 6.0
          </div>
        </div>
      </SurfaceCard>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <Btn onClick={onRestart} style={{ background: ACCENT, borderColor: ACCENT }}>
          {"\u91CD\u65B0\u8003\u8BD5"}
        </Btn>
        <Btn onClick={onExit} variant="secondary">
          {"\u8FD4\u56DE\u9996\u9875"}
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
        {"\u8BE5\u5206\u6570\u57FA\u4E8E\u6A21\u62DF\u8003\u8BD5\u7B97\u6CD5\u4F30\u7B97\uFF0C\u4E0D\u4EE3\u8868\u5B98\u65B9 ETS \u6210\u7EE9\u3002TOEFL \u4E3A ETS \u6CE8\u518C\u5546\u6807\u3002"}
      </div>
    </div>
  );
}
