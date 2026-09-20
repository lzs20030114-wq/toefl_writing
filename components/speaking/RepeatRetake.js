"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT } from "../shared/ui";
import { VoiceRecorder } from "./VoiceRecorder";
import { SpeechConsentModal } from "./SpeechConsentModal";
import { WordHighlight } from "./WordHighlight";
import { transcribeWithServer } from "../../lib/speakingEval/serverStt";
import { scoreRepeat } from "../../lib/speakingEval/repeatScorer";

const SPK = { color: "#F59E0B", soft: "#FFFBEB" };

const accuracyColor = (acc) => (acc >= 80 ? "#16A34A" : acc >= 60 ? "#D97706" : "#DC2626");
const accuracyBg = (acc) => (acc >= 80 ? "#DCFCE7" : acc >= 60 ? "#FFFBEB" : "#FEE2E2");
const accuracyBorder = (acc) => (acc >= 80 ? "#BBF7D0" : acc >= 60 ? "#FDE68A" : "#FECACA");

// pill 样式与 RepeatTask 的 ReplayButton 对齐（这里不 import 它：RepeatTask 会 import
// 本文件，反向再 import 就成了循环依赖）。
const PILL = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "5px 12px", borderRadius: 999,
  background: "#F3F4F6", border: `1px solid ${C.bdr}`,
  cursor: "pointer", fontSize: 12, fontWeight: 600,
  color: C.t2, fontFamily: FONT,
};

/** 一条重录的回放按钮（样式同 ReplayButton，隐藏 audio + 播放/暂停切换）。 */
function RetakeReplay({ blobUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      const pr = audioRef.current.play();
      if (pr && typeof pr.catch === "function") pr.catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <>
      {blobUrl && (
        <audio ref={audioRef} src={blobUrl} onEnded={() => setPlaying(false)} style={{ display: "none" }} />
      )}
      <button
        type="button"
        onClick={toggle}
        style={{
          ...PILL,
          background: playing ? SPK.soft : "#F3F4F6",
          border: `1px solid ${playing ? "#FDE68A" : C.bdr}`,
          color: playing ? "#92400E" : C.t2,
        }}
      >
        {playing ? "⏸" : "▶"} 回放
      </button>
    </>
  );
}

/** 失败码 → 用户可读的中文提示（录音本身一定保留，文案里明说）。 */
function failureText(error) {
  if (error === "NOT_PRO") return "🔒 语音识别为 Pro 专属，录音已保留可自行对照";
  if (error === "NEEDS_CONSENT") return "未授权语音识别，录音已保留";
  if (error === "EMPTY_AUDIO") return "录音为空，请重试";
  if (error === "AUTH_REQUIRED") return "需要登录后才能识别";
  return `识别失败：${error || "未知错误"}`;
}

/**
 * 「重录这句」——挂在复盘/历史页每句下面的自包含小组件。
 *
 * 设计红线：**绝不回写宿主的任何数据**。原始每句成绩、总分、写进 sessionStore 的
 * 历史记录都不动；重录只在本组件内部追加一条 attempt，仅当前页面可见。
 * 所以它不接受任何 setter/onScore 回调，只有一个 onRecordingStateChange 出口——
 * 让宿主在录音期间锁掉自己的回放按钮（原句漏进麦克风会污染 STT）。
 *
 * Props:
 *   sentenceText            — 原句，用于评分与逐词高亮；为空则只录音不评分
 *   questionId              — 透传给 STT 端点做埋点
 *   originalAccuracy        — 最初那次的准确率，非 null 时每条重录显示「较原始 +N」
 *   onRecordingStateChange  — 原样转发 VoiceRecorder 的录音态
 */
