"use client";
import React, { useMemo, useState } from "react";
import { C, SurfaceCard } from "../shared/ui";
import { ScoringReport } from "../writing/ScoringReport";
import { translateGrammarPoint } from "../../lib/utils";

const MOCK_TASK_IDS = {
  BUILD: "build-sentence",
  EMAIL: "email-writing",
  DISC: "academic-writing",
};

function getTypeLabel(type) {
  if (type === "bs") return "拼句练习";
  if (type === "email") return "邮件写作";
  if (type === "discussion") return "学术讨论";
  if (type === "mock") return "整套模考";
  return "未知类型";
}

function typeIcon(type) {
  if (type === "bs") return "🧩";
  if (type === "email") return "📧";
  if (type === "discussion") return "💬";
  if (type === "mock") return "🎯";
  return "•";
}

function getScoreLabel(session) {
  if (!session || typeof session !== "object") return "--";
  if (session.type === "bs") {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    if (total <= 0) return "--";
    return `${correct}/${total}`;
  }
  if (session.type === "mock") {
    if (Number.isFinite(session.band)) return `${session.band.toFixed(1)} / 6`;
    return `${session.score || 0}%`;
  }
  return Number.isFinite(session.score) ? `${session.score}/5` : "--";
}

function getScoreColor(session) {
  if (!session || typeof session !== "object") return C.t2;
  if (session.type === "bs") {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    if (total <= 0) return C.t2;
    return correct / total >= 0.8 ? C.green : C.orange;
  }
  if (session.type === "mock") {
    const band = session.band;
    if (Number.isFinite(band)) {
      if (band >= 5.5) return "#16a34a";
      if (band >= 4.5) return "#2563eb";
      if (band >= 3.5) return "#d97706";
      if (band >= 2.5) return "#ea580c";
      return "#dc2626";
    }
    const p = session.score || 0;
    if (p >= 80) return C.green;
    if (p >= 60) return C.orange;
    return C.red;
  }
  if (session.score >= 4) return C.green;
  if (session.score >= 3) return C.orange;
  return C.red;
}

function fmtDate(value) {
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value || "");
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(value || "");
  }
}

function buildRetryHref(session) {
  const s = session || {};
  if (s.type !== "email" && s.type !== "discussion") return "";
  const promptId = String(s?.details?.promptId || s?.details?.promptData?.id || "").trim();
  if (!promptId) return "";
  const path = s.type === "email" ? "/email-writing" : "/academic-writing";
  const qs = new URLSearchParams();
  qs.set("retryPromptId", promptId);
  const rootId = String(s?.details?.practiceRootId || "").trim();
  if (rootId) qs.set("practiceRootId", rootId);
  const attempt = Number(s?.details?.practiceAttempt || 1);
  if (Number.isFinite(attempt) && attempt > 0) qs.set("retryFromAttempt", String(Math.floor(attempt)));
  const mode = String(s?.mode || "").trim();
  if (mode && mode !== "standard") qs.set("mode", mode);
  const lang = String(s?.details?.feedback?.reportLanguage || "").trim();
  if (lang) qs.set("lang", lang);
  return `${path}?${qs.toString()}`;
}

