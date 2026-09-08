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

const SUBTYPE_ORDER = {
  writing: ["build", "email", "discussion"],
  reading: ["ctw", "rdl", "ap"],
  listening: ["lcr", "la", "lc", "lat"],
  speaking: ["interview", "repeat"],
};

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
  const s = String(scoreText || "");
  if (s.includes("评分失败")) return "#b45309";
  const lower = s.toLowerCase();
  if (lower.includes("correct") && !lower.includes("incorrect")) return "#15803d";
  if (lower.includes("incorrect")) return "#b91c1c";
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

function groupBySubtype(items, subjectKey) {
  const order = SUBTYPE_ORDER[subjectKey] || [];
  const out = {};
  for (const st of order) out[st] = [];
  for (const a of items || []) {
    const st = a?.subtype;
    if (st && out[st]) out[st].push(a);
  }
  return out;
}

const REAL_CHIP = { bg: "#fef3c7", fg: "#92400e", bdr: "#f59e0b" };

function RealChip({ title }) {
  return (
    <span
      title={title || "该作答来自真题专区 /real-bank"}
      style={{
        background: REAL_CHIP.bg,
        color: REAL_CHIP.fg,
        border: "1px solid " + REAL_CHIP.bdr,
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: "16px",
      }}
    >
      真题
    </span>
  );
}

function ChipBadge({ subject, subtype, fromMock, real }) {
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
      {real ? <RealChip /> : null}
    </span>
  );
}

function WritingAttemptCard({ a }) {
  return (
    <div style={{ borderBottom: "1px solid #f1f5f9", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, alignItems: "center" }}>
        <ChipBadge subject="writing" subtype={a.subtype} fromMock={a.fromMock} real={a.real} />
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
      <ChipBadge subject={a.subject} subtype={a.subtype} real={a.real} />
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
      <ChipBadge subject="speaking" subtype={a.subtype} real={a.real} />
      <div style={{ color: C.t1 }}>{a.topic || subtypeChip("speaking", a.subtype).long}</div>
    </div>
  );
}

const REAL_RANGE_OPTIONS = [
  { value: 7, label: "7天" },
  { value: 30, label: "30天" },
  { value: 90, label: "90天" },
  { value: 0, label: "全部" },
];

