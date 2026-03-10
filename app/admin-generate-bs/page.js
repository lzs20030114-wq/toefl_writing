"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { C, FONT } from "../../components/shared/ui";

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

function elapsed(startIso, endIso) {
  if (!startIso) return "-";
  const ms = (endIso ? new Date(endIso) : new Date()) - new Date(startIso);
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function StatusBadge({ status, conclusion }) {
  const map = {
    queued:      ["#fef3c7", "#92400e", "排队中"],
    in_progress: ["#dbeafe", "#1e40af", "生成中…"],
    completed:   conclusion === "success"
      ? ["#dcfce7", "#166534", "✓ 完成"]
      : ["#fee2e2", "#991b1b", "失败"],
  };
  const [bg, color, label] = map[status] || ["#f3f4f6", "#374151", status];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 12,
      background: bg, color, fontSize: 12, fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function RunCard({ run: initial, token }) {
  const [run, setRun] = useState(initial);
  const timerRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/generate-bs/${run.id}`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = await res.json();
        setRun(data);
        if (data.status === "completed") clearInterval(timerRef.current);
      }
    } catch (_) {}
  }, [run.id, token]);

  useEffect(() => {
    setRun(initial);
  }, [initial]);

  useEffect(() => {
    if (run.status !== "completed") {
      timerRef.current = setInterval(poll, POLL_INTERVAL);
      return () => clearInterval(timerRef.current);
    }
  }, [run.status, poll]);

  const targetSets = run.inputs?.target_sets || "-";
  const isDone = run.status === "completed";
  const isSuccess = isDone && run.conclusion === "success";
  const isFail = isDone && run.conclusion !== "success";

  return (
    <div style={{
      background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8,
      padding: 16, marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={run.status} conclusion={run.conclusion} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>
            目标 {targetSets} 套
          </span>
        </div>
        <span style={{ fontSize: 12, color: C.t3 }}>{timeAgo(run.createdAt)}</span>
      </div>

      <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>
        耗时：{elapsed(run.createdAt, isDone ? run.updatedAt : null)}
        {!isDone && <span style={{ marginLeft: 8, color: C.orange }}>每 5 秒自动刷新</span>}
      </div>

      {isSuccess && (
        <div style={{
          background: "#dcfce7", color: "#166534", padding: "8px 12px",
          borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 8,
        }}>
          题库已更新，Vercel 正在自动重新部署新题目，约 1～2 分钟后生效。
        </div>
      )}

      {isFail && (
        <div style={{
          background: "#fee2e2", color: "#991b1b", padding: "8px 12px",
          borderRadius: 6, fontSize: 13, marginBottom: 8,
        }}>
          生成失败，请查看日志了解详情。
        </div>
      )}

      <a
        href={run.htmlUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 13, color: C.blue, textDecoration: "none", fontWeight: 600 }}
      >
        在 GitHub 查看详细日志 →
      </a>
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
    } catch (e) {
      setLoadError(e.message);
    }
  }

  useEffect(() => {
    if (token) loadRuns(token);
  }, [token]);

  async function trigger() {
    setTriggering(true);
    setTriggerMsg("");
    try {
      const res = await fetch("/api/admin/generate-bs", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ targetSets }),
      });
      const data = await res.json();
      if (res.ok) {
        setTriggerMsg("已触发，GitHub Actions 正在启动，稍后刷新可看到任务…");
        setTimeout(() => loadRuns(), 4000);
      } else {
        setTriggerMsg(`错误：${data.error || res.status}`);
      }
    } catch (e) {
      setTriggerMsg(`请求失败：${e.message}`);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        <div style={{ marginBottom: 14 }}>
          <Link href="/admin" style={{ color: C.blue, fontSize: 13, textDecoration: "none", fontWeight: 700 }}>
            ← 返回管理后台
          </Link>
        </div>

        {/* 配置区 */}
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.nav, marginBottom: 4 }}>
            自动生成题目
          </div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 14 }}>
            在 GitHub Actions 上运行生成脚本（可运行 3 小时），完成后自动更新题库并触发 Vercel 重新部署。
          </div>

          <input
            value={token}
            onChange={(e) => persistToken(e.target.value)}
            placeholder="ADMIN_DASHBOARD_TOKEN"
            style={{
              width: "100%", boxSizing: "border-box", border: "1px solid " + C.bdr,
              borderRadius: 6, padding: "8px 10px", fontFamily: "monospace",
              fontSize: 12, marginBottom: 12,
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: C.t1, whiteSpace: "nowrap" }}>
              套数：
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={targetSets}
              onChange={(e) => setTargetSets(Number(e.target.value))}
              style={{
                width: 70, padding: "7px 10px", border: "1px solid " + C.bdr,
                borderRadius: 6, fontSize: 14, fontFamily: FONT,
              }}
            />
            <button
              onClick={trigger}
              disabled={triggering || !token}
              style={{
                background: triggering || !token ? "#9ca3af" : C.blue,
                color: "#fff", border: "none", borderRadius: 6,
                padding: "8px 20px", cursor: triggering || !token ? "not-allowed" : "pointer",
                fontFamily: FONT, fontSize: 14, fontWeight: 700,
              }}
            >
              {triggering ? "触发中…" : "开始生成"}
            </button>
            <button
              onClick={() => loadRuns()}
              disabled={!token}
              style={{
                background: "none", border: "1px solid " + C.bdr, borderRadius: 6,
                padding: "8px 14px", cursor: "pointer", color: C.t2,
                fontFamily: FONT, fontSize: 13,
              }}
            >
              刷新列表
            </button>
          </div>

          {triggerMsg && (
            <div style={{
              marginTop: 10, fontSize: 13, padding: "7px 10px", borderRadius: 6,
              background: triggerMsg.startsWith("错误") || triggerMsg.startsWith("请求") ? "#fee2e2" : "#dbeafe",
              color: triggerMsg.startsWith("错误") || triggerMsg.startsWith("请求") ? C.red : "#1e40af",
            }}>
              {triggerMsg}
            </div>
          )}
        </div>

        {/* 错误 */}
        {loadError && (
          <div style={{
            background: "#fee2e2", color: C.red, padding: "10px 14px",
            borderRadius: 6, fontSize: 13, marginBottom: 12,
          }}>
            {loadError}
            {loadError.includes("GH_PAT") && (
              <div style={{ marginTop: 6, fontWeight: 600 }}>
                请在 Vercel 环境变量中配置 GH_PAT（GitHub Personal Access Token）
              </div>
            )}
          </div>
        )}

        {/* 任务列表 */}
        {runs.length === 0 && !loadError && token && (
          <div style={{ textAlign: "center", color: C.t3, fontSize: 13, padding: 32 }}>
            暂无任务记录
          </div>
        )}

        {runs.map((run) => (
          <RunCard key={run.id} run={run} token={token} />
        ))}
      </div>
    </div>
  );
}
