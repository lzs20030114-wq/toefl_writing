"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { C, FONT } from "../../components/shared/ui";

const POLL_INTERVAL = 3000;

function useAdminToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(localStorage.getItem("adminToken") || "");
  }, []);
  return token;
}

function authHeaders(token) {
  return { "Content-Type": "application/json", "x-admin-token": token };
}

function fmtTime(sec) {
  if (!sec && sec !== 0) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtPct(num, denom) {
  if (!denom) return "-";
  return `${Math.round((num / denom) * 100)}%`;
}

function Badge({ color, children }) {
  const bg = { green: "#dcfce7", amber: "#fef3c7", red: "#fee2e2", blue: "#dbeafe", gray: "#f3f4f6" };
  const text = { green: "#166534", amber: "#92400e", red: "#991b1b", blue: "#1e40af", gray: "#374151" };
  const c = color || "gray";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 12,
      background: bg[c], color: text[c], fontSize: 11, fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = { running: ["amber", "运行中"], done: ["green", "完成"], failed: ["red", "失败"] };
  const [color, label] = map[status] || ["gray", status || "未知"];
  return <Badge color={color}>{label}</Badge>;
}

function QuestionDetail({ q }) {
  return (
    <div style={{ background: C.bg, border: "1px solid " + C.bdr, borderRadius: 6, padding: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 12, color: C.t2, marginBottom: 4 }}><strong>ID:</strong> {q.id}</div>
      <div style={{ fontSize: 13, marginBottom: 4 }}><strong>提示：</strong>{q.prompt}</div>
      <div style={{ fontSize: 13, marginBottom: 4 }}><strong>答案：</strong>{q.answer}</div>
      <div style={{ fontSize: 12, color: C.t2 }}>
        <strong>词块：</strong>{(q.chunks || []).join(" / ")}
        {q.distractor ? <span style={{ color: C.red }}> （干扰词: {q.distractor}）</span> : null}
      </div>
      {q.prefilled?.length > 0 && (
        <div style={{ fontSize: 12, color: C.t2 }}><strong>预填：</strong>{q.prefilled.join(", ")}</div>
      )}
      {q.grammar_points?.length > 0 && (
        <div style={{ fontSize: 12, color: C.t2 }}><strong>语法点：</strong>{q.grammar_points.join(", ")}</div>
      )}
    </div>
  );
}

function SetDetail({ set }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid " + C.bdr, borderRadius: 6, marginBottom: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: "10px 14px", cursor: "pointer", fontFamily: FONT,
          fontSize: 13, fontWeight: 700, color: C.nav, display: "flex", justifyContent: "space-between",
        }}
      >
        <span>套题 #{set.set_id}（{set.questions?.length || 0} 题）</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          {(set.questions || []).map((q) => <QuestionDetail key={q.id} q={q} />)}
        </div>
      )}
    </div>
  );
}

