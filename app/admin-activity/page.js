"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { C, FONT } from "../../components/shared/ui";
import AdminLayout from "../../components/admin/AdminLayout";

const TOKEN_KEY = "toefl-admin-token";

const SUBJECTS = [
  { key: "writing", label: "写作" },
  { key: "reading", label: "阅读" },
  { key: "listening", label: "听力" },
  { key: "speaking", label: "口语" },
];

const SUBTYPE_LABEL = {
  writing: {
    build: { short: "BS", long: "Build Sentence" },
    email: { short: "Email", long: "Email Writing" },
    discussion: { short: "Discussion", long: "Academic Discussion" },
  },
  reading: {
    ctw: { short: "CTW", long: "Complete the Words" },
    rdl: { short: "RDL", long: "Read in Daily Life" },
    ap: { short: "AP", long: "Academic Passage" },
  },
  listening: {
    lcr: { short: "LCR", long: "Choose a Response" },
    la: { short: "LA", long: "Announcement" },
    lc: { short: "LC", long: "Conversation" },
    lat: { short: "LAT", long: "Academic Talk" },
  },
  speaking: {
    interview: { short: "Interview", long: "Interview" },
    repeat: { short: "Repeat", long: "Repeat" },
  },
};

const SUBTYPE_CHIP_STYLE = {
  writing: { bg: "#eff6ff", fg: "#1d4ed8" },
  reading: { bg: "#ecfdf5", fg: "#065f46" },
  listening: { bg: "#fef3c7", fg: "#92400e" },
  speaking: { bg: "#fce7f3", fg: "#9d174d" },
};

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function fmtRelative(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  return d.toLocaleDateString();
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function previewText(v, max = 180) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (!s) return "-";
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function fullText(v) {
  const s = String(v || "").trim();
  return s || "-";
}

function subjectTotal(usage, subjectKey) {
  return safeNum(usage?.answered?.[subjectKey]?.total, 0);
}

function totalActivity(usage) {
  return SUBJECTS.reduce((s, x) => s + subjectTotal(usage, x.key), 0);
}

function subjectCellColor(n) {
  return n > 0 ? C.nav : C.t2;
}

function subtypeChip(subject, subtype) {
  const meta = SUBTYPE_LABEL[subject]?.[subtype];
  if (!meta) return { short: subtype || "?", long: subtype || "?" };
  return meta;
}

function pctColor(pct) {
  if (pct == null) return C.t2;
  if (pct >= 80) return "#15803d";
  if (pct >= 50) return "#b45309";
  return "#b91c1c";
}

function writingScoreColor(scoreText) {
  const s = String(scoreText || "").toLowerCase();
  if (s.includes("correct") && !s.includes("incorrect")) return "#15803d";
  if (s.includes("incorrect")) return "#b91c1c";
  if (s.includes("pending")) return "#b45309";
  return C.nav;
}

function groupAttemptsBySubject(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const out = { writing: [], reading: [], listening: [], speaking: [] };
  for (const a of list) {
    const subject = a?.subject;
    if (subject && out[subject]) out[subject].push(a);
  }
  return out;
}

function ChipBadge({ subject, subtype, fromMock }) {
  const { short, long } = subtypeChip(subject, subtype);
  const palette = SUBTYPE_CHIP_STYLE[subject] || SUBTYPE_CHIP_STYLE.writing;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        title={long}
        style={{
          background: palette.bg,
          color: palette.fg,
          borderRadius: 4,
          padding: "1px 6px",
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {short}
      </span>
      {fromMock ? (
        <span
          title="该作答来自 Mock 模考"
          style={{
            background: "#f1f5f9",
            color: "#475569",
            borderRadius: 4,
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          Mock源
        </span>
      ) : null}
    </span>
  );
}

function WritingAttemptCard({ a }) {
  return (
    <div style={{ borderBottom: "1px solid #f1f5f9", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, alignItems: "center" }}>
        <ChipBadge subject="writing" subtype={a.subtype} fromMock={a.fromMock} />
        <div style={{ color: writingScoreColor(a.scoreText), fontWeight: 700, fontSize: 12 }}>{a.scoreText || "-"}</div>
      </div>
      <div style={{ fontSize: 11, color: C.t2, marginBottom: 6 }}>{fmtDate(a.date)}</div>
      <div style={{ fontSize: 12, color: C.t1, marginBottom: 4 }}>
        <b>题干:</b> {previewText(a.prompt, 260)}
      </div>
      <div style={{ fontSize: 12, color: C.t1, marginBottom: 4 }}>
        <b>作答:</b>
        <div style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {fullText(a.answer)}
        </div>
      </div>
      {a.correctAnswer ? (
        <div style={{ fontSize: 12, color: C.t2 }}>
          <b>参考答案:</b> {previewText(a.correctAnswer, 260)}
        </div>
      ) : null}
    </div>
  );
}

function ReadingListeningRow({ a }) {
  const color = pctColor(a.pct);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, max-content) auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        borderBottom: "1px solid #f1f5f9",
        fontSize: 12,
      }}
    >
      <div style={{ color: C.t2 }}>{fmtDate(a.date)}</div>
      <ChipBadge subject={a.subject} subtype={a.subtype} />
      <div style={{ color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {a.topic || subtypeChip(a.subject, a.subtype).long}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color, fontWeight: 700 }}>
        <span>{a.scoreText || "-"}</span>
        {a.pct != null ? <span style={{ fontSize: 11, color }}>· {a.pct}%</span> : null}
      </div>
    </div>
  );
}