export function RepeatRetake({
  sentenceText,
  questionId = "",
  originalAccuracy = null,
  onRecordingStateChange = null,
}) {
  // 只追加不覆盖：第 n 条即「重录 #n」。
  const [attempts, setAttempts] = useState([]);
  const [open, setOpen] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  // sticky：服务端说过一次 NOT_PRO 就不再上传（同 RepeatTask 的语义）。
  const [notPro, setNotPro] = useState(false);

  const mountedRef = useRef(true);
  // NEEDS_CONSENT 时暂存 { attemptId, blob, durationMs }，授权后原样重跑。
  const pendingConsentRef = useRef(null);
  const attemptSeqRef = useRef(0);
  // 卸载时要 revoke 的 blobUrl 快照（不能依赖 state，清理函数里读不到最新值）。
  const attemptsRef = useRef([]);
  // notPro 的同步副本：handleRecordingComplete 要在同一次事件里读到它。
  const notProRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { attemptsRef.current = attempts; }, [attempts]);

  // 卸载时释放所有录音的 object URL（jsdom / 老浏览器里 URL.revokeObjectURL 可能缺席）。
  useEffect(() => () => {
    if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
    for (const a of attemptsRef.current) {
      if (a && a.blobUrl) { try { URL.revokeObjectURL(a.blobUrl); } catch {} }
    }
  }, []);

  const patchAttempt = useCallback((id, patch) => {
    setAttempts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  // 上传一条录音并把结果回填到对应 attempt。授权重试路径也走这里。
  const runJob = useCallback(({ attemptId, blob, durationMs }) => {
    patchAttempt(attemptId, { status: "processing", error: null });
    (async () => {
      const result = await transcribeWithServer(blob, {
        taskType: "repeat",
        questionId,
        durationMs,
      });
      if (!mountedRef.current) return;

      if (result.ok) {
        const transcript = result.transcript || "";
        const score = transcript && sentenceText ? scoreRepeat(sentenceText, transcript) : null;
        patchAttempt(attemptId, { status: "done", transcript, score, error: null });
        return;
      }

      if (result.code === "NOT_PRO") { notProRef.current = true; setNotPro(true); }
      if (result.code === "NEEDS_CONSENT") {
        pendingConsentRef.current = { attemptId, blob, durationMs };
        setNeedsConsent(true);
      }
      patchAttempt(attemptId, { status: "failed", error: result.code || "ERROR" });
    })();
  }, [patchAttempt, questionId, sentenceText]);

  const handleRecordingComplete = useCallback((blobUrl, blob, durationMs) => {
    // 先收起面板 = 卸载 VoiceRecorder，免得它自己的 playback 态（含会 revoke 的 🔄）露出来。
    setOpen(false);
    attemptSeqRef.current += 1;
    const id = `retake-${attemptSeqRef.current}`;
    const blocked = notPro || notProRef.current || !blob;
    setAttempts((prev) => [...prev, {
      id,
      blobUrl,
      transcript: "",
      score: null,
      status: blocked ? "failed" : "processing",
      error: blocked ? ((notPro || notProRef.current) ? "NOT_PRO" : "EMPTY_AUDIO") : null,
    }]);
    if (blocked) return;
    runJob({ attemptId: id, blob, durationMs });
  }, [notPro, runJob]);

  const handleConsentGranted = useCallback(() => {
    const job = pendingConsentRef.current;
    pendingConsentRef.current = null;
    setNeedsConsent(false);
    if (job) runJob(job);
  }, [runJob]);

  const handleConsentClosed = useCallback(() => {
    pendingConsentRef.current = null;
    setNeedsConsent(false);
  }, []);

  return (
    <div data-testid="repeat-retake" style={{ fontFamily: FONT }}>
      {open ? (
        <div style={{
          background: "#F9FAFB", border: `1px solid ${C.bdr}`, borderRadius: 10,
          padding: "12px 16px", marginTop: 10, textAlign: "center",
        }}>
          <div style={{ fontSize: 12, color: C.t3, marginBottom: 10 }}>
            先听原句再录音，重录结果不会覆盖原始成绩
          </div>
          <VoiceRecorder
            onRecordingComplete={handleRecordingComplete}
            onRecordingStateChange={onRecordingStateChange}
            maxDuration={30}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              marginTop: 10, background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: C.t3, textDecoration: "underline", fontFamily: FONT,
            }}
          >
            取消
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={PILL}>
          🎙 重录这句
        </button>
      )}

      {attempts.map((a, i) => {
        const acc = a.status === "done" && a.score ? a.score.accuracy : null;
        const delta = acc != null && originalAccuracy != null ? acc - originalAccuracy : null;
        return (
          <div
            key={a.id}
            data-testid="repeat-retake-attempt"
            style={{
              marginTop: 8, padding: "10px 12px", borderRadius: 10,
              background: acc != null ? accuracyBg(acc) : "#F9FAFB",
              border: `1px solid ${acc != null ? accuracyBorder(acc) : C.bdr}`,
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>重录 #{i + 1}</span>

              {a.status === "processing" && (
                <span style={{ fontSize: 12, color: C.t2 }}>⏳ 正在识别…</span>
              )}

              {acc != null && (
                <>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: accuracyBg(acc), color: accuracyColor(acc),
                  }}>
                    {acc}%
                  </span>
                  {delta != null && (
                    <span style={{ fontSize: 11, color: C.t3 }}>
                      较原始{" "}
                      <span style={{
                        fontWeight: 700,
                        color: delta > 0 ? "#16A34A" : delta < 0 ? "#DC2626" : C.t3,
                      }}>
                        {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0"}
                      </span>
                    </span>
                  )}
                </>
              )}

              {/* 录音本身与识别结果无关：没识别出来 / 识别失败的重录也要能回放 */}
              {a.blobUrl && a.status !== "processing" && <RetakeReplay blobUrl={a.blobUrl} />}
            </div>

            {a.status === "done" && a.score && (
              <div style={{ marginTop: 6 }}>
                <WordHighlight
                  originalSentence={sentenceText}
                  matchedWords={a.score.matchedWords}
                  missedWords={a.score.missedWords}
                  fontSize={13}
                />
                {a.score.extraWords && a.score.extraWords.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: C.t3 }}>
                    多余词: {a.score.extraWords.map((w, j) => (
                      <span key={j} style={{
                        display: "inline-block", margin: "1px 3px", padding: "1px 5px",
                        background: "#F3F4F6", borderRadius: 4,
                      }}>{w}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {a.status === "done" && !a.score && (
              <div style={{ marginTop: 6, fontSize: 12, color: C.t3 }}>
                没有识别到英文内容，录音已保留
              </div>
            )}

            {a.status === "failed" && (
              <div style={{ marginTop: 6, fontSize: 12, color: C.t2, lineHeight: 1.6 }}>
                {failureText(a.error)}
              </div>
            )}
          </div>
        );
      })}

      <SpeechConsentModal
        open={needsConsent}
        onClose={handleConsentClosed}
        onGranted={handleConsentGranted}
      />
    </div>
  );
}
