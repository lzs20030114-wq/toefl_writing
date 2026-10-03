"use client";
// 「真题练习记录」页（/real-bank/progress）。设计稿：「真题练习记录 优化版」。
//
//   概览（RealOverview）：整合摘要卡（整体得分率 / 趋势 / 最近一次）→ 科目条 → 可折叠的题库覆盖 →
//                         按日分组的练习明细，点一行就地展开「错题速览」。
//   详情（RealDetail）：  左「练习明细」可收起列表 + 右逐题回顾（编号导航 / 吸顶筛选条 / 上一条下一条）。
//
// 回顾正文按题型分发（components/realBank/review/*）；查词典、AI 讲解、逐句点播、口语再练一次、
// 写作批改报告（WritingFeedbackPanel）都复用各科历史页同一套，不会少字段、不会少解析。
//
// 记录辨认 / 得分口径在 lib/realBankHistory.js（纯函数，与后台真题统计同一判定）；逐题模型在
// lib/realBankReview.js；来源分档 / 考试日期 / 卷次回题库查，见 realBankMeta.js
// （这是真题专区自己的路由，与 app/real-bank/page.js 同一份 bundle 代价；首页入口卡不走这里）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FONT, TopBar } from "../shared/ui";
import { loadHist, deleteSession } from "../../lib/sessionStore";
import { subscribeHistory } from "../../lib/history/subscribeHistory";
import { buildRealBankEntries, REAL_ENTRY_SUBTYPE_ORDER, REAL_SUBTYPE_META } from "../../lib/realBankHistory";
import { buildReviewModel } from "../../lib/realBankReview";
import { applyRescore, canRescoreSession, rescoreWritingEntry } from "../../lib/realBankRescore";
// 题库重建会给阅读条目改名 / 归位（放错进学术阅读的日常材料挪回 RDL、跨卷同篇合并）：
// 覆盖率 / 最新一次 / 分类筛选都按解析后的「当前 id + 当前题型」算，旧记录照样对得上账。
import { resolveRealReadingRef } from "../../lib/realBankAliases";
import { ACCENT, buildCoverage, getRealItemIndex } from "./realBankMeta";
import { RealOverview } from "./RealOverview";
import { RealDetail } from "./RealDetail";

const shortOf = (t) => REAL_SUBTYPE_META[t]?.short || t;

function useWide(min = 1100) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [min]);
  return wide;
}

