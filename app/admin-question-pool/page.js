"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { C, FONT } from "../../components/shared/ui";

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

function Badge({ color, children }) {
  const bg = { green: "#dcfce7", blue: "#dbeafe", gray: "#f3f4f6" };
  const text = { green: "#166534", blue: "#1e40af", gray: "#374151" };
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
    </div>
  );
}

function SetDetail({ set }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid " + C.bdr, borderRadius: 6, marginBottom: 6 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: "8px 12px", cursor: "pointer", fontFamily: FONT,
          fontSize: 13, fontWeight: 700, color: C.nav, display: "flex", justifyContent: "space-between",
        }}
      >
        <span>套题 #{set.set_id}（{set.questions?.length || 0} 题）</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          {(set.questions || []).map((q) => <QuestionDetail key={q.id} q={q} />)}
        </div>
      )}
    </div>
  );
}

function PoolEntryCard({ entry, token, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function doUpload() {
    if (!confirm(`确认将「${entry.setCount} 套 / ${entry.questionCount} 题」上传到正式题库？此操作不可撤销。`)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/question-pool/${entry.id}/upload`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`上传成功：新增 ${data.addedSets} 套，套题编号 ${(data.newSetIds || []).join(", ")}`);
        setTimeout(() => onRemoved(entry.id), 1500);
      } else {
        setMsg(`上传失败: ${data.error || res.status}`);
      }
    } catch (e) {
      setMsg(`请求错误: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doDestroy() {
    if (!confirm("确认销毁此条目？")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/question-pool/${entry.id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      const data = await res.json();
      if (res.ok) {
        onRemoved(entry.id);
      } else {
        setMsg(`删除失败: ${data.error || res.status}`);
        setBusy(false);
      }
    } catch (e) {
      setMsg(`请求错误: ${e.message}`);
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 15, color: C.nav, marginRight: 10 }}>
            {entry.setCount} 套 / {entry.questionCount} 题
          </span>
          <Badge color="blue">池中待用</Badge>
        </div>
        <div style={{ fontSize: 11, color: C.t3 }}>
          {new Date(entry.savedAt).toLocaleString("zh-CN")}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>
        来源任务: <code style={{ fontSize: 11 }}>{entry.sourceJobId}</code>
      </div>

      {msg && (
        <div style={{
          fontSize: 13, padding: "6px 10px", borderRadius: 6, marginBottom: 8,
          background: msg.includes("失败") || msg.includes("错误") ? "#fee2e2" : "#dcfce7",
          color: msg.includes("失败") || msg.includes("错误") ? C.red : C.green,
        }}>{msg}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          onClick={doUpload}
          disabled={busy}
          style={{
            background: C.green, color: "#fff", border: "none", borderRadius: 6,
            padding: "7px 14px", cursor: busy ? "not-allowed" : "pointer",
            fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
          }}
        >上传到正式题库</button>
        <button
          onClick={doDestroy}
          disabled={busy}
          style={{
            background: C.red, color: "#fff", border: "none", borderRadius: 6,
            padding: "7px 14px", cursor: busy ? "not-allowed" : "pointer",
            fontFamily: FONT, fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
          }}
        >销毁</button>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "none", border: "1px solid " + C.bdr, borderRadius: 6,
            padding: "7px 14px", cursor: "pointer", color: C.t2, fontFamily: FONT, fontSize: 13,
          }}
        >{open ? "收起详情" : "展开详情"}</button>
      </div>

      {open && (
        <div>
          {(entry.sets || []).map((s) => <SetDetail key={s.set_id} set={s} />)}
        </div>
      )}
    </div>
  );
}

export default function AdminQuestionPoolPage() {
  const token = useAdminToken();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadPool() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/question-pool", { headers: authHeaders(token) });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      } else {
        setError(`加载失败: ${res.status}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadPool();
  }, [token]);

  function handleRemoved(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
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
          <div style={{ fontSize: 22, fontWeight: 800, color: C.nav, marginBottom: 4 }}>题目池</div>
          <div style={{ fontSize: 13, color: C.t2 }}>
            已生成但尚未入库的题目集合。可选择上传到正式题库或销毁。
          </div>
        </div>

        {!token && (
          <div style={{ background: "#fee2e2", color: C.red, padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            请先在 localStorage 中设置 adminToken
          </div>
        )}

        {loading && (
          <div style={{ color: C.t3, fontSize: 13, textAlign: "center", padding: 32 }}>加载中…</div>
        )}

        {error && (
          <div style={{ background: "#fee2e2", color: C.red, padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div style={{ color: C.t3, fontSize: 13, textAlign: "center", padding: 32 }}>题目池为空</div>
        )}

        {entries.map((entry) => (
          <PoolEntryCard key={entry.id} entry={entry} token={token} onRemoved={handleRemoved} />
        ))}
      </div>
    </div>
  );
}
