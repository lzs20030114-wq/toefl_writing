"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";
import { useAdminToken, callAdminApi } from "../../lib/adminHelpers";

const POLL_INTERVAL = 5000;

// ── Task definitions ─────────────────────────────────────────────────────────
const TABS = [
  { key: "bs", label: "连词成句", tag: "Task 1" },
  { key: "email", label: "邮件写作", tag: "Task 2" },
  { key: "disc", label: "学术讨论", tag: "Task 3" },
];

const TASK_META = {
  bs: {
    paramLabel: "生成套数",
    defaultVal: 6,
    min: 1,
    max: 20,
    unit: "套",
    desc: "多轮 AI 生成 + 交叉审核，每套 10 题",
    apiBase: "/api/admin/generate-bs",
    estimateSec: (n) => 120 + n * 150,
  },
  email: {
    paramLabel: "生成数量",
    defaultVal: 10,
    min: 1,
    max: 50,
    unit: "题",
    desc: "DeepSeek 生成邮件写作场景，含情境 + 三项写作任务",
    apiBase: "/api/admin/generate/email",
    estimateSec: (n) => 30 + n * 12,
  },
  disc: {
    paramLabel: "生成数量",
    defaultVal: 10,
    min: 1,
    max: 50,
    unit: "题",
    desc: "DeepSeek 生成学术讨论话题，含教授问题 + 两名学生观点",
    apiBase: "/api/admin/generate/disc",
    estimateSec: (n) => 30 + n * 15,
  },
};

// ── Utilities ────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return "-";
  const sec = Math.round((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  return `${Math.floor(sec / 86400)}天前`;
}

function fmtDt(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function elapsed(start, end) {
  if (!start) return "-";
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function pct(n) {
  return n == null ? "-" : `${Math.round(n * 100)}%`;
}

function getInputCount(inputs, taskType) {
  if (taskType === "bs") return inputs?.target_sets || "-";
  return inputs?.target_count || "-";
}

// ── Shared UI components ─────────────────────────────────────────────────────
function StatusBadge({ status, conclusion }) {
  const map = {
    queued: ["#fef3c7", "#92400e", "排队中"],
    in_progress: ["#dbeafe", "#1e40af", "生成中…"],
    completed: conclusion === "success" ? ["#dcfce7", "#166534", "完成"] : ["#fee2e2", "#991b1b", "失败"],
  };
  const [bg, color, label] = map[status] || ["#f3f4f6", "#374151", status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 700 }}>
      {status === "in_progress" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, animation: "pulse 1.5s infinite" }} />}
      {conclusion === "success" && <span style={{ fontSize: 13 }}>✓</span>}
      {conclusion && conclusion !== "success" && status === "completed" && <span style={{ fontSize: 13 }}>✗</span>}
      {label}
    </span>
  );
}

function ProgressBar({ value }) {
  const fill = value >= 100 ? "#16a34a" : "#3b82f6";
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: C.t3 }}>预计进度</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: value >= 100 ? "#166534" : "#1e40af" }}>{value}%</span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: fill, borderRadius: 99, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: C.bg, borderRadius: 8, padding: "10px 14px", minWidth: 80 }}>
      <div style={{ fontSize: 11, color: C.t3, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.nav }}>{value ?? "-"}</div>
    </div>
  );
}

function DistTag({ label, count, color }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 12, background: color || C.bg, fontSize: 12, fontWeight: 600, color: C.t1 }}>
      {label} <strong>{count}</strong>
    </span>
  );
}

// ── BS-specific components ───────────────────────────────────────────────────
function CompareRow({ label, actual, tpo, format = (v) => v, warn }) {
  const isWarn = warn ? warn(actual, tpo) : false;
  return (
    <tr style={{ borderTop: "1px solid " + C.bdrSubtle }}>
      <td style={{ padding: "5px 0", fontSize: 12, color: C.t2 }}>{label}</td>
      <td style={{ padding: "5px 0", textAlign: "right", fontSize: 12, fontWeight: 800, color: isWarn ? "#92400e" : C.nav }}>{format(actual)}</td>
      <td style={{ padding: "5px 0", textAlign: "right", fontSize: 12, color: C.t3 }}>{format(tpo)}</td>
    </tr>
  );
}