export function RealBankProgressView({ onBack }) {
  const [hist, setHist] = useState(null);
  const [subject, setSubject] = useState("all");
  const [type, setType] = useState("all");
  const [groupsClosed, setGroupsClosed] = useState({});
  const [covOpen, setCovOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);
  const [focus, setFocus] = useState(null);
  const [railMin, setRailMin] = useState(false);
  const [rescoring, setRescoring] = useState({});
  const [rescoreError, setRescoreError] = useState({});
  // 重试评分拿到了反馈、但回写记录没成功（或还没刷回来）时，本页内先按它展示，不让用户白等一场。
  const [rescored, setRescored] = useState({});
  const [toast, setToast] = useState(null);
  const wide = useWide();
  const alive = useRef(true);
  const toastTimer = useRef(null);

  useEffect(() => subscribeHistory(setHist), []);
  useEffect(() => () => { alive.current = false; clearTimeout(toastTimer.current); }, []);

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => { if (alive.current) setToast(null); }, 2400);
  }, []);

  const index = useMemo(() => getRealItemIndex(), []);
  const entries = useMemo(() => {
    const list = buildRealBankEntries(hist?.sessions, { resolveItemRef: resolveRealReadingRef });
    return list.map((e) => {
      const fb = rescored[e.sourceIndex];
      return fb && canRescoreSession(e.session) ? { ...e, session: applyRescore(e.session, fb) } : e;
    });
  }, [hist, rescored]);
  const coverage = useMemo(() => buildCoverage(entries), [entries]);
  const models = useMemo(() => new Map(entries.map((e) => [e.sourceIndex, buildReviewModel(e.session, e.subtype, { shortOf })])), [entries]);

  const activeEntry = entries.find((e) => e.sourceIndex === activeIdx) || null;

  // 详情里「上一条 / 下一条 / 左栏列表」跟着概览当前的筛选走；当前条不在筛选里就退回全部。
  const navList = useMemo(() => {
    const bySubject = subject === "all" ? entries : entries.filter((e) => REAL_SUBTYPE_META[e.subtype].subject === subject);
    const list = type === "all" ? bySubject : bySubject.filter((e) => e.subtype === type);
    return activeEntry && list.some((e) => e.sourceIndex === activeEntry.sourceIndex) ? list : entries;
  }, [entries, subject, type, activeEntry]);

  const openEntry = useCallback((entry, focusIdx = null) => {
    setActiveIdx(entry.sourceIndex);
    setFocus(focusIdx);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, []);

  function pickSubject(next) {
    setSubject(next);
    setType("all");
    setActiveIdx(null);
  }

  function handleDelete(entry) {
    deleteSession(entry.sourceIndex);
    setHist(loadHist());
    if (activeIdx === entry.sourceIndex) setActiveIdx(null);
    showToast("已删除 1 条真题记录");
  }

  function clearAll() {
    // 逐条删（只删真题记录，不动常规练习 / 模考历史）。本地存储按数组下标删，必须从后往前，
    // 否则删掉前一条后面的下标会整体前移、删错记录；云端按行 id 删，顺序无所谓。
    [...entries].sort((a, b) => b.sourceIndex - a.sourceIndex).forEach((e) => deleteSession(e.sourceIndex));
    setHist(loadHist());
    setActiveIdx(null);
  }

  async function rescore(entry) {
    const k = entry.sourceIndex;
    if (rescoring[k] === "loading") return;
    setRescoring((r) => ({ ...r, [k]: "loading" }));
    setRescoreError((r) => ({ ...r, [k]: "" }));
    try {
      const out = await rescoreWritingEntry(entry);
      if (!alive.current) return;
      setRescored((r) => ({ ...r, [k]: out.feedback }));
      showToast(`重新评分完成：${out.feedback.score}/5${out.saved ? "" : "（本次未能保存到记录）"}`);
    } catch (e) {
      if (alive.current) setRescoreError((r) => ({ ...r, [k]: e?.message || "评分失败，请重试" }));
    } finally {
      if (alive.current) setRescoring((r) => ({ ...r, [k]: undefined }));
    }
  }

  const chrome = (children) => (
    <div className="rb-root" style={{ minHeight: "100vh", background: "#F4F7F5", fontFamily: FONT, color: "#1a2420" }}>
      <style>{`
        .rb-root button, .rb-root input { font-family: inherit; }
        @keyframes rbFadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes rbSlideIn { from { opacity:0; transform:translateX(14px); } to { opacity:1; transform:none; } }
        @keyframes rbIndeterminate { 0% { left:-40%; } 100% { left:100%; } }
      `}</style>
      <TopBar title="真题练习记录" section="Real Questions" onExit={onBack} />
      {children}
    </div>
  );

  if (!hist) {
    return chrome(<div style={{ textAlign: "center", padding: "60px 0", color: "#94a39a", fontSize: 13 }}>加载中...</div>);
  }

  return chrome(
    <>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "22px 24px 80px" }}>
        {entries.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #dde5df", borderRadius: 14, padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, animation: "rbFadeUp .35s ease both" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: ACCENT.soft, display: "grid", placeItems: "center", fontSize: 22 }}>📜</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>还没有真题练习记录</div>
            <div style={{ fontSize: 12.5, color: "#5a6b62", maxWidth: 380, lineHeight: 1.6 }}>在真题专区完成任意一道题后，记录会自动保存在这里（含逐题回顾）。</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <Link href="/?section=real-bank" style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: ACCENT.color, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>去真题专区</Link>
            </div>
          </div>
        ) : activeEntry ? (
          <RealDetail
            entry={activeEntry} navList={navList} models={models} index={index} wide={wide}
            railMin={railMin} onToggleRail={() => setRailMin((v) => !v)}
            initialFocus={focus} onOpenEntry={(e) => openEntry(e)} onBack={() => setActiveIdx(null)} onDelete={handleDelete}
            rescoring={rescoring} rescoreError={rescoreError} canRescoreEntry={(e) => canRescoreSession(e.session)} onRescore={rescore}
          />
        ) : (
          <RealOverview
            entries={entries} index={index} models={models} coverage={coverage}
            subject={subject} type={type} onSubject={pickSubject} onType={setType}
            groupsClosed={groupsClosed} onToggleGroup={(label) => setGroupsClosed((g) => ({ ...g, [label]: !g[label] }))}
            covOpen={covOpen} onToggleCov={() => setCovOpen((v) => !v)}
            onOpen={openEntry} onDelete={handleDelete} onClearAll={clearAll}
            onRescore={rescore} rescoring={rescoring} canRescoreEntry={(e) => canRescoreSession(e.session)}
            subtypeOrder={REAL_ENTRY_SUBTYPE_ORDER}
          />
        )}
      </div>
      {toast ? (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 150, background: "#1a2420", color: "#fff", padding: "9px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}>{toast}</div>
      ) : null}
    </>,
  );
}

