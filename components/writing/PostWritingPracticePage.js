"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, C, FONT, InfoStrip, PageShell, SurfaceCard } from "../shared/ui";
import { SESSION_STORE_EVENTS, loadHist } from "../../lib/sessionStore";
import { extractPostWritingPracticeItems, groupPostWritingPracticeItems } from "../../lib/postWritingPractice";

function sourceLabel(type) {
  return type === "email" ? "Task 2" : "Task 3";
}

function bucketTitle(bucket) {
  return bucket === "today" ? "今日写后练习" : "错题本";
}

export function PostWritingPracticePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [tab, setTab] = useState("today");
  const [indexes, setIndexes] = useState({ today: 0, notebook: 0 });
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const refresh = () => setSessions(loadHist().sessions || []);
    refresh();
    window.addEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SESSION_STORE_EVENTS.HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const grouped = useMemo(() => {
    const items = extractPostWritingPracticeItems(sessions);
    return groupPostWritingPracticeItems(items);
  }, [sessions]);

  const activeItems = grouped[tab] || [];
  const activeIndex = Math.min(indexes[tab] || 0, Math.max(0, activeItems.length - 1));
  const current = activeItems[activeIndex] || null;

  useEffect(() => {
    setAnswer("");
    setChecked(false);
    setResult(null);
    setRevealed(false);
  }, [tab, activeIndex, current?.id]);

  function switchTab(nextTab) {
    setTab(nextTab);
  }

  function moveNext() {
    setIndexes((prev) => ({
      ...prev,
      [tab]: Math.min((prev[tab] || 0) + 1, Math.max(0, activeItems.length - 1)),
    }));
  }

  function movePrev() {
    setIndexes((prev) => ({
      ...prev,
      [tab]: Math.max((prev[tab] || 0) - 1, 0),
    }));
  }

  function checkAnswer() {
    if (!current) return;
    const normalized = String(answer || "").trim().toLowerCase();
    const expected = String(current.correctText || "").trim().toLowerCase();
    if (!normalized) return;
    const ok = normalized === expected;
    setChecked(true);
    setResult(ok ? "correct" : "wrong");
    if (ok) setRevealed(true);
  }

  function revealAnswer() {
    setChecked(true);
    setResult("revealed");
    setRevealed(true);
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid " + C.bdrSubtle }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>写后拼写练习</div>
        <Btn variant="secondary" onClick={() => router.push("/")}>返回首页</Btn>
      </div>

      <PageShell narrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <InfoStrip>
            基于你在 Task 2 和 Task 3 的历史练习反馈，自动提取被明确标注为“拼写错误”的词，转成填空练习。
            今日生成的练习显示在“今日写后练习”，往日练习自动归入“错题本”。
          </InfoStrip>

          <div style={{ display: "flex", gap: 8 }}>
            {[
              { key: "today", label: `今日写后练习 (${grouped.today.length})` },
              { key: "notebook", label: `错题本 (${grouped.notebook.length})` },
            ].map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => switchTab(item.key)}
                  style={{
                    border: "1px solid " + (active ? C.blue : C.bdr),
                    background: active ? C.ltB : "#fff",
                    color: active ? C.blue : C.t2,
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {activeItems.length === 0 ? (
            <SurfaceCard style={{ padding: 28 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.t1, marginBottom: 8 }}>{bucketTitle(tab)}</div>
              <div style={{ fontSize: 14, color: C.t2 }}>
                {tab === "today"
                  ? "今天还没有可用于拼写练习的 Task 2/3 错误。先去完成写作练习。"
                  : "错题本暂时是空的。"}
              </div>
            </SurfaceCard>
          ) : (
            <>
              <SurfaceCard style={{ padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 6 }}>
                      {bucketTitle(tab)} {activeIndex + 1}/{activeItems.length}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.t1 }}>
                      {sourceLabel(current?.sourceType)} · {current?.dayKey || ""}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: C.t2 }}>
                    原错词：<b style={{ color: C.red }}>{current?.wrongText || "-"}</b>
                  </div>
                </div>

                <div style={{ fontSize: 16, color: C.t1, lineHeight: 1.8, background: "#fff", border: "1px solid " + C.bdrSubtle, borderRadius: 12, padding: "18px 16px", marginBottom: 16 }}>
                  {current?.promptSentence || ""}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value.replace(/[^A-Za-z'-]/g, ""))}
                    placeholder="输入正确拼写"
                    style={{
                      flex: "1 1 260px",
                      minWidth: 220,
                      border: "1px solid " + C.bdr,
                      borderRadius: 10,
                      padding: "12px 14px",
                      fontSize: 14,
                      fontFamily: FONT,
                      outline: "none",
                      background: "#fff",
                    }}
                  />
                  <Btn onClick={checkAnswer} disabled={!answer.trim()}>检查答案</Btn>
                  <Btn variant="secondary" onClick={revealAnswer}>显示答案</Btn>
                </div>

                {checked ? (
                  <div style={{ marginBottom: 12, fontSize: 13, color: result === "correct" ? C.green : result === "wrong" ? C.red : C.t2 }}>
                    {result === "correct"
                      ? "回答正确。"
                      : result === "wrong"
                        ? `回答不对，正确拼写是：${current?.correctText || ""}`
                        : `正确拼写是：${current?.correctText || ""}`}
                  </div>
                ) : null}

                {revealed && current?.note ? (
                  <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.7, background: C.ltB, border: "1px solid #d1fae5", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
                    批注说明：{current.note}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 10 }}>
                  <Btn variant="secondary" onClick={movePrev} disabled={activeIndex <= 0}>上一题</Btn>
                  <Btn onClick={moveNext} disabled={activeIndex >= activeItems.length - 1}>下一题</Btn>
                </div>
              </SurfaceCard>

              <SurfaceCard style={{ padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.t1, marginBottom: 10 }}>当前句子原文</div>
                <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.8 }}>{current?.sentence || ""}</div>
              </SurfaceCard>
            </>
          )}
        </div>
      </PageShell>
    </div>
  );
}