function BSStatsPanel({ stats }) {
  if (!stats) return null;
  const td = stats.typeDistribution;
  const cs = stats.chunkStats;
  const pl = stats.prefilledLengthDist;
  const tq = stats.totalQuestions || 1;

  return (
    <div>
      {/* Numeric stats */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <StatBox label="套数" value={stats.totalSets} />
        <StatBox label="题目" value={stats.totalQuestions} />
        <StatBox label="轮次" value={stats.totalRounds} />
        <StatBox label="接受率" value={pct(stats.acceptanceRate)} />
      </div>

      {/* Novelty */}
      {stats.noveltyScore != null && (() => {
        const s = stats.noveltyScore;
        const bg = s >= 90 ? "#dcfce7" : s >= 80 ? "#dbeafe" : s >= 70 ? "#fef3c7" : "#fee2e2";
        const c = s >= 90 ? "#166534" : s >= 80 ? "#1e40af" : s >= 70 ? "#92400e" : "#991b1b";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>话题新颖度</span>
            <span style={{ background: bg, color: c, borderRadius: 8, padding: "3px 12px", fontWeight: 800, fontSize: 14 }}>{s}/100</span>
            <span style={{ fontSize: 12, color: c, fontWeight: 600 }}>{stats.noveltyLabel}</span>
          </div>
        );
      })()}

      {/* Type distribution */}
      {td && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>题型分布</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ textAlign: "left", color: C.t3, fontWeight: 600, fontSize: 11, paddingBottom: 4, width: "40%" }}>指标</th>
              <th style={{ textAlign: "right", color: C.t1, fontWeight: 700, fontSize: 11, paddingBottom: 4, width: "30%" }}>本批</th>
              <th style={{ textAlign: "right", color: C.t3, fontWeight: 500, fontSize: 11, paddingBottom: 4, width: "30%" }}>TPO</th>
            </tr></thead>
            <tbody>
              <CompareRow label="疑问句" actual={td.pct?.hasQuestionMark ?? td.hasQuestionMark / tq} tpo={0.08} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a > 0.15} />
              <CompareRow label="干扰词" actual={td.pct?.hasDistractor ?? td.hasDistractor / tq} tpo={0.88} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a < 0.80} />
              <CompareRow label="嵌入句" actual={td.pct?.hasEmbedded ?? td.hasEmbedded / tq} tpo={0.63} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a < 0.50 || a > 0.80} />
              <CompareRow label="否定句" actual={td.pct?.hasNegation ?? td.hasNegation / tq} tpo={0.20} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a > 0.30} />
              <CompareRow label="有预填词" actual={td.pct?.hasPrefilled ?? td.hasPrefilled / tq} tpo={0.85} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a < 0.75} />
            </tbody>
          </table>
        </div>
      )}

      {/* Chunk stats */}
      {cs && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>词块统计</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ textAlign: "left", color: C.t3, fontWeight: 600, fontSize: 11, paddingBottom: 4, width: "40%" }}>指标</th>
              <th style={{ textAlign: "right", color: C.t1, fontWeight: 700, fontSize: 11, paddingBottom: 4, width: "30%" }}>本批</th>
              <th style={{ textAlign: "right", color: C.t3, fontWeight: 500, fontSize: 11, paddingBottom: 4, width: "30%" }}>TPO</th>
            </tr></thead>
            <tbody>
              <CompareRow label="有效词块均数" actual={cs.avgEffectiveChunks ?? "-"} tpo={5.8} format={(v) => String(v)} warn={(a) => a !== "-" && (a < 5 || a > 7)} />
              <CompareRow label="多词块占比" actual={cs.multiWordPct ?? (1 - cs.single / (cs.total || 1))} tpo={0.23} format={(p) => `${Math.round(p * 100)}%`} warn={(a) => a > 0.35} />
            </tbody>
          </table>
        </div>
      )}

      {/* Prefilled distribution */}
      {pl && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>预填词分布</div>
          <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
            <span>1词 <strong>{Math.round(pl.pf1Pct * 100)}%</strong></span>
            <span>2词 <strong>{Math.round(pl.pf2Pct * 100)}%</strong></span>
            <span>3词+ <strong>{Math.round(pl.pf3Pct * 100)}%</strong></span>
          </div>
        </div>
      )}

      {/* Common prefilled */}
      {stats.prefilledTop?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>常见预填词</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {stats.prefilledTop.map(({ word, count }) => (
              <span key={word} style={{ background: C.bg, border: "1px solid " + C.bdr, borderRadius: 10, padding: "2px 8px", fontSize: 11 }}>
                {word} <strong>×{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Disc detail panel ────────────────────────────────────────────────────────
function DiscStatsPanel({ stats }) {
  if (!stats) return null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <StatBox label="题目数" value={stats.totalQuestions} />
        <StatBox label="成功" value={stats.totalAccepted} color="#166534" />
        {stats.failures > 0 && <StatBox label="失败" value={stats.failures} color={C.red} />}
      </div>

      {/* Text stats */}
      {stats.textStats && (
        <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 12, color: C.t2 }}>
          <span>教授均长 <strong style={{ color: C.t1 }}>{stats.textStats.avgProfLength}</strong> 字符</span>
          <span>学生1均长 <strong style={{ color: C.t1 }}>{stats.textStats.avgS1Length}</strong></span>
          <span>学生2均长 <strong style={{ color: C.t1 }}>{stats.textStats.avgS2Length}</strong></span>
        </div>
      )}

      {/* Course distribution */}
      {stats.courseDist && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>课程分布</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.entries(stats.courseDist).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <DistTag key={c} label={c} count={n} color="#ecfdf5" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Email detail panel ───────────────────────────────────────────────────────
function EmailStatsPanel({ stats }) {
  if (!stats) return null;
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <StatBox label="题目数" value={stats.totalQuestions} />
        <StatBox label="成功" value={stats.totalAccepted} color="#166534" />
        {stats.failures > 0 && <StatBox label="失败" value={stats.failures} color={C.red} />}
      </div>

      {stats.textStats && (
        <div style={{ marginBottom: 14, fontSize: 12, color: C.t2 }}>
          场景均长 <strong style={{ color: C.t1 }}>{stats.textStats.avgScenarioLength}</strong> 字符
        </div>
      )}

      {stats.topicDist && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 6 }}>话题分布</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Object.entries(stats.topicDist).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <DistTag key={t} label={t} count={n} color="#eff6ff" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Question preview (for disc/email expanded view) ──────────────────────────
function QuestionPreview({ q, taskType }) {
  const [open, setOpen] = useState(false);

  if (taskType === "disc") {
    return (
      <div style={{ borderBottom: "1px solid " + C.bdrSubtle, paddingBottom: 8, marginBottom: 8 }}>
        <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0, fontFamily: FONT }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12 }}>
              <span style={{ color: C.blue, fontWeight: 700 }}>[{q.course}]</span>{" "}
              <span style={{ color: C.t1 }}>{(q.professor?.text || "").slice(0, 80)}…</span>
            </span>
            <span style={{ fontSize: 11, color: C.t3, flexShrink: 0, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
          </div>
        </button>
        {open && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.8, color: C.t2 }}>
            <div style={{ background: "#f0fdf4", padding: "8px 12px", borderRadius: 6, marginBottom: 6 }}>
              <strong style={{ color: C.t1 }}>Professor:</strong> {q.professor?.text}
            </div>
            {(q.students || []).map((s, i) => (
              <div key={i} style={{ background: i === 0 ? "#eff6ff" : "#fef3c7", padding: "6px 12px", borderRadius: 6, marginBottom: 4 }}>
                <strong style={{ color: C.t1 }}>{s.name}:</strong> {s.text}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Email
  return (
    <div style={{ borderBottom: "1px solid " + C.bdrSubtle, paddingBottom: 8, marginBottom: 8 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0, fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12 }}>
            <span style={{ color: C.blue, fontWeight: 700 }}>[{q.topic}]</span>{" "}
            <span style={{ color: C.t1 }}>{q.subject}</span>
            <span style={{ color: C.t3 }}> → {q.to}</span>
          </span>
          <span style={{ fontSize: 11, color: C.t3, flexShrink: 0, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.8, color: C.t2 }}>
          <div style={{ background: "#f0fdf4", padding: "8px 12px", borderRadius: 6, marginBottom: 6 }}>{q.scenario}</div>
          <div style={{ padding: "0 12px", color: C.t1, fontWeight: 600, marginBottom: 4 }}>{q.direction}</div>
          <ol style={{ margin: "0 0 0 28px", padding: 0 }}>
            {(q.goals || []).map((g, i) => <li key={i} style={{ marginBottom: 2 }}>{g}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── BS question preview (per set) ────────────────────────────────────────────
function BSQuestionRow({ q }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid " + C.bdrSubtle, paddingBottom: 4, marginBottom: 4 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0, fontFamily: FONT }}>
        <div style={{ fontSize: 12, color: C.t1, display: "flex", justifyContent: "space-between" }}>
          <span>{q.answer}</span>
          <span style={{ color: C.t3 }}>{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 4, fontSize: 11, color: C.t2, lineHeight: 1.8, paddingLeft: 8 }}>
          <div><strong>提示：</strong>{q.prompt}</div>
          <div><strong>词块：</strong>{(q.chunks || []).join(" / ")}{q.distractor ? <span style={{ color: C.red }}>（干扰：{q.distractor}）</span> : null}</div>
          {q.prefilled?.length > 0 && <div><strong>预填：</strong>{q.prefilled.join(", ")}</div>}
          {q.grammar_points?.length > 0 && <div><strong>语法点：</strong>{q.grammar_points.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

// ── Run Card ─────────────────────────────────────────────────────────────────
function RunCard({ run: initial, taskType, onDelete }) {
  const { token } = useAdminToken();
  const meta = TASK_META[taskType];
  const [run, setRun] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [stagingGone, setStagingGone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [actionMsg, setActionMsg] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [openSet, setOpenSet] = useState(null);
  const timerRef = useRef(null);
  const progressRef = useRef(null);

  const fetchDetail = useCallback(async () => {
    try {
      const data = await callAdminApi(`${meta.apiBase}/${initial.id}`);
      setRun(data);
      if (data.status === "completed") clearInterval(timerRef.current);
    } catch (_) {}
  }, [initial.id, meta.apiBase]);

  useEffect(() => { setRun(initial); }, [initial]);

  useEffect(() => {
    if (run.status !== "completed") {
      timerRef.current = setInterval(fetchDetail, POLL_INTERVAL);
      return () => clearInterval(timerRef.current);
    }
  }, [run.status, fetchDetail]);

  useEffect(() => {
    if (initial.status === "completed" && initial.conclusion === "success" && !initial.stats) fetchDetail();
  }, []);

  useEffect(() => {
    const inputCount = Number(getInputCount(run.inputs, taskType)) || meta.defaultVal;
    const est = meta.estimateSec(inputCount);
    const tick = () => {
      if (run.status === "completed") { setProgress(100); return; }
      if (!run.createdAt) { setProgress(0); return; }
      const sec = (Date.now() - new Date(run.createdAt)) / 1000;
      setProgress(Math.min(90, Math.round((sec / est) * 100)));
    };
    tick();
    if (run.status !== "completed") {
      progressRef.current = setInterval(tick, 1000);
      return () => clearInterval(progressRef.current);
    }
  }, [run.status, run.conclusion, run.createdAt, run.inputs, taskType, meta]);

  async function doAction(method, confirm_msg) {
    if (confirm_msg && !confirm(confirm_msg)) return;
    setActionBusy(true); setActionMsg("");
    try {
      const opts = { method };
      const data = await callAdminApi(`${meta.apiBase}/${run.id}`, opts);
      if (method === "DELETE") { onDelete(run.id); return; }
      setActionMsg(data.message || "操作成功");
      if (method !== "DELETE") setTimeout(fetchDetail, 4000);
    } catch (e) { setActionMsg(`失败：${e.message}`); }
    finally { setActionBusy(false); }
  }

  async function doDeploy() {
    if (!confirm(`确认部署 ${run.stats?.totalQuestions || run.stats?.totalSets || "?"} 题到正式题库？`)) return;
    setActionBusy(true); setActionMsg("");
    try {
      const res = await fetch(`/api/admin/staging/${run.id}/deploy?taskType=${taskType}`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg("✓ 已部署到正式题库，Vercel 正在重新部署…");
        setStagingGone(true);
        setExpanded(false);
      } else {
        setActionMsg(`部署失败：${data.error}`);
      }
    } catch (e) { setActionMsg(`请求失败：${e.message}`); }
    finally { setActionBusy(false); }
  }

  async function doDeleteStaging() {
    if (!confirm("确认删除本次生成的题目？不可撤销。")) return;
    setActionBusy(true); setActionMsg("");
    try {
      const res = await fetch(`/api/admin/staging/${run.id}?taskType=${taskType}`, {
        method: "DELETE",
        headers: { "x-admin-token": token },
      });
      if (res.ok) {
        setStagingGone(true);
        setExpanded(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMsg(`删除失败：${data.error || res.status}`);
      }
    } catch (e) { setActionMsg(`请求失败：${e.message}`); }
    finally { setActionBusy(false); }
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
  const inputCount = getInputCount(run.inputs, taskType);

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: "16px 20px", marginBottom: 10, boxShadow: C.shadow }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusBadge status={run.status} conclusion={run.conclusion} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>
            目标 {inputCount} {meta.unit}
            {run.stats && (
              <span style={{ fontWeight: 400, color: "#166534" }}>
                {" → "}
                <strong>{taskType === "bs" ? `${run.stats.totalSets} 套 · ` : ""}{run.stats.totalQuestions}</strong> 题
              </span>
            )}
          </span>
          {isDone && <span style={{ fontSize: 11, color: C.t3 }}>耗时 {elapsed(run.createdAt, run.updatedAt)}</span>}
        </div>
        {isSuccess && !stagingGone && (
          <button
            onClick={handleExpand}
            style={{
              background: expanded ? C.nav : "transparent", color: expanded ? "#fff" : C.t2,
              border: "1px solid " + (expanded ? C.nav : C.bdr), borderRadius: 6,
              padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: FONT, fontWeight: 600,
            }}
          >
            {expanded ? "收起" : "展开详情"}
          </button>
        )}
      </div>

      {/* Time */}
      <div style={{ marginTop: 4, fontSize: 11, color: C.t3 }}>
        {fmtDt(run.createdAt)}
        {isDone && run.updatedAt !== run.createdAt && <span>{" → "}{fmtDt(run.updatedAt)}</span>}
      </div>

      {/* Progress (in-progress) */}
      {!isDone && <ProgressBar value={progress} />}

      {/* Controls for in-progress */}
      {!isDone && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => doAction("PUT", "确认优雅停止？将保存已生成的题目。")}
            disabled={actionBusy}
            style={{ background: "#d97706", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: actionBusy ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700, opacity: actionBusy ? 0.5 : 1 }}
          >
            优雅停止
          </button>
          <button
            onClick={() => doAction("POST", "确认强制停止？不保存已生成的题目。")}
            disabled={actionBusy}
            style={{ background: "none", border: "1px solid #dc2626", color: "#dc2626", borderRadius: 6, padding: "5px 14px", cursor: actionBusy ? "not-allowed" : "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 700, opacity: actionBusy ? 0.5 : 1 }}
          >
            强制停止
          </button>
        </div>
      )}

      {/* Failure */}
      {isFail && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>生成失败</div>
          {run.failureReason && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#7f1d1d", background: "#fee2e2", borderRadius: 6, padding: "6px 10px", fontFamily: "monospace", wordBreak: "break-all" }}>{run.failureReason}</div>
          )}
        </div>
      )}

      {/* Staging gone */}
      {isSuccess && stagingGone && (
        <div style={{ marginTop: 8, fontSize: 13, color: C.green, fontWeight: 600 }}>已处理（部署或删除）</div>
      )}

      {/* Action messages */}
      {actionMsg && (
        <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, fontSize: 12, background: actionMsg.startsWith("✓") ? "#dcfce7" : "#fee2e2", color: actionMsg.startsWith("✓") ? "#166534" : C.red }}>
          {actionMsg}
        </div>
      )}

      {/* Footer links */}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href={run.htmlUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.blue, textDecoration: "none" }}>
          GitHub 日志 →
        </a>
        {isDone && (
          <button
            onClick={() => doAction("DELETE", "确认删除此条记录？不可撤销。")}
            disabled={actionBusy}
            style={{ background: "none", border: "none", color: C.t3, cursor: "pointer", fontFamily: FONT, fontSize: 11, textDecoration: "underline", padding: 0, opacity: actionBusy ? 0.5 : 1 }}
          >
            删除记录
          </button>
        )}
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ marginTop: 14, borderTop: "1px solid " + C.bdr, paddingTop: 14 }}>
          {loadingStats && <div style={{ fontSize: 13, color: C.t2 }}>加载统计…</div>}
          {!loadingStats && run.stats && (
            <div>
              {/* Task-specific stats */}
              {taskType === "bs" && <BSStatsPanel stats={run.stats} />}
              {taskType === "disc" && <DiscStatsPanel stats={run.stats} />}
              {taskType === "email" && <EmailStatsPanel stats={run.stats} />}

              {/* Question list (disc/email) */}
              {(taskType === "disc" || taskType === "email") && run.stats.questions?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 8 }}>题目详情</div>
                  {run.stats.questions.map((q) => (
                    <QuestionPreview key={q.id} q={q} taskType={taskType} />
                  ))}
                </div>
              )}

              {/* BS question sets */}
              {taskType === "bs" && run.stats.sets?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 8 }}>题目详情</div>
                  {run.stats.sets.map((s) => (
                    <div key={s.set_id} style={{ border: "1px solid " + C.bdr, borderRadius: 6, marginBottom: 6 }}>
                      <button
                        onClick={() => setOpenSet(openSet === s.set_id ? null : s.set_id)}
                        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 12px", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.nav, display: "flex", justifyContent: "space-between" }}
                      >
                        <span>套题 #{s.set_id}（{s.questions?.length || 0} 题）</span>
                        <span style={{ color: C.t3 }}>{openSet === s.set_id ? "▲" : "▼"}</span>
                      </button>
                      {openSet === s.set_id && (
                        <div style={{ padding: "0 12px 10px" }}>
                          {(s.questions || []).map((q) => <BSQuestionRow key={q.id} q={q} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Deploy / Delete buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={doDeploy}
                  disabled={actionBusy}
                  style={{
                    background: C.green, color: "#fff", border: "none", borderRadius: 8,
                    padding: "10px 24px", cursor: actionBusy ? "not-allowed" : "pointer",
                    fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: actionBusy ? 0.5 : 1,
                  }}
                >
                  部署到正式题库
                </button>
                <button
                  onClick={doDeleteStaging}
                  disabled={actionBusy}
                  style={{
                    background: "none", color: C.red, border: "1px solid " + C.red, borderRadius: 8,
                    padding: "10px 24px", cursor: actionBusy ? "not-allowed" : "pointer",
                    fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: actionBusy ? 0.5 : 1,
                  }}
                >
                  丢弃
                </button>
              </div>
            </div>
          )}

          {!loadingStats && !run.stats && run.stagingReady === false && (
            <div style={{ fontSize: 13, color: C.t2 }}>临时库文件不存在，可能已处理过。</div>
          )}
          {run.statsError && (
            <div style={{ fontSize: 13, color: C.red }}>读取失败：{run.statsError}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trigger Panel ────────────────────────────────────────────────────────────
function TriggerPanel({ taskType }) {
  const meta = TASK_META[taskType];
  const [count, setCount] = useState(meta.defaultVal);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function trigger() {
    setBusy(true); setMsg("");
    try {
      const body = taskType === "bs" ? { targetSets: count } : { count };
      await callAdminApi(meta.apiBase, { method: "POST", body: JSON.stringify(body) });
      setMsg("已触发，GitHub Actions 启动中，约 10 秒后刷新可见…");
    } catch (e) { setMsg(`错误：${e.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 10, padding: "18px 20px", marginBottom: 16, boxShadow: C.shadow }}>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>{meta.desc}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: C.t1, whiteSpace: "nowrap" }}>{meta.paramLabel}：</label>
        <input
          type="number"
          min={meta.min}
          max={meta.max}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          style={{ width: 70, padding: "8px 10px", border: "1px solid " + C.bdr, borderRadius: 8, fontSize: 14, fontFamily: FONT, textAlign: "center" }}
        />
        <button
          onClick={trigger}
          disabled={busy}
          style={{
            background: busy ? "#9ca3af" : C.blue, color: "#fff", border: "none", borderRadius: 8,
            padding: "9px 24px", cursor: busy ? "not-allowed" : "pointer",
            fontFamily: FONT, fontSize: 14, fontWeight: 700,
          }}
        >
          {busy ? "触发中…" : "开始生成"}
        </button>
      </div>
      {msg && (
        <div style={{ marginTop: 10, fontSize: 13, padding: "8px 12px", borderRadius: 6, background: msg.startsWith("错误") ? "#fee2e2" : "#dbeafe", color: msg.startsWith("错误") ? C.red : "#1e40af" }}>
          {msg}
        </div>
      )}
    </div>
  );
}

// ── Tab content (runs for a task type) ───────────────────────────────────────
function TaskTab({ taskType, active }) {
  const meta = TASK_META[taskType];
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRuns() {
    setLoading(true); setError("");
    try {
      const data = await callAdminApi(meta.apiBase);
      setRuns(data.runs || []);
    } catch (e) {
      setError(e.message || "加载失败");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (active) loadRuns();
  }, [active]);

  if (!active) return null;

  return (
    <div>
      <TriggerPanel taskType={taskType} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>最近任务</div>
        <button
          onClick={loadRuns}
          disabled={loading}
          style={{ background: "none", border: "1px solid " + C.bdr, borderRadius: 6, padding: "5px 14px", cursor: loading ? "wait" : "pointer", fontSize: 12, color: C.t2, fontFamily: FONT }}
        >
          {loading ? "加载中…" : "刷新"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: C.red, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error}
          {error.includes("GH_PAT") && <div style={{ marginTop: 4, fontWeight: 600 }}>请在 Vercel 环境变量中配置 GH_PAT</div>}
          {error.includes("404") && <div style={{ marginTop: 4, fontWeight: 600 }}>Workflow 文件未找到，请先推送对应的 .yml 文件到 GitHub。</div>}
        </div>
      )}

      {runs.length === 0 && !error && !loading && (
        <div style={{ textAlign: "center", color: C.t3, fontSize: 13, padding: 40 }}>暂无任务记录</div>
      )}

      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          taskType={taskType}
          onDelete={(id) => setRuns((prev) => prev.filter((r) => r.id !== id))}
        />
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AdminGeneratePage() {
  const { token, ready } = useAdminToken();
  const [activeTab, setActiveTab] = useState("bs");

  if (!ready) return null;

  return (
    <AdminLayout title="自动生题">
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      <div className="adm-page" style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Tab bar */}
        <div className="adm-tabs" style={{ display: "flex", gap: 4, marginBottom: 20, background: C.bg, padding: 4, borderRadius: 10 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: 8, border: "none",
                  background: active ? "#fff" : "transparent",
                  boxShadow: active ? C.shadow : "none",
                  color: active ? C.nav : C.t3,
                  fontSize: 14, fontWeight: active ? 800 : 500,
                  cursor: "pointer", fontFamily: FONT,
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: active ? C.blue : C.t3, marginRight: 6 }}>{tab.tag}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {TABS.map((tab) => (
          <TaskTab key={tab.key} taskType={tab.key} active={activeTab === tab.key} />
        ))}
      </div>
    </AdminLayout>
  );
}