function SpeakingRow({ a }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, max-content) auto 1fr",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        borderBottom: "1px solid #f1f5f9",
        fontSize: 12,
      }}
    >
      <div style={{ color: C.t2 }}>{fmtDate(a.date)}</div>
      <ChipBadge subject="speaking" subtype={a.subtype} />
      <div style={{ color: C.t1 }}>{a.topic || subtypeChip("speaking", a.subtype).long}</div>
    </div>
  );
}

export default function AdminActivityPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [usageByCode, setUsageByCode] = useState({});
  const [statusFilter, setStatusFilter] = useState("issued");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [activityByCode, setActivityByCode] = useState({});
  const [activityLoadingByCode, setActivityLoadingByCode] = useState({});
  const [activityErrorByCode, setActivityErrorByCode] = useState({});
  const [sectionOpenByCode, setSectionOpenByCode] = useState({});

  useEffect(() => {
    try {
      setToken(localStorage.getItem(TOKEN_KEY) || "");
    } catch {
      // no-op
    } finally {
      setReady(true);
    }
  }, []);

  const hasToken = token.trim().length > 0;

  function persistToken(v) {
    setToken(v);
    try {
      localStorage.setItem(TOKEN_KEY, v);
    } catch {
      // no-op
    }
  }

  async function callAdminApi(path, options = {}) {
    if (!token.trim()) {
      throw new Error("缺少管理员口令，请先输入 ADMIN_DASHBOARD_TOKEN。");
    }
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token.trim(),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
  }

  async function refresh() {
    if (!hasToken) return;
    setBusy(true);
    setMsg("");
    try {
      const q = statusFilter
        ? `?status=${encodeURIComponent(statusFilter)}&limit=200&includeUsage=1`
        : "?limit=200&includeUsage=1";
      const body = await callAdminApi(`/api/admin/codes${q}`, { method: "GET" });
      setRows(Array.isArray(body.codes) ? body.codes : []);
      setUsageByCode(body.usageByCode || {});
      setExpanded({});
      setActivityByCode({});
      setActivityLoadingByCode({});
      setActivityErrorByCode({});
      setSectionOpenByCode({});
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchCodeActivity(code) {
    setActivityLoadingByCode((prev) => ({ ...prev, [code]: true }));
    setActivityErrorByCode((prev) => ({ ...prev, [code]: "" }));
    try {
      const body = await callAdminApi(
        `/api/admin/codes/${encodeURIComponent(code)}/activity?limit=200&attemptLimit=800`,
        { method: "GET" }
      );
      setActivityByCode((prev) => ({ ...prev, [code]: body }));
    } catch (e) {
      setActivityErrorByCode((prev) => ({ ...prev, [code]: String(e.message || e) }));
    } finally {
      setActivityLoadingByCode((prev) => ({ ...prev, [code]: false }));
    }
  }

  function toggleExpand(code) {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
    if (!activityByCode[code] && !activityLoadingByCode[code]) {
      setSectionOpenByCode((prev) => ({
        ...prev,
        [code]: { writing: true, reading: false, listening: false, speaking: false },
      }));
      fetchCodeActivity(code);
    }
  }

  function toggleSection(code, section) {
    setSectionOpenByCode((prev) => {
      const cur = prev[code] || { writing: false, reading: false, listening: false, speaking: false };
      return { ...prev, [code]: { ...cur, [section]: !cur[section] } };
    });
  }

  useEffect(() => {
    if (ready && hasToken) refresh();
  }, [ready, token, statusFilter]);

  const rowsView = useMemo(
    () => rows.filter((r) => !(r.issued_to === "pre-generated" && usageByCode[r.code]?.userStatus === "pending")).slice(0, 200),
    [rows, usageByCode]
  );

  return (
    <AdminLayout title="答题情况">
      <div className="adm-page" style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.nav }}>用户答题情况</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/admin-codes" style={{ color: C.blue, textDecoration: "none", fontSize: 13 }}>去登录码管理</Link>
            </div>
          </div>
          <div className="adm-ctrl-row" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
            <input
              value={token}
              onChange={(e) => persistToken(e.target.value)}
              placeholder="ADMIN_DASHBOARD_TOKEN"
              className="adm-input-full"
              style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px" }}>
              <option value="">全部状态</option>
              <option value="issued">仅已发放</option>
              <option value="available">仅可发放</option>
              <option value="revoked">仅已吊销</option>
            </select>
            <button onClick={refresh} disabled={busy} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 10px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              刷新
            </button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>按登录码查看作答（默认折叠）</div>
          <div style={{ fontSize: 11, color: C.t2, marginBottom: 10 }}>
            写作/阅读/听力/口语 = 该用户在各科目下完成的题目数；展开查看分题型详情。
          </div>
          <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: C.t2 }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>登录码</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0", minWidth: 120 }}>备注</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>写作</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>阅读</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>听力</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>口语</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>场次</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>最近</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>详情</th>
                </tr>
              </thead>
              <tbody>
                {rowsView.map((r) => {
                  const code = r.code;
                  const usage = usageByCode?.[code] || {};
                  const writingN = subjectTotal(usage, "writing");
                  const readingN = subjectTotal(usage, "reading");
                  const listeningN = subjectTotal(usage, "listening");
                  const speakingN = subjectTotal(usage, "speaking");
                  const sessions = safeNum(usage?.sessions, 0);
                  const total = totalActivity(usage);
                  const isOpen = !!expanded[code];
                  const activity = activityByCode[code];
                  const loading = !!activityLoadingByCode[code];
                  const error = activityErrorByCode[code];
                  const sectionMap = sectionOpenByCode[code] || { writing: false, reading: false, listening: false, speaking: false };
                  const grouped = groupAttemptsBySubject(activity?.attempts || []);

                  return (
                    <Fragment key={code}>
                      <tr>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace", fontWeight: 700 }}>{code}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", color: r.note ? C.nav : C.t2 }} title={r.issued_to ? `发放对象: ${r.issued_to}` : ""}>{r.note || (r.issued_to || "-")}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: writingN > 0 ? 700 : 400, color: subjectCellColor(writingN) }}>{writingN || "—"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: readingN > 0 ? 700 : 400, color: subjectCellColor(readingN) }}>{readingN || "—"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: listeningN > 0 ? 700 : 400, color: subjectCellColor(listeningN) }}>{listeningN || "—"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: speakingN > 0 ? 700 : 400, color: subjectCellColor(speakingN) }}>{speakingN || "—"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: sessions > 0 ? C.t1 : C.t2 }}>{sessions || "—"}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", color: C.t2 }} title={fmtDate(usage?.lastActiveAt)}>{fmtRelative(usage?.lastActiveAt)}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                          <button
                            onClick={() => toggleExpand(code)}
                            disabled={total === 0}
                            style={{
                              border: "1px solid " + (total === 0 ? "#cbd5e1" : C.blue),
                              background: total === 0 ? "#f8fafc" : (isOpen ? "#dbeafe" : "#fff"),
                              color: total === 0 ? C.t2 : C.blue,
                              borderRadius: 6,
                              padding: "4px 8px",
                              cursor: total === 0 ? "not-allowed" : "pointer",
                              fontSize: 12,
                            }}
                          >
                            {total === 0 ? "无作答" : (isOpen ? "收起" : "展开")}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            {loading && <div style={{ color: C.t2 }}>正在加载详情...</div>}
                            {!loading && error && <div style={{ color: C.red }}>{error}</div>}
                            {!loading && !error && activity && (
                              <div style={{ display: "grid", gap: 8 }}>
                                {SUBJECTS.map((sub) => {
                                  const items = grouped[sub.key] || [];
                                  const subjectN = subjectTotal(usage, sub.key);
                                  const open = !!sectionMap[sub.key];
                                  const isSpeakingPlaceholder = sub.key === "speaking" && subjectN === 0;
                                  return (
                                    <div
                                      key={sub.key}
                                      style={{
                                        border: "1px solid #e2e8f0",
                                        borderRadius: 6,
                                        background: "#fff",
                                        opacity: isSpeakingPlaceholder ? 0.6 : 1,
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          padding: "8px 10px",
                                          borderBottom: open ? "1px solid #f1f5f9" : "none",
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                          <div style={{ fontWeight: 700, color: C.nav }}>{sub.label}</div>
                                          <div style={{ fontSize: 11, color: C.t2 }}>
                                            {isSpeakingPlaceholder ? "待上线" : `${subjectN} 题 / ${items.length} 条记录`}
                                          </div>
                                        </div>
                                        {!isSpeakingPlaceholder && items.length > 0 ? (
                                          <button
                                            onClick={() => toggleSection(code, sub.key)}
                                            style={{
                                              border: "1px solid " + C.blue,
                                              background: open ? "#dbeafe" : "#fff",
                                              color: C.blue,
                                              borderRadius: 6,
                                              padding: "3px 8px",
                                              cursor: "pointer",
                                              fontSize: 12,
                                            }}
                                          >
                                            {open ? "收起" : "展开"}
                                          </button>
                                        ) : null}
                                      </div>
                                      {open && !isSpeakingPlaceholder && (
                                        <div style={{ maxHeight: 360, overflow: "auto" }}>
                                          {items.length === 0 ? (
                                            <div style={{ padding: 12, color: C.t2, fontSize: 12 }}>暂无记录。</div>
                                          ) : sub.key === "writing" ? (
                                            items.map((a) => <WritingAttemptCard key={a.id} a={a} />)
                                          ) : sub.key === "speaking" ? (
                                            items.map((a) => <SpeakingRow key={a.id} a={a} />)
                                          ) : (
                                            items.map((a) => <ReadingListeningRow key={a.id} a={a} />)
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rowsView.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 12, color: C.t2 }}>暂无数据。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {msg ? (
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 10, fontSize: 12, color: "#9a3412" }}>
            {msg}
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
