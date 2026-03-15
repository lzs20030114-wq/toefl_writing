"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";
const POLL_INTERVAL = 5000;

function authHeaders(token) {
  return { "Content-Type": "application/json", "x-admin-token": token };
}

function timeAgo(iso) {
  if (!iso) return "-";
  const sec = Math.round((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function elapsed(startIso, endIso) {
  if (!startIso) return "-";
  const ms = (endIso ? new Date(endIso) : new Date()) - new Date(startIso);
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function pct(n) {
  if (n == null) return "-";
  return `${Math.round(n * 100)}%`;
}

function StatusBadge({ status, conclusion }) {
  const map = {
    queued:      ["#fef3c7", "#92400e", "排队中"],
    in_progress: ["#dbeafe", "#1e40af", "生成中…"],
    completed:   conclusion === "success" ? ["#dcfce7", "#166534", "✓ 完成"] : ["#fee2e2", "#991b1b", "失败"],
  };
  const [bg, color, label] = map[status] || ["#f3f4f6", "#374151", status];
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 12, background: bg, color, fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function StatBox({ label, value }) {
  return (
    <div style={{ background: C.bg, border: "1px solid " + C.bdr, borderRadius: 6, padding: "8px 12px", minWidth: 90 }}>
      <div style={{ fontSize: 11, color: C.t2, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.nav }}>{value ?? "-"}</div>
    </div>
  );
}

function CompareTable({ rows }) {
  // rows: [{label, actual, tpo, format, warn}]
  // warn: (actual, tpo) => bool — true = amber highlight
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", color: C.t3, fontWeight: 600, paddingBottom: 4, width: "40%" }}>指标</th>
          <th style={{ textAlign: "right", color: C.t1, fontWeight: 700, paddingBottom: 4, width: "30%" }}>本批</th>
          <th style={{ textAlign: "right", color: C.t3, fontWeight: 500, paddingBottom: 4, width: "30%" }}>TPO参考</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, actual, tpo, format = (v) => v, warn }) => {
          const isWarn = warn ? warn(actual, tpo) : false;
          return (
            <tr key={label} style={{ borderTop: "1px solid " + C.bdrSubtle }}>
              <td style={{ padding: "5px 0", color: C.t2 }}>{label}</td>
              <td style={{ padding: "5px 0", textAlign: "right", fontWeight: 800, color: isWarn ? "#92400e" : C.nav }}>{format(actual)}</td>
              <td style={{ padding: "5px 0", textAlign: "right", color: C.t3 }}>{format(tpo)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6, marginTop: 12 }}>{children}</div>;
}

function QuestionRow({ q }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid " + C.bdrSubtle, paddingBottom: 6, marginBottom: 6 }}>
      <button onClick={() => setOpen(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0, fontFamily: FONT }}>
        <div style={{ fontSize: 12, color: C.t2, display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: C.t1 }}>{q.answer}</span>
          <span>{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.t2, lineHeight: 1.8 }}>
          <div><strong>提示：</strong>{q.prompt}</div>
          <div><strong>词块：</strong>{(q.chunks || []).join(" / ")}{q.distractor ? <span style={{ color: C.red }}>（干扰：{q.distractor}）</span> : null}</div>
          {q.prefilled?.length > 0 && <div><strong>预填：</strong>{q.prefilled.join(", ")}</div>}
          {q.grammar_points?.length > 0 && <div><strong>语法点：</strong>{q.grammar_points.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

const CHECK_LABELS = {
  contextViolations: { label: "上下文规则违反", desc: "ask/report/respond 带非空 prompt_context" },
  standaloneNot:     { label: "独立 not 词块",  desc: '应合并为 "did not" 整体' },
  prepFragments:     { label: "介词碎片词块",   desc: '"of the" / "in the" 等无意义块' },
  repetition:        { label: "结构重复",       desc: "同一 distractor 出现 3+ 次" },
  answerErrors:      { label: "答案含干扰词",   desc: "distractor 出现在 answer 里（答案可能有误）" },
  standaloneAdverbs: { label: "独立时间副词",   desc: "yesterday / recently 等应绑定动词" },
};

function ReviewPanel({ runId, token }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [openCheck, setOpenCheck] = useState(null);

  async function doReview() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch(`/api/admin/staging/${runId}/review`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `请求失败 ${res.status}`); return; }
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const scoreColor = result
    ? result.totalIssues === 0 ? "#166534"
      : result.totalIssues <= 5 ? "#1e40af"
      : result.totalIssues <= 15 ? "#92400e"
      : "#991b1b"
    : C.t1;

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid " + C.bdrSubtle, paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: result ? 10 : 0 }}>
        <button
          onClick={doReview} disabled={loading}
          style={{ background: loading ? "#9ca3af" : "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700 }}
        >
          {loading ? "复查中…" : result ? "重新复查" : "规则复查"}
        </button>
        {result && (
          <span style={{ fontSize: 13, fontWeight: 800, color: scoreColor }}>
            {result.totalIssues === 0 ? "✓ 无问题" : `发现 ${result.totalIssues} 个问题`}
            <span style={{ fontWeight: 400, color: C.t3, fontSize: 11 }}>（共 {result.total} 题）</span>
          </span>
        )}
        {error && <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>}
      </div>

      {result && (
        <div>
          {Object.entries(result.checks).map(([key, check]) => {
            const meta = CHECK_LABELS[key] || { label: key, desc: "" };
            const hasItems = check.count > 0;
            const isOpen = openCheck === key;
            return (
              <div key={key} style={{ border: "1px solid " + (hasItems ? "#fcd34d" : C.bdrSubtle), borderRadius: 6, marginBottom: 6, background: hasItems ? "#fffbeb" : "#f9fafb" }}>
                <button
                  onClick={() => hasItems && setOpenCheck(isOpen ? null : key)}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 12px", cursor: hasItems ? "pointer" : "default", fontFamily: FONT, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: hasItems ? "#92400e" : "#166534" }}>
                      {hasItems ? `⚠ ${meta.label}` : `✓ ${meta.label}`}
                    </span>
                    <span style={{ fontSize: 11, color: C.t3, marginLeft: 6 }}>{meta.desc}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: hasItems ? "#92400e" : "#166534" }}>
                    {check.count} 题{hasItems ? (isOpen ? " ▲" : " ▼") : ""}
                  </span>
                </button>
                {isOpen && hasItems && (
                  <div style={{ padding: "0 12px 10px", borderTop: "1px solid #fcd34d" }}>
                    {(check.items || []).map((item, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.t2, padding: "4px 0", borderBottom: "1px solid " + C.bdrSubtle, lineHeight: 1.6 }}>
                        <span style={{ fontWeight: 700, color: C.t1 }}>{item.id}</span>
                        {item.kind && <span style={{ marginLeft: 6, color: "#6366f1" }}>[{item.kind}]</span>}
                        {item.context && <div style={{ color: "#92400e" }}>context: "{item.context}"</div>}
                        {item.taskText && <div>task: {item.taskText}</div>}
                        {item.answer && <div>answer: {item.answer}</div>}
                        {item.distractor && <div style={{ color: "#dc2626" }}>distractor: "{item.distractor}"</div>}
                        {item.badChunks && <div style={{ color: "#92400e" }}>问题词块: {item.badChunks.map(c => `"${c}"`).join(", ")}</div>}
                        {item.ids && <div style={{ color: C.t3 }}>涉及题目: {item.ids.join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatsPanel({ stats, runId, token, onDeployed, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openSet, setOpenSet] = useState(null);

  async function doDeploy() {
    if (!confirm(`确认将本次生成的 ${stats.totalSets} 套题部署到正式题库？Vercel 将自动重新部署。`)) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/staging/${runId}/deploy`, { method: "POST", headers: authHeaders(token) });
      const data = await res.json();
      if (res.ok) {
        setMsg(`✓ 已部署 ${data.addedSets} 套，套题编号 ${(data.newSetIds || []).join(", ")}。Vercel 正在重新部署…`);
        onDeployed(runId);
      } else {
        setMsg(`部署失败：${data.error}`);
      }
    } catch (e) { setMsg(`请求失败：${e.message}`); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (!confirm("确认删除本次生成的题目？此操作不可撤销。")) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/admin/staging/${runId}`, { method: "DELETE", headers: authHeaders(token) });
      const data = await res.json();
      if (res.ok) { onDeleted(runId); }
      else { setMsg(`删除失败：${data.error}`); setBusy(false); }
    } catch (e) { setMsg(`请求失败：${e.message}`); setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* 数字指标 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <StatBox label="套数" value={stats.totalSets} />
        <StatBox label="题目数" value={stats.totalQuestions} />
        <StatBox label="轮次" value={stats.totalRounds} />
        <StatBox label="总生成" value={stats.totalGenerated} />
        <StatBox label="接受率" value={pct(stats.acceptanceRate)} />
      </div>

      {/* 话题新颖度 */}
      {stats.noveltyScore != null && (() => {
        const score = stats.noveltyScore;
        const label = stats.noveltyLabel || "";
        const color = score >= 90 ? "#166534" : score >= 80 ? "#1e40af" : score >= 70 ? "#92400e" : "#991b1b";
        const bg    = score >= 90 ? "#dcfce7" : score >= 80 ? "#dbeafe" : score >= 70 ? "#fef3c7" : "#fee2e2";
        return (
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>话题新颖度</span>
            <span style={{ background: bg, color, borderRadius: 8, padding: "3px 12px", fontWeight: 800, fontSize: 15 }}>
              {score} / 100
            </span>
            <span style={{ fontSize: 12, color, fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: 11, color: C.t3 }}>（≥90 优秀，80-89 良好，70-79 合格，&lt;70 需改进）跨库+批次内取最低</span>
          </div>
        );
      })()}

      {/* 题型分布 */}
      {stats.typeDistribution && (
        <div style={{ marginBottom: 4 }}>
          <SectionTitle>题型分布</SectionTitle>
          <CompareTable rows={[
            { label: "疑问句", actual: stats.typeDistribution.pct?.hasQuestionMark ?? stats.typeDistribution.hasQuestionMark / (stats.totalQuestions || 1), tpo: 0.08, format: p => `${Math.round(p * 100)}%`, warn: (a) => a > 0.15 },
            { label: "干扰词", actual: stats.typeDistribution.pct?.hasDistractor ?? stats.typeDistribution.hasDistractor / (stats.totalQuestions || 1), tpo: 0.88, format: p => `${Math.round(p * 100)}%`, warn: (a) => a < 0.80 },
            { label: "嵌入句", actual: stats.typeDistribution.pct?.hasEmbedded ?? stats.typeDistribution.hasEmbedded / (stats.totalQuestions || 1), tpo: 0.63, format: p => `${Math.round(p * 100)}%`, warn: (a) => a < 0.50 || a > 0.80 },
            { label: "否定句", actual: stats.typeDistribution.pct?.hasNegation ?? stats.typeDistribution.hasNegation / (stats.totalQuestions || 1), tpo: 0.20, format: p => `${Math.round(p * 100)}%`, warn: (a) => a > 0.30 },
            { label: "有预填词", actual: stats.typeDistribution.pct?.hasPrefilled ?? stats.typeDistribution.hasPrefilled / (stats.totalQuestions || 1), tpo: 0.85, format: p => `${Math.round(p * 100)}%`, warn: (a) => a < 0.75 },
          ]} />
        </div>
      )}

      {/* 词块统计 */}
      {stats.chunkStats && (
        <div style={{ marginBottom: 4 }}>
          <SectionTitle>词块统计</SectionTitle>
          <CompareTable rows={[
            { label: "每题有效词块均数", actual: stats.chunkStats.avgEffectiveChunks ?? "-", tpo: 5.8, format: v => v === "-" ? "-" : String(v), warn: (a) => a !== "-" && (a < 5.0 || a > 7.0) },
            { label: "多词块占比", actual: stats.chunkStats.multiWordPct ?? (1 - stats.chunkStats.single / (stats.chunkStats.total || 1)), tpo: 0.23, format: p => `${Math.round(p * 100)}%`, warn: (a) => a > 0.35 },
          ]} />
        </div>
      )}

      {/* 预填词长度分布 */}
      {stats.prefilledLengthDist && (
        <div style={{ marginBottom: 4 }}>
          <SectionTitle>预填词长度分布（占有预填题数）</SectionTitle>
          <CompareTable rows={[
            { label: "1词（i / she）", actual: stats.prefilledLengthDist.pf1Pct, tpo: 0.10, format: p => `${Math.round(p * 100)}%` },
            { label: "2词（the professor）", actual: stats.prefilledLengthDist.pf2Pct, tpo: 0.56, format: p => `${Math.round(p * 100)}%` },
            { label: "3词+（some colleagues）", actual: stats.prefilledLengthDist.pf3Pct, tpo: 0.34, format: p => `${Math.round(p * 100)}%` },
          ].map(r => ({ ...r, tpo: r.tpo ?? "—" }))} />
        </div>
      )}

      {/* 常见预填词 */}
      {stats.prefilledTop?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <SectionTitle>常见预填词</SectionTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {stats.prefilledTop.map(({ word, count }) => (
              <span key={word} style={{ background: C.bg, border: "1px solid " + C.bdr, borderRadius: 10, padding: "2px 8px", fontSize: 12 }}>
                {word} <strong>×{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 题目详情 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>题目详情</div>
        {(stats.sets || []).map((s) => (
          <div key={s.set_id} style={{ border: "1px solid " + C.bdr, borderRadius: 6, marginBottom: 6 }}>
            <button
              onClick={() => setOpenSet(openSet === s.set_id ? null : s.set_id)}
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 12px", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.nav, display: "flex", justifyContent: "space-between" }}
            >
              <span>套题 #{s.set_id}（{s.questions?.length || 0} 题）</span>
              <span>{openSet === s.set_id ? "▲" : "▼"}</span>
            </button>
            {openSet === s.set_id && (
              <div style={{ padding: "0 12px 10px" }}>
                {(s.questions || []).map((q) => <QuestionRow key={q.id} q={q} />)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 规则复查 */}
      <ReviewPanel runId={runId} token={token} />

      {/* 操作按钮 */}
      {msg && (
        <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 10, fontSize: 13, background: msg.startsWith("✓") ? "#dcfce7" : "#fee2e2", color: msg.startsWith("✓") ? "#166534" : C.red }}>
          {msg}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={doDeploy} disabled={busy} style={{ background: C.green, color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          部署到正式题库
        </button>
        <button onClick={doDelete} disabled={busy} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: busy ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          删除
        </button>
      </div>
    </div>
  );
}

/**
 * Estimate generation progress (0–100).
 * Formula: 120s startup + 150s per target set. Capped at 90 until complete.
 */
function estimateProgress(createdAt, targetSets, status, conclusion) {
  if (status === "completed") return conclusion === "success" ? 100 : 100;
  if (!createdAt) return 0;
  const elapsedSec = (Date.now() - new Date(createdAt)) / 1000;
  const estimatedSec = 120 + (Number(targetSets) || 6) * 150;
  return Math.min(90, Math.round((elapsedSec / estimatedSec) * 100));
}

function ProgressBar({ value, label }) {
  const color = value >= 100 ? "#166534" : "#1e40af";
  const bg    = value >= 100 ? "#dcfce7" : "#dbeafe";
  const fill  = value >= 100 ? "#16a34a" : "#3b82f6";
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#6b7280" }}>估算进度</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{value}%</span>
        {label && <span style={{ fontSize: 11, color: "#9ca3af" }}>{label}</span>}
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 99, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: fill, borderRadius: 99, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function RunCard({ run: initial, token, onDelete }) {
  const [run, setRun] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [stagingGone, setStagingGone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopMsg, setStopMsg] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");
  const timerRef = useRef(null);
  const progressRef = useRef(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/generate-bs/${initial.id}`, { headers: authHeaders(token) });
      if (res.ok) {
        const data = await res.json();
        setRun(data);
        if (data.status === "completed") clearInterval(timerRef.current);
      }
    } catch (_) {}
  }, [initial.id, token]);

  useEffect(() => { setRun(initial); }, [initial]);

  useEffect(() => {
    if (run.status !== "completed") {
      timerRef.current = setInterval(fetchDetail, POLL_INTERVAL);
      return () => clearInterval(timerRef.current);
    }
  }, [run.status, fetchDetail]);

  // Auto-fetch stats for completed successful runs so actual set count shows without expanding
  useEffect(() => {
    if (initial.status === "completed" && initial.conclusion === "success" && !initial.stats) {
      fetchDetail();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update progress estimate every second while in progress
  useEffect(() => {
    const targetSets = run.inputs?.target_sets;
    const tick = () => setProgress(estimateProgress(run.createdAt, targetSets, run.status, run.conclusion));
    tick();
    if (run.status !== "completed") {
      progressRef.current = setInterval(tick, 1000);
      return () => clearInterval(progressRef.current);
    }
  }, [run.status, run.conclusion, run.createdAt, run.inputs]);

  async function handleGracefulStop() {
    if (!confirm("确认优雅停止？脚本将在当前轮次结束后保存已生成的题目并组题。")) return;
    setStopping(true); setStopMsg("");
    try {
      const res = await fetch(`/api/admin/generate-bs/${run.id}`, { method: "PUT", headers: authHeaders(token) });
      const data = await res.json();
      if (res.ok) {
        setStopMsg(data.message || "已发送优雅停止信号。");
      } else {
        setStopMsg(`失败：${data.error}`);
      }
    } catch (e) { setStopMsg(`请求失败：${e.message}`); }
    finally { setStopping(false); }
  }

  async function handleCancel() {
    if (!confirm("确认强制停止？这将立即终止任务，不保存已生成的题目。")) return;
    setCancelling(true); setCancelMsg("");
    try {
      const res = await fetch(`/api/admin/generate-bs/${run.id}`, { method: "POST", headers: authHeaders(token) });
      const data = await res.json();
      if (res.ok) {
        setCancelMsg(data.alreadyDone ? "任务已完成，无需取消。" : "已发送停止请求，任务将在数秒内中止。");
        setTimeout(fetchDetail, 4000);
      } else {
        setCancelMsg(`停止失败：${data.error}`);
      }
    } catch (e) { setCancelMsg(`请求失败：${e.message}`); }
    finally { setCancelling(false); }
  }

  async function handleDeleteRun() {
    if (!confirm("确认删除此条生成记录？同时清理临时库文件，不可撤销。")) return;
    setDeleting(true); setDeleteMsg("");
    try {
      const res = await fetch(`/api/admin/generate-bs/${run.id}`, { method: "DELETE", headers: authHeaders(token) });
      const data = await res.json();
      if (res.ok) { onDelete(run.id); }
      else { setDeleteMsg(`删除失败：${data.error}`); setDeleting(false); }
    } catch (e) { setDeleteMsg(`请求失败：${e.message}`); setDeleting(false); }
  }

  async function handleExpand() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!run.stats && run.status === "completed" && run.conclusion === "success") {
      setLoadingStats(true);
      await fetchDetail();
      setLoadingStats(false);
    }
  }

  const isDone = run.status === "completed";
  const isSuccess = isDone && run.conclusion === "success";
  const isFail = isDone && run.conclusion !== "success";
  const targetSets = run.inputs?.target_sets || "-";

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusBadge status={run.status} conclusion={run.conclusion} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>
            目标 {targetSets} 套
            {run.stats?.totalSets != null && (
              <span style={{ fontWeight: 400, color: run.stats.totalSets >= Number(targetSets) ? "#166534" : "#92400e" }}>
                {" → 实际 "}<strong>{run.stats.totalSets}</strong>{" 套 · "}<strong>{run.stats.totalQuestions}</strong>{" 题"}
              </span>
            )}
          </span>
          {isDone && (
            <span style={{ fontSize: 12, color: C.t3 }}>耗时 {elapsed(run.createdAt, run.updatedAt)}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isSuccess && !stagingGone && (
            <button onClick={handleExpand} style={{ background: "none", border: "1px solid " + C.bdr, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: C.t2, fontFamily: FONT }}>
              {expanded ? "收起" : "展开详情"}
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 5, fontSize: 12, color: C.t3 }}>
        {formatDateTime(run.createdAt)}
        {isDone && run.updatedAt && run.updatedAt !== run.createdAt && (
          <span>{"  →  "}{formatDateTime(run.updatedAt)}</span>
        )}
      </div>

      {!isDone && (
        <>
          <ProgressBar
            value={progress}
            label={run.status === "queued" ? "排队等待中…" : "每 5 秒自动刷新，完成后自动更新"}
          />
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleGracefulStop} disabled={stopping || stopMsg.includes("已发送")}
              style={{ background: stopping || stopMsg.includes("已发送") ? "#9ca3af" : "#d97706", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: stopping || stopMsg.includes("已发送") ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700, opacity: stopping || stopMsg.includes("已发送") ? 0.6 : 1 }}
            >
              {stopping ? "发送中…" : stopMsg.includes("已发送") ? "已发送停止信号" : "优雅停止（保存已出题）"}
            </button>
            <button
              onClick={handleCancel} disabled={cancelling}
              style={{ background: "none", border: "1px solid #dc2626", color: "#dc2626", borderRadius: 6, padding: "5px 14px", cursor: cancelling ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700, opacity: cancelling ? 0.6 : 1 }}
            >
              {cancelling ? "停止中…" : "强制停止"}
            </button>
          </div>
          {stopMsg && (
            <div style={{ marginTop: 6, fontSize: 12, color: stopMsg.includes("失败") ? "#dc2626" : "#166534" }}>{stopMsg}</div>
          )}
          {cancelMsg && (
            <div style={{ marginTop: 6, fontSize: 12, color: cancelMsg.includes("失败") ? "#dc2626" : "#166534" }}>{cancelMsg}</div>
          )}
        </>
      )}

      {isFail && (
        <div style={{ marginTop: 8, fontSize: 13, color: C.red }}>
          生成失败。
          {run.failureReason
            ? <div style={{ marginTop: 4, fontSize: 12, color: "#7f1d1d", background: "#fee2e2", borderRadius: 5, padding: "5px 10px", fontFamily: "monospace", wordBreak: "break-all" }}>{run.failureReason}</div>
            : <span style={{ color: C.t3 }}> 暂无详情（旧任务不含状态文件）</span>
          }
        </div>
      )}

      {isSuccess && stagingGone && (
        <div style={{ marginTop: 8, fontSize: 13, color: C.green, fontWeight: 600 }}>已处理（部署或删除）</div>
      )}

      {isSuccess && !stagingGone && run.stagingReady === false && !expanded && (
        <div style={{ marginTop: 8, fontSize: 13, color: C.t2 }}>临时库文件已不存在（可能已部署或删除）</div>
      )}

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <a href={run.htmlUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.blue, textDecoration: "none" }}>
          在 GitHub 查看日志 →
        </a>
        {isDone && (
          <>
            <button
              onClick={handleDeleteRun} disabled={deleting}
              style={{ background: "none", border: "1px solid #dc2626", color: "#dc2626", borderRadius: 6, padding: "3px 10px", cursor: deleting ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700, opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? "删除中…" : "删除记录"}
            </button>
            {deleteMsg && <span style={{ fontSize: 12, color: "#dc2626" }}>{deleteMsg}</span>}
          </>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: "1px solid " + C.bdr, paddingTop: 12 }}>
          {loadingStats && <div style={{ fontSize: 13, color: C.t2 }}>加载统计数据…</div>}
          {!loadingStats && run.stats && (
            <StatsPanel
              stats={run.stats}
              runId={run.id}
              token={token}
              onDeployed={() => { setStagingGone(true); setExpanded(false); }}
              onDeleted={() => { setStagingGone(true); setExpanded(false); }}
            />
          )}
          {!loadingStats && !run.stats && run.stagingReady === false && (
            <div style={{ fontSize: 13, color: C.t2 }}>临时库文件不存在，可能已处理过。</div>
          )}
          {!loadingStats && run.statsError && (
            <div style={{ fontSize: 13, color: C.red }}>读取失败：{run.statsError}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminGenerateBSPage() {
  const [token, setToken] = useState("");
  const [runs, setRuns] = useState([]);
  const [targetSets, setTargetSets] = useState(6);
  const [triggering, setTriggering] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [triggerMsg, setTriggerMsg] = useState("");

  useEffect(() => {
    try { setToken(localStorage.getItem(TOKEN_KEY) || ""); } catch (_) {}
  }, []);

  function persistToken(v) {
    setToken(v);
    try { localStorage.setItem(TOKEN_KEY, v); } catch (_) {}
  }

  async function loadRuns(t = token) {
    if (!t) return;
    setLoadError("");
    try {
      const res = await fetch("/api/admin/generate-bs", { headers: authHeaders(t) });
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setLoadError(data.error || `加载失败 ${res.status}`);
      }
    } catch (e) { setLoadError(e.message); }
  }

  useEffect(() => { if (token) loadRuns(token); }, [token]);

  async function trigger() {
    setTriggering(true); setTriggerMsg("");
    try {
      const res = await fetch("/api/admin/generate-bs", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ targetSets }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerMsg("已触发，GitHub Actions 正在启动，约 10 秒后刷新可见任务…");
        setTimeout(() => loadRuns(), 10000);
      } else {
        setTriggerMsg(`错误：${data.error || res.status}`);
      }
    } catch (e) { setTriggerMsg(`请求失败：${e.message}`); }
    finally { setTriggering(false); }
  }

  return (
    <AdminLayout title="自动生题">
      <div style={{ maxWidth: 820, margin: "0 auto" }}>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.nav, marginBottom: 4 }}>自动生成题目</div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
            生成完成后题目先存入临时库，由你确认后再部署到正式题库（触发 Vercel 重新部署）。
          </div>

          <input
            value={token}
            onChange={(e) => persistToken(e.target.value)}
            placeholder="ADMIN_DASHBOARD_TOKEN"
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + C.bdr, borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 12, marginBottom: 12 }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: C.t1, whiteSpace: "nowrap" }}>套数：</label>
            <input
              type="number" min={1} max={20} value={targetSets}
              onChange={(e) => setTargetSets(Number(e.target.value))}
              style={{ width: 70, padding: "7px 10px", border: "1px solid " + C.bdr, borderRadius: 6, fontSize: 14, fontFamily: FONT }}
            />
            <button
              onClick={trigger} disabled={triggering || !token}
              style={{ background: triggering || !token ? "#9ca3af" : C.blue, color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: triggering || !token ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 700 }}
            >
              {triggering ? "触发中…" : "开始生成"}
            </button>
            <button
              onClick={() => loadRuns()} disabled={!token}
              style={{ background: "none", border: "1px solid " + C.bdr, borderRadius: 6, padding: "8px 14px", cursor: "pointer", color: C.t2, fontFamily: FONT, fontSize: 13 }}
            >
              刷新列表
            </button>
          </div>

          {triggerMsg && (
            <div style={{ marginTop: 10, fontSize: 13, padding: "7px 10px", borderRadius: 6, background: triggerMsg.startsWith("错误") || triggerMsg.startsWith("请求") ? "#fee2e2" : "#dbeafe", color: triggerMsg.startsWith("错误") || triggerMsg.startsWith("请求") ? C.red : "#1e40af" }}>
              {triggerMsg}
            </div>
          )}
        </div>

        {loadError && (
          <div style={{ background: "#fee2e2", color: C.red, padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {loadError}
            {loadError.includes("GH_PAT") && <div style={{ marginTop: 6, fontWeight: 600 }}>请在 Vercel 环境变量中配置 GH_PAT</div>}
          </div>
        )}

        {runs.length === 0 && !loadError && token && (
          <div style={{ textAlign: "center", color: C.t3, fontSize: 13, padding: 32 }}>暂无任务记录</div>
        )}

        {runs.map((run) => (
          <RunCard key={run.id} run={run} token={token} onDelete={(id) => setRuns(prev => prev.filter(r => r.id !== id))} />
        ))}
      </div>
    </AdminLayout>
  );
}