function RealStatCard({ value, label, sub, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.nav, lineHeight: 1.1 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{label}</div>
      {sub ? <div style={{ fontSize: 11, color: C.t3 || C.t2, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function RealDailyBars({ data }) {
  const list = Array.isArray(data) ? data : [];
  if (list.length === 0) return <div style={{ color: C.t2, fontSize: 12 }}>暂无数据</div>;
  const max = Math.max(...list.map((d) => safeNum(d.count)), 1);
  const height = 72;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height, padding: "0 2px" }}>
      {list.map((d) => {
        const n = safeNum(d.count);
        const h = n > 0 ? Math.max((n / max) * (height - 14), 3) : 1;
        return (
          <div key={d.date} title={`${d.date}: ${n} 场真题练习`} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 9, color: C.t2, marginBottom: 1 }}>{n || ""}</div>
            <div style={{ width: "100%", maxWidth: 22, height: h, borderRadius: "3px 3px 0 0", background: n > 0 ? REAL_CHIP.bdr : "#e2e8f0" }} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 「真题板块」：真题专区（/real-bank）的全站练习统计，数据来自 /api/admin/real-bank。
 * 场次口径 = sessions 表一条记录（与下方按登录码的「场次」同口径），真题判定见 lib/admin/realSession.js。
 */
function RealBankPanel({ callAdminApi, hasToken }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  async function load(d) {
    if (!hasToken) return;
    setLoading(true);
    setError("");
    try {
      const body = await callAdminApi(`/api/admin/real-bank?days=${d}`, { method: "GET" });
      setData(body);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasToken) load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken]);

  function changeDays(d) {
    setDays(d);
    load(d);
  }

  const subtypes = (data?.subtypes || []).filter((x) => SUBTYPE_LABEL[x.subject]?.[x.subtype]);
  const activeSubtypes = subtypes.filter((x) => safeNum(x.sessions) > 0);
  const rangeLabel = days === 0 ? "全部时间" : `近 ${days} 天`;

  return (
    <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderTop: "3px solid " + REAL_CHIP.bdr, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: open ? 10 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, color: C.nav }}>真题专区练习统计</div>
          <RealChip title="真题专区 /real-bank 的练习记录" />
          <div style={{ fontSize: 11, color: C.t2 }}>
            {loading ? "加载中..." : error ? <span style={{ color: C.red || "#b91c1c" }}>{error}</span> : data ? `${rangeLabel} · 全站 ${safeNum(data.allSessions)} 场练习里有 ${safeNum(data.realSessions)} 场是真题` : "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {REAL_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => changeDays(opt.value)}
              disabled={loading}
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: days === opt.value ? 700 : 500,
                border: "1px solid " + (days === opt.value ? REAL_CHIP.bdr : C.bdr),
                background: days === opt.value ? REAL_CHIP.bg : "#fff",
                color: days === opt.value ? REAL_CHIP.fg : C.t2,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ border: "1px solid " + C.bdr, background: "#fff", color: C.t2, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}
          >
            {open ? "收起" : "展开"}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <RealStatCard value={data?.realSessions} label="真题练习场次" sub={data?.realSharePct != null ? `占全部练习 ${data.realSharePct}%` : rangeLabel} color={REAL_CHIP.fg} />
            <RealStatCard value={data?.realUsers} label="练过真题的用户" sub={data?.userSharePct != null ? `占活跃用户 ${data.userSharePct}%（活跃 ${safeNum(data?.allUsers)} 人）` : ""} color="#16a34a" />
            <RealStatCard value={data?.accuracyPct != null ? `${data.accuracyPct}%` : "—"} label="客观题正确率" sub="造句 / 阅读 / 听力真题合计（按题数）" color={C.blue} />
            <RealStatCard value={activeSubtypes.length} label="有人练过的真题题型" sub={`共 ${subtypes.length} 种题型上线`} color={C.nav} />
          </div>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.nav, marginBottom: 6 }}>每日真题练习场次</div>
            {loading && !data ? <div style={{ height: 72, background: "#f8fafc", borderRadius: 6 }} /> : <RealDailyBars data={data?.daily} />}
          </div>

          <div className="adm-grid-2" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 12 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 12, fontWeight: 700, color: C.nav }}>分题型</div>
              <div className="adm-table-wrap" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr style={{ color: C.t2 }}>
                      <th style={{ textAlign: "left", padding: "6px 12px", borderBottom: "1px solid #f1f5f9" }}>题型</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>场次</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>人数</th>
                      <th style={{ textAlign: "right", padding: "6px 12px", borderBottom: "1px solid #f1f5f9" }}>正确率 / 均分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subtypes.map((x) => {
                      const meta = subtypeChip(x.subject, x.subtype);
                      const empty = safeNum(x.sessions) === 0;
                      const scoreCell = x.accuracyPct != null
                        ? <span style={{ color: pctColor(x.accuracyPct), fontWeight: 700 }}>{x.accuracyPct}% <span style={{ fontSize: 11, fontWeight: 400, color: C.t2 }}>({x.correct}/{x.total})</span></span>
                        : x.avgScore != null
                          ? <span style={{ color: C.nav, fontWeight: 700 }}>{x.avgScore}<span style={{ fontSize: 11, fontWeight: 400, color: C.t2 }}> / 5 均分</span></span>
                          : <span style={{ color: C.t2 }}>—</span>;
                      return (
                        <tr key={`${x.subject}.${x.subtype}`} style={{ opacity: empty ? 0.5 : 1 }}>
                          <td style={{ padding: "6px 12px", borderBottom: "1px solid #f1f5f9" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <ChipBadge subject={x.subject} subtype={x.subtype} />
                              <span style={{ color: C.t1 }}>{meta.long}</span>
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: empty ? 400 : 700, color: subjectCellColor(safeNum(x.sessions)) }}>{safeNum(x.sessions) || "—"}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", color: subjectCellColor(safeNum(x.users)) }}>{safeNum(x.users) || "—"}</td>
                          <td style={{ padding: "6px 12px", borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{empty ? <span style={{ color: C.t2 }}>—</span> : scoreCell}</td>
                        </tr>
                      );
                    })}
                    {subtypes.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 12, color: C.t2 }}>{loading ? "加载中..." : "暂无数据"}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 12, fontWeight: 700, color: C.nav }}>最常练的真题 Top 10</div>
              {(data?.topItems || []).length === 0 ? (
                <div style={{ padding: 12, color: C.t2, fontSize: 12 }}>{loading ? "加载中..." : "暂无数据"}</div>
              ) : (data.topItems || []).map((it, i) => (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: i > 0 ? "1px solid #f1f5f9" : "none", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: i < 3 ? REAL_CHIP.bdr : "#e2e8f0", color: i < 3 ? "#fff" : C.t2, flexShrink: 0 }}>{i + 1}</span>
                    <ChipBadge subject={it.subject} subtype={it.subtype} />
                    <span title={it.id} style={{ fontFamily: "monospace", color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.id}</span>
                  </div>
                  <span style={{ color: C.nav, fontWeight: 700, flexShrink: 0 }}>{it.sessions} 场 <span style={{ fontSize: 11, fontWeight: 400, color: C.t2 }}>· {it.users} 人</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
  const [subtypeOpenByCode, setSubtypeOpenByCode] = useState({});

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
      setSubtypeOpenByCode({});
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

  function toggleSubtype(code, subjectKey, subtype) {
    const key = `${subjectKey}.${subtype}`;
    setSubtypeOpenByCode((prev) => {
      const cur = prev[code] || {};
      return { ...prev, [code]: { ...cur, [key]: !cur[key] } };
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

        <RealBankPanel callAdminApi={callAdminApi} hasToken={ready && hasToken} />

        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>按登录码查看作答（默认折叠）</div>
          <div style={{ fontSize: 11, color: C.t2, marginBottom: 10 }}>
            写作/阅读/听力/口语 = 该用户在各科目下完成的题目数；真题 = 其中来自真题专区的场次；展开查看分题型详情（真题作答带「真题」标签）。
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
                  <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }} title="来自真题专区 /real-bank 的场次">真题</th>
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
                  const realSessions = safeNum(usage?.realSessions, 0);
                  const realTip = realSessions > 0
                    ? SUBJECTS.map((sub) => `${sub.label} ${safeNum(usage?.answeredReal?.[sub.key]?.total, 0)}`).join(" · ")
                    : "";
                  const total = totalActivity(usage);
                  const isOpen = !!expanded[code];
                  const activity = activityByCode[code];
                  const loading = !!activityLoadingByCode[code];
                  const error = activityErrorByCode[code];
                  const sectionMap = sectionOpenByCode[code] || { writing: false, reading: false, listening: false, speaking: false };
                  const subtypeMap = subtypeOpenByCode[code] || {};
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
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: realSessions > 0 ? 700 : 400, color: realSessions > 0 ? REAL_CHIP.fg : C.t2 }} title={realTip}>{realSessions || "—"}</td>
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
                          <td colSpan={10} style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            {loading && <div style={{ color: C.t2 }}>正在加载详情...</div>}
                            {!loading && error && <div style={{ color: C.red }}>{error}</div>}
                            {!loading && !error && activity && (
                              <div style={{ display: "grid", gap: 8 }}>
                                {SUBJECTS.map((sub) => {
                                  const items = grouped[sub.key] || [];
                                  const itemsBySubtype = groupBySubtype(items, sub.key);
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
                                          borderBottom: open ? "1px solid #e2e8f0" : "none",
                                          background: "#f8fafc",
                                          borderTopLeftRadius: 6,
                                          borderTopRightRadius: 6,
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                          <div style={{ fontWeight: 700, color: C.nav }}>{sub.label}</div>
                                          <div style={{ fontSize: 11, color: C.t2 }}>
                                            {isSpeakingPlaceholder ? "待上线" : `${items.length} 条记录`}
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
                                        <div style={{ display: "grid", gap: 0 }}>
                                          {(SUBTYPE_ORDER[sub.key] || []).map((st) => {
                                            const stItems = itemsBySubtype[st] || [];
                                            const stKey = `${sub.key}.${st}`;
                                            const stOpen = !!subtypeMap[stKey];
                                            const stMeta = subtypeChip(sub.key, st);
                                            const stEmpty = stItems.length === 0;
                                            return (
                                              <div
                                                key={st}
                                                style={{
                                                  borderTop: "1px solid #f1f5f9",
                                                  opacity: stEmpty ? 0.55 : 1,
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    padding: "6px 12px 6px 18px",
                                                    background: stOpen ? "#f8fafc" : "#fff",
                                                    cursor: stEmpty ? "default" : "pointer",
                                                  }}
                                                  onClick={() => { if (!stEmpty) toggleSubtype(code, sub.key, st); }}
                                                >
                                                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                                                    <ChipBadge subject={sub.key} subtype={st} />
                                                    <span style={{ color: C.t1 }}>{stMeta.long}</span>
                                                    <span style={{ color: C.t2, fontSize: 11 }}>{stItems.length} 条</span>
                                                  </div>
                                                  {!stEmpty ? (
                                                    <span
                                                      aria-hidden
                                                      style={{
                                                        color: C.blue,
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        userSelect: "none",
                                                      }}
                                                    >
                                                      {stOpen ? "收起 ▲" : "展开 ▼"}
                                                    </span>
                                                  ) : null}
                                                </div>
                                                {stOpen && !stEmpty && (
                                                  <div style={{ maxHeight: 320, overflow: "auto", borderTop: "1px solid #f1f5f9" }}>
                                                    {sub.key === "writing"
                                                      ? stItems.map((a) => <WritingAttemptCard key={a.id} a={a} />)
                                                      : sub.key === "speaking"
                                                        ? stItems.map((a) => <SpeakingRow key={a.id} a={a} />)
                                                        : stItems.map((a) => <ReadingListeningRow key={a.id} a={a} />)}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
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
                    <td colSpan={10} style={{ padding: 12, color: C.t2 }}>暂无数据。</td>
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