function truncate(text, max = 40) {
  const s = String(text || "").trim();
  if (!s) return "（空）";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function renderWordDiff(userText, correctText) {
  if (!userText) return <span style={{ color: "#9ca3af", fontStyle: "italic" }}>（未作答）</span>;
  const normalize = (word) => String(word).toLowerCase().replace(/[.,!?;:'"]/g, "");
  const userWords = String(userText).trim().split(/\s+/);
  const correctWords = String(correctText || "").trim().split(/\s+/);
  return (
    <>
      {userWords.map((word, index) => {
        const isWrong = normalize(word) !== normalize(correctWords[index] || "");
        return (
          <React.Fragment key={index}>
            <span style={{ textDecoration: isWrong ? "underline" : "none", textDecorationColor: "#ef4444", textDecorationThickness: 2, color: isWrong ? "#ef4444" : "#111827", fontWeight: isWrong ? 600 : 400 }}>{word}</span>
            {index < userWords.length - 1 ? " " : ""}
          </React.Fragment>
        );
      })}
    </>
  );
}

function countWords(text) {
  const s = String(text || "").trim();
  if (!s) return 0;
  return s.split(/\s+/).length;
}

async function copyText(text) {
  const s = String(text || "");
  if (!s) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function Chip({ children, color = C.blue, bg = C.softBlue }) {
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, color, background: bg, whiteSpace: "nowrap" }}>{children}</span>;
}

function OutlineButton({ children, onClick, active = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "1px solid " + (active ? C.blue : C.bdr),
        background: active ? C.softBlue : "#fff",
        color: active ? C.blue : C.t2,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        padding: "5px 10px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MockExamDetails({ session }) {
  const [activeTab, setActiveTab] = useState(MOCK_TASK_IDS.BUILD);
  const [bsFilter, setBsFilter] = useState("all");
  const [bsQuery, setBsQuery] = useState("");
  const [expandedBsRows, setExpandedBsRows] = useState({});
  const [copyHint, setCopyHint] = useState("");

  const tasks = Array.isArray(session?.details?.tasks) ? session.details.tasks : [];
  const byId = useMemo(() => {
    const map = {};
    tasks.forEach((task) => {
      const taskId = task?.taskId;
      if (taskId) map[taskId] = task;
    });
    return map;
  }, [tasks]);

  const bsTask = byId[MOCK_TASK_IDS.BUILD] || null;
  const emailTask = byId[MOCK_TASK_IDS.EMAIL] || null;
  const discTask = byId[MOCK_TASK_IDS.DISC] || null;
  const bsDetails = Array.isArray(bsTask?.meta?.details) ? bsTask.meta.details : [];
  const bsCorrect = bsDetails.filter((detail) => detail?.isCorrect).length;

  const topGrammarTags = useMemo(() => {
    const freq = {};
    bsDetails.forEach((detail) => {
      const list = Array.isArray(detail?.grammar_points) ? detail.grammar_points : [];
      list.forEach((g) => {
        const tag = String(g || "").trim();
        if (!tag) return;
        freq[tag] = (freq[tag] || 0) + 1;
      });
    });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, n]) => ({ tag, n }));
  }, [bsDetails]);

  const filteredBs = useMemo(() => {
    const query = bsQuery.trim().toLowerCase();
    return bsDetails.filter((detail) => {
      const passFilter = bsFilter === "all" || (bsFilter === "correct" && detail?.isCorrect) || (bsFilter === "incorrect" && !detail?.isCorrect);
      if (!passFilter) return false;
      if (!query) return true;
      return [detail?.prompt, detail?.userAnswer, detail?.correctAnswer].map((x) => String(x || "").toLowerCase()).some((x) => x.includes(query));
    });
  }, [bsDetails, bsFilter, bsQuery]);

  function taskChip(taskId, shortLabel) {
    const task = byId[taskId];
    if (!task) return <Chip key={taskId}>{shortLabel}：--</Chip>;
    const score = Number.isFinite(task.score) ? task.score : "待定";
    return <Chip key={taskId}>{shortLabel}：{score}/{task.maxScore}</Chip>;
  }

  async function onCopy(label, text) {
    const ok = await copyText(text);
    setCopyHint(ok ? `${label}已复制` : "复制失败");
    setTimeout(() => setCopyHint(""), 1200);
  }

  function renderBs() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>答对 {bsCorrect}/{bsDetails.length}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {topGrammarTags.map((item) => <Chip key={item.tag}>{translateGrammarPoint(item.tag)} x{item.n}</Chip>)}
            {topGrammarTags.length === 0 ? <Chip color={C.t2} bg="#f3f4f6">暂无语法标签</Chip> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <OutlineButton active={bsFilter === "all"} onClick={() => setBsFilter("all")}>全部</OutlineButton>
          <OutlineButton active={bsFilter === "correct"} onClick={() => setBsFilter("correct")}>正确</OutlineButton>
          <OutlineButton active={bsFilter === "incorrect"} onClick={() => setBsFilter("incorrect")}>错误</OutlineButton>
          <input value={bsQuery} onChange={(e) => setBsQuery(e.target.value)} placeholder="搜索题目或答案" style={{ border: "1px solid " + C.bdr, borderRadius: 10, padding: "6px 9px", fontSize: 11, minWidth: 180, flex: "1 1 220px" }} />
        </div>

        <SurfaceCard style={{ overflow: "hidden", boxShadow: "none" }}>
          {filteredBs.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: C.t2 }}>当前筛选条件下暂无题目。</div>
          ) : filteredBs.map((detail, index) => {
            const rowKey = `${detail?.prompt || ""}-${index}`;
            const open = !!expandedBsRows[rowKey];
            const statusColor = detail?.isCorrect ? C.green : C.red;
            return (
              <div key={rowKey} style={{ borderBottom: index === filteredBs.length - 1 ? "none" : "1px solid #eef2f7" }}>
                <div style={{ display: "grid", gridTemplateColumns: "56px 88px 1fr 1fr auto", gap: 8, padding: "10px 12px", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: C.t2 }}>第 {index + 1} 题</div>
                  <Chip color={statusColor} bg={detail?.isCorrect ? "#dcfce7" : "#fee2e2"}>{detail?.isCorrect ? "答对" : "答错"}</Chip>
                  <div style={{ fontSize: 11.5, color: C.t1 }}>{truncate(detail?.userAnswer, 40)}</div>
                  <div style={{ fontSize: 11.5, color: C.t2 }}>{truncate(detail?.correctAnswer, 40)}</div>
                  <OutlineButton onClick={() => setExpandedBsRows((prev) => ({ ...prev, [rowKey]: !open }))}>{open ? "收起" : "展开"}</OutlineButton>
                </div>
                {open ? (
                  <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                      <SurfaceCard style={{ padding: 11, boxShadow: "none" }}>
                        <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>你的答案</div>
                        <div style={{ fontSize: 14, lineHeight: 1.7 }}>{renderWordDiff(detail?.userAnswer, detail?.correctAnswer)}</div>
                        <button onClick={() => onCopy("你的答案", detail?.userAnswer)} style={{ marginTop: 8, border: "1px solid " + C.bdr, background: "#fff", borderRadius: 8, fontSize: 10.5, padding: "4px 7px", cursor: "pointer", color: C.t2 }}>复制我的答案</button>
                      </SurfaceCard>
                      <SurfaceCard style={{ padding: 11, boxShadow: "none" }}>
                        <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>正确答案</div>
                        <div style={{ fontSize: 14, color: C.blue, lineHeight: 1.7 }}>{detail?.correctAnswer || "（空）"}</div>
                        <button onClick={() => onCopy("正确答案", detail?.correctAnswer)} style={{ marginTop: 8, border: "1px solid " + C.bdr, background: "#fff", borderRadius: 8, fontSize: 10.5, padding: "4px 7px", cursor: "pointer", color: C.t2 }}>复制正确答案</button>
                      </SurfaceCard>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(Array.isArray(detail?.grammar_points) ? detail.grammar_points : []).map((g, gi) => <Chip key={`${rowKey}-g-${gi}`}>{translateGrammarPoint(g)}</Chip>)}
                      {(!Array.isArray(detail?.grammar_points) || detail.grammar_points.length === 0) ? <Chip color={C.t2} bg="#f3f4f6">暂无语法标签</Chip> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </SurfaceCard>

        {copyHint ? <div style={{ fontSize: 11, color: C.green }}>{copyHint}</div> : null}
      </div>
    );
  }

  function renderWritingTask(task, taskTypeLabel) {
    if (!task) return <div style={{ fontSize: 12, color: C.t2 }}>暂无数据。</div>;
    const response = task?.meta?.response || null;
    const feedback = task?.meta?.feedback || null;
    const words = Number.isFinite(task?.meta?.wordCount) ? task.meta.wordCount : countWords(response?.userText || "");
    const reportType = task?.taskId === MOCK_TASK_IDS.EMAIL ? "email" : "discussion";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip>{taskTypeLabel}得分：{Number.isFinite(task.score) ? `${task.score}/${task.maxScore}` : "待定"}</Chip>
          <Chip color="#0f766e" bg="#ccfbf1">字数：{words || 0}</Chip>
          {Number.isFinite(task?.meta?.secondsUsed) ? <Chip color="#7c3aed" bg="#ede9fe">用时：{task.meta.secondsUsed} 秒</Chip> : null}
        </div>
        {response?.userText ? (
          <SurfaceCard style={{ padding: 11, boxShadow: "none" }}>
            <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>你的作答</div>
            <div style={{ fontSize: 12.5, color: C.t1, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{response.userText}</div>
          </SurfaceCard>
        ) : null}
        {feedback && typeof feedback === "object" ? (
          <ScoringReport result={feedback} type={reportType} uiLang={feedback?.reportLanguage || "zh"} />
        ) : (
          <div style={{ fontSize: 12, color: task?.meta?.error ? C.red : C.t2 }}>{task?.meta?.error ? `评分失败：${task.meta.error}` : "暂无 AI 反馈。"}</div>
        )}
      </div>
    );
  }

  const mockTabs = [
    { id: MOCK_TASK_IDS.BUILD, label: "拼句" },
    { id: MOCK_TASK_IDS.EMAIL, label: "邮件写作" },
    { id: MOCK_TASK_IDS.DISC, label: "学术讨论" },
  ];

  return (
    <SurfaceCard style={{ background: "#f9fafb", padding: 11, marginTop: 8, boxShadow: "none" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Chip>段位：{Number.isFinite(session?.band) ? session.band.toFixed(1) : "--"}</Chip>
        <Chip>换算分：{session?.scaledScore ?? "--"}/30</Chip>
        <Chip>CEFR：{session?.cefr || "--"}</Chip>
        {taskChip(MOCK_TASK_IDS.BUILD, "拼句")}
        {taskChip(MOCK_TASK_IDS.EMAIL, "邮件")}
        {taskChip(MOCK_TASK_IDS.DISC, "讨论")}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {mockTabs.map((tab) => <OutlineButton key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</OutlineButton>)}
      </div>
      {activeTab === MOCK_TASK_IDS.BUILD ? renderBs() : null}
      {activeTab === MOCK_TASK_IDS.EMAIL ? renderWritingTask(emailTask, "邮件写作") : null}
      {activeTab === MOCK_TASK_IDS.DISC ? renderWritingTask(discTask, "学术讨论") : null}
    </SurfaceCard>
  );
}

export function HistoryRow({ entry, isExpanded, isLast, onToggle, onDelete, showIcon, compact = false, typeAvgs, detailOnly = false }) {
  const session = entry?.session || {};
  const sourceIndex = entry?.sourceIndex;

  let sessionNorm = null;
  if (session.type === "bs") {
    const total = Number(session.total || 0);
    const correct = Number(session.correct || 0);
    if (total > 0) sessionNorm = (correct / total) * 100;
  } else if (session.type === "email" || session.type === "discussion") {
    if (Number.isFinite(session.score)) sessionNorm = session.score;
  }
  const typeAvg = typeAvgs?.[session.type] ?? null;
  const showTrend = sessionNorm !== null && typeAvg !== null;
  const isAboveAvg = showTrend && sessionNorm > typeAvg;
  const [expandedBsItems, setExpandedBsItems] = useState({});
  const practiceAttempt = Number(session?.details?.practiceAttempt || 1);
  const retryHref = buildRetryHref(session);

  const mockTasks = Array.isArray(session?.details?.tasks) ? session.details.tasks : [];
  const mockBuild = mockTasks.find((task) => task?.taskId === MOCK_TASK_IDS.BUILD);
  const mockEmail = mockTasks.find((task) => task?.taskId === MOCK_TASK_IDS.EMAIL);
  const mockDisc = mockTasks.find((task) => task?.taskId === MOCK_TASK_IDS.DISC);

  const mockChip = (label, task) => <Chip key={label}>{label} {Number.isFinite(task?.score) ? `${task.score}/${task.maxScore}` : `待定/${task?.maxScore || "--"}`}</Chip>;

  return (
    <div>
      {!detailOnly ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: compact ? "8px 0" : "10px 0", borderBottom: isLast ? "none" : "1px solid #eef2f7", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => onToggle?.()} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 11, color: C.t2, userSelect: "none", flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{showIcon ? `${typeIcon(session.type)} ` : ""}{getTypeLabel(session.type)}</span>
            {(session.type === "email" || session.type === "discussion") && practiceAttempt > 1 ? <Chip color="#0f766e" bg="#ccfbf1">第 {practiceAttempt} 次练习</Chip> : null}
            {session.type === "mock" && Number.isFinite(session?.band) ? <Chip>段位 {session.band.toFixed(1)}</Chip> : null}
            <span style={{ fontSize: 11, color: C.t2, whiteSpace: "nowrap" }}>{fmtDate(session.date)}</span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {session.type === "mock" ? (
              <>
                <Chip color="#0f766e" bg="#ccfbf1">换算分 {session.scaledScore ?? "--"}/30</Chip>
                <Chip color="#4b5563" bg="#f3f4f6">CEFR {session.cefr || "--"}</Chip>
                {mockChip("拼句", mockBuild)}
                {mockChip("邮件", mockEmail)}
                {mockChip("讨论", mockDisc)}
              </>
            ) : null}
            <span style={{ fontSize: 13, fontWeight: 700, color: getScoreColor(session), whiteSpace: "nowrap" }}>
              {getScoreLabel(session)}
              {showTrend ? <span style={{ fontSize: 11, marginLeft: 3, color: isAboveAvg ? "#16a34a" : "#9ca3af" }}>{isAboveAvg ? "↑" : "↓"}</span> : null}
            </span>
            <OutlineButton onClick={() => onToggle?.()}>{isExpanded ? "收起详情" : "查看详情"}</OutlineButton>
            <button onClick={() => onDelete?.(sourceIndex)} title="删除记录" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 15, padding: "2px 6px", lineHeight: 1, fontWeight: 700, opacity: 0.75 }}>×</button>
          </div>
        </div>
      ) : null}

      {isExpanded && session.type === "bs" && session.details && Array.isArray(session.details) ? (
        <SurfaceCard style={{ background: "#f9fafb", padding: 14, margin: "6px 0 8px", boxShadow: "none" }}>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>答对 {session.correct}/{session.total}</div>
          {session.details.map((detail, index) => {
            const itemOpen = !!expandedBsItems[index];
            const statusColor = detail.isCorrect ? C.green : C.red;
            return (
              <div key={index} style={{ borderBottom: index < session.details.length - 1 ? "1px solid #e5e7eb" : "none" }}>
                <button onClick={() => setExpandedBsItems((prev) => ({ ...prev, [index]: !prev[index] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer", width: "100%", border: "none", background: "transparent", textAlign: "left" }}>
                  <span style={{ color: statusColor, fontWeight: 700, fontSize: 15, flexShrink: 0, width: 18, textAlign: "center" }}>{detail.isCorrect ? "✓" : "!"}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.t1, flexShrink: 0 }}>第 {index + 1} 题</span>
                  <span style={{ fontSize: 12, color: C.t2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.prompt}</span>
                  <span style={{ fontSize: 12, color: C.t2, flexShrink: 0 }}>{itemOpen ? "收起" : "展开"}</span>
                </button>
                {itemOpen ? (
                  <div style={{ paddingLeft: 28, paddingBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>你的答案</div>
                      <div style={{ fontSize: 14, lineHeight: 1.7 }}>{renderWordDiff(detail.userAnswer, detail.correctAnswer)}</div>
                    </div>
                    {!detail.isCorrect ? (
                      <div>
                        <div style={{ fontSize: 11, color: C.t2, marginBottom: 4 }}>正确答案</div>
                        <div style={{ fontSize: 14, color: C.blue, lineHeight: 1.7 }}>{detail.correctAnswer}</div>
                      </div>
                    ) : null}
                    {Array.isArray(detail.grammar_points) && detail.grammar_points.length > 0 ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {detail.grammar_points.map((g, gi) => <Chip key={gi}>{translateGrammarPoint(g)}</Chip>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </SurfaceCard>
      ) : null}

      {isExpanded && session.type === "mock" && session.details ? <MockExamDetails session={session} /> : null}

      {isExpanded && session.details && (session.type === "email" || session.type === "discussion") && session.details.userText ? (
        <SurfaceCard style={{ background: "#f9fafb", padding: 14, margin: "6px 0 8px", boxShadow: "none" }}>
          {session.details.promptSummary ? <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>题目摘要：{session.details.promptSummary}</div> : null}
          {retryHref ? (
            <div style={{ marginBottom: 10 }}>
              <OutlineButton onClick={() => { window.location.href = retryHref; }}>再练一遍（同题）</OutlineButton>
            </div>
          ) : null}
          <SurfaceCard style={{ padding: 11, marginBottom: 10, boxShadow: "none" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.t2, marginBottom: 6 }}>你的作答</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{session.details.userText}</div>
          </SurfaceCard>
          {session.details.feedback ? <ScoringReport result={session.details.feedback} type={session.type} uiLang={session.details.feedback?.reportLanguage || "zh"} /> : null}
        </SurfaceCard>
      ) : null}

      {isExpanded && !session.details ? (
        <SurfaceCard style={{ background: "#f9fafb", padding: 14, margin: "6px 0 8px", fontSize: 12, color: C.t2, textAlign: "center", boxShadow: "none" }}>
          这条记录缺少详情数据，通常是较早生成的历史记录。
        </SurfaceCard>
      ) : null}
    </div>
  );
}