function Report({ report, onDestroy, onSaveToPool, onUpload, jobStatus, busy }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
        {[
          ["套题数", report.totalSets],
          ["题目总数", report.totalQuestions],
          ["耗时", fmtTime(report.elapsedSeconds)],
          ["轮数", report.rounds || "-"],
          ["总生成数", report.totalGenerated || "-"],
          ["接受率", fmtPct(report.totalAccepted, report.totalGenerated)],
        ].map(([label, val]) => (
          <div key={label} style={{ background: C.bg, border: "1px solid " + C.bdr, borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: C.t2 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>难度分布</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Badge color="green">简单 {report.difficulty?.easy || 0}</Badge>
          <Badge color="blue">中等 {report.difficulty?.medium || 0}</Badge>
          <Badge color="red">困难 {report.difficulty?.hard || 0}</Badge>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>题型分布</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {report.typeDistribution && Object.entries({
            "有疑问句": report.typeDistribution.hasQuestionMark,
            "有干扰词": report.typeDistribution.hasDistractor,
            "有嵌入句": report.typeDistribution.hasEmbeddedQuestion,
            "有否定": report.typeDistribution.hasNegation,
            "有预填": report.typeDistribution.hasPrefilled,
          }).map(([k, v]) => <Badge key={k} color="gray">{k}: {v}</Badge>)}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>套题详情</div>
        {(report.sets || []).map((s) => <SetDetail key={s.set_id} set={s} />)}
      </div>

      {jobStatus === "done" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={onSaveToPool}
            disabled={busy}
            style={{
              background: C.blue, color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
            }}
          >存入题目池</button>
          <button
            onClick={onUpload}
            disabled={busy}
            style={{
              background: C.green, color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
            }}
          >直接上传到正式题库</button>
          <button
            onClick={onDestroy}
            disabled={busy}
            style={{
              background: C.red, color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 16px", cursor: busy ? "not-allowed" : "pointer",
              fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
            }}
          >销毁</button>
        </div>
      )}
    </div>
  );
}

function JobCard({ job: initialJob, token, onDestroyed }) {
  const [job, setJob] = useState(initialJob);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const pollRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/generate-bs/${initialJob.jobId}`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        setJob(data);
        if (data.status !== "running") {
          clearInterval(pollRef.current);
        }
      }
    } catch (_) {}
  }, [initialJob.jobId, token]);

  useEffect(() => {
    if (job.status === "running") {
      pollRef.current = setInterval(poll, POLL_INTERVAL);
      return () => clearInterval(pollRef.current);
    }
  }, [job.status, poll]);

  async function doAction(endpoint, successMsg) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/generate-bs/${job.jobId}/${endpoint}`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(successMsg || "操作成功");
        if (endpoint === "destroy") onDestroyed(job.jobId);
      } else {
        setMsg(`错误: ${data.error || res.status}`);
      }
    } catch (e) {
      setMsg(`请求失败: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.nav, marginRight: 8 }}>
            目标 {job.targetSets} 套
          </span>
          <StatusBadge status={job.status} />
        </div>
        <div style={{ fontSize: 11, color: C.t3 }}>
          {new Date(job.startedAt).toLocaleString("zh-CN")}
        </div>
      </div>

      {job.status === "running" && (
        <div style={{ fontSize: 13, color: C.orange, marginBottom: 8 }}>正在生成，每 3 秒自动刷新…</div>
      )}

      {job.status === "failed" && (
        <div style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>生成失败{job.error ? `：${job.error}` : ""}</div>
      )}

      {msg && (
        <div style={{
          fontSize: 13, padding: "6px 10px", borderRadius: 6, marginBottom: 8,
          background: msg.startsWith("错误") ? "#fee2e2" : "#dcfce7",
          color: msg.startsWith("错误") ? C.red : C.green,
        }}>{msg}</div>
      )}

      {job.report && (
        <Report
          report={job.report}
          jobStatus={job.status}
          busy={busy}
          onSaveToPool={() => doAction("save-to-pool", "已存入题目池")}
          onUpload={() => doAction("upload", `已上传 ${job.report.totalSets} 套到正式题库`)}
          onDestroy={() => doAction("destroy")}
        />
      )}

      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setShowLog((v) => !v)}
          style={{
            background: "none", border: "1px solid " + C.bdr, borderRadius: 4,
            padding: "4px 10px", fontSize: 12, cursor: "pointer", color: C.t2, fontFamily: FONT,
          }}
        >{showLog ? "隐藏日志" : "查看日志"}</button>
      </div>

      {showLog && (
        <pre style={{
          marginTop: 8, background: "#0f172a", color: "#e2e8f0",
          padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto",
          maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {job.log || "(暂无日志)"}
        </pre>
      )}
    </div>
  );
}

export default function AdminGenerateBSPage() {
  const token = useAdminToken();
  const [jobs, setJobs] = useState([]);
  const [targetSets, setTargetSets] = useState(6);
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function loadJobs() {
    if (!token) return;
    try {
      const res = await fetch("/api/admin/generate-bs", { headers: authHeaders(token) });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      } else {
        setLoadError(`加载失败: ${res.status}`);
      }
    } catch (e) {
      setLoadError(e.message);
    }
  }

  useEffect(() => {
    if (token) loadJobs();
  }, [token]);

  async function startJob() {
    setStarting(true);
    try {
      const res = await fetch("/api/admin/generate-bs", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ targetSets }),
      });
      const data = await res.json();
      if (res.ok) {
        setJobs((prev) => [{ ...data, startedAt: new Date().toISOString(), log: "", logStats: {} }, ...prev]);
      } else {
        alert(`启动失败: ${data.error || res.status}`);
      }
    } catch (e) {
      alert(`请求错误: ${e.message}`);
    } finally {
      setStarting(false);
    }
  }

  function handleDestroyed(jobId) {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Link href="/admin" style={{ color: C.blue, fontSize: 13, textDecoration: "none", fontWeight: 700 }}>
            ← 返回管理后台
          </Link>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.nav, marginBottom: 4 }}>
            自动生成 Build Sentence 题目
          </div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 16 }}>
            选择套数，后台自动运行生成管道，完成后查看报告并选择处置方式。
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: C.t1 }}>套数：</label>
            <input
              type="number"
              min={1}
              max={20}
              value={targetSets}
              onChange={(e) => setTargetSets(Number(e.target.value))}
              style={{
                width: 70, padding: "6px 10px", border: "1px solid " + C.bdr,
                borderRadius: 6, fontSize: 14, fontFamily: FONT,
              }}
            />
            <button
              onClick={startJob}
              disabled={starting || !token}
              style={{
                background: starting ? "#9ca3af" : C.blue, color: "#fff", border: "none",
                borderRadius: 6, padding: "8px 20px", cursor: starting ? "not-allowed" : "pointer",
                fontFamily: FONT, fontSize: 14, fontWeight: 700,
              }}
            >
              {starting ? "启动中…" : "开始生成"}
            </button>
          </div>

          {!token && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>
              请先在 localStorage 中设置 adminToken
            </div>
          )}
        </div>

        {loadError && (
          <div style={{ background: "#fee2e2", color: C.red, padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {loadError}
          </div>
        )}

        {jobs.length === 0 && !loadError && (
          <div style={{ color: C.t3, fontSize: 13, textAlign: "center", padding: 32 }}>暂无任务记录</div>
        )}

        {jobs.map((job) => (
          <JobCard key={job.jobId} job={job} token={token} onDestroyed={handleDestroyed} />
        ))}
      </div>
    </div>
  );
}
