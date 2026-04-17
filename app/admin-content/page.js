"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminLayout from "../../components/admin/AdminLayout";
import {
  Card,
  StatCard,
  SectionCard,
  PageHeader,
  Skeleton,
  ShimmerCSS,
  EmptyState,
  Tabs,
  Badge,
  Button,
  InlineAlert,
  KV,
} from "../../components/admin/primitives";
import { callAdminApi, fmtDate, clip } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function formatBytes(n) {
  if (n == null) return "--";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function previewItem(item, meta) {
  if (!item) return "";
  const f = meta.previewField;
  if (f && item[f]) {
    const v = item[f];
    if (typeof v === "string") return clip(v, 120);
    if (typeof v === "object" && v.text) return clip(v.text, 120);
    if (typeof v === "object" && v.name) return clip(v.name, 80);
  }
  // Heuristic fallback for listening/reading shapes
  const fallback = item.prompt || item.topic || item.situation || item.passage || item.announcement || item.scenario;
  return fallback ? clip(String(fallback), 120) : JSON.stringify(item).slice(0, 100) + "...";
}

function ItemDetail({ item, meta }) {
  if (!item) return null;
  const entries = Object.entries(item).filter(([k]) => !k.startsWith("_"));
  return (
    <div>
      {entries.map(([k, v]) => {
        let display;
        if (v == null) display = <span style={{ color: C.t3 }}>null</span>;
        else if (typeof v === "string") display = <span style={{ whiteSpace: "pre-wrap" }}>{v}</span>;
        else if (typeof v === "number" || typeof v === "boolean") display = String(v);
        else display = <pre style={{ margin: 0, fontSize: 11, overflow: "auto", background: "#f8fafc", padding: 8, borderRadius: 6 }}>{JSON.stringify(v, null, 2)}</pre>;
        return <KV key={k} label={k} mono={k === meta.idField}>{display}</KV>;
      })}
    </div>
  );
}

function BankList({ activeKey, onSelectItem, selectedItemId, items, total, loading, error, meta }) {
  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={48} />)}
      </div>
    );
  }
  if (error) return <InlineAlert tone="error">{error}</InlineAlert>;
  if (!items || items.length === 0) return <EmptyState title="该题库为空" />;

  return (
    <div>
      <div style={{ fontSize: 12, color: C.t3, marginBottom: 8 }}>
        显示 {items.length} / {total} · 路径 <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>{meta.bankPath}</code>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
        {items.map((item) => {
          const id = String(item[meta.idField] ?? "");
          const isActive = String(selectedItemId) === id;
          return (
            <button
              key={id || Math.random()}
              onClick={() => onSelectItem(item)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid " + (isActive ? C.nav : C.bdr),
                background: isActive ? "#f1f5f9" : "#fff",
                cursor: "pointer",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: C.t3, minWidth: 80 }}>{id || "—"}</span>
              <span style={{ flex: 1, fontSize: 12, color: C.t1 }}>{previewItem(item, meta)}</span>
              {item._setId != null && <Badge color="#0891b2">Set {item._setId}</Badge>}
              {item.difficulty && <Badge color="#7c3aed">{item.difficulty}</Badge>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminContentPage() {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  const [activeKey, setActiveKey] = useState(null);
  const [bankData, setBankData] = useState(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState("");

  const [selectedItem, setSelectedItem] = useState(null);

  // Fetch summary
  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const data = await callAdminApi("/api/admin/content");
      setSummary(data);
      if (!activeKey && data?.groups?.[0]?.items?.[0]) {
        setActiveKey(data.groups[0].items[0].key);
      }
    } catch (e) {
      setSummaryError(e.message);
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(loadSummary, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch bank items when activeKey changes
  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    (async () => {
      setBankLoading(true);
      setBankError("");
      setSelectedItem(null);
      try {
        const data = await callAdminApi(`/api/admin/content?type=${encodeURIComponent(activeKey)}&limit=200`);
        if (!cancelled) setBankData(data);
      } catch (e) {
        if (!cancelled) setBankError(e.message);
      } finally {
        if (!cancelled) setBankLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeKey]);

  // Aggregate stats
  const totals = useMemo(() => {
    if (!summary?.groups) return null;
    let banks = 0;
    let questions = 0;
    let staged = 0;
    let readyGen = 0;
    for (const g of summary.groups) {
      for (const item of g.items) {
        banks++;
        questions += item.count || 0;
        staged += item.stagingCount || 0;
        if (item.hasGeneration) readyGen++;
      }
    }
    return { banks, questions, staged, readyGen };
  }, [summary]);

  const activeMeta = useMemo(() => {
    if (!summary?.groups) return null;
    for (const g of summary.groups) {
      for (const item of g.items) if (item.key === activeKey) return { ...item, groupLabel: g.label };
    }
    return null;
  }, [summary, activeKey]);

  return (
    <AdminLayout title="题库总览">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <ShimmerCSS />
        <PageHeader
          title="题库内容管理"
          subtitle="浏览所有题型的正式题库与生成中暂存，数据存储于仓库 /data 目录"
          right={<Button variant="secondary" onClick={loadSummary} disabled={summaryLoading}>
            {summaryLoading ? "加载中…" : "刷新"}
          </Button>}
        />

        {/* Top metrics */}
        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard value={totals?.banks ?? "--"} label="题库数量" />
          <StatCard value={totals?.questions ?? "--"} label="题目总数" color={C.blue} />
          <StatCard value={totals?.staged ?? "--"} label="待审核暂存" color={totals?.staged > 0 ? "#d97706" : C.t2} />
          <StatCard value={totals?.readyGen ?? "--"} label="已接通 AI 生成" color="#16a34a" />
        </div>

        {summaryError && <div style={{ marginBottom: 16 }}><InlineAlert tone="error">{summaryError}</InlineAlert></div>}

        {/* Group grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 20 }}>
          {summaryLoading ? (
            Array.from({ length: 4 }, (_, i) => <div key={i}><Skeleton height={160} /></div>)
          ) : (summary?.groups || []).map((g) => (
            <SectionCard key={g.key} title={g.label}>
              {g.items.map((item) => {
                const isActive = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveKey(item.key)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 7,
                      border: "1px solid " + (isActive ? C.nav : "transparent"),
                      background: isActive ? "#eff6ff" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 2,
                      textAlign: "left",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
                        {item.count} 题{item.stagingCount > 0 ? ` · 暂存 ${item.stagingCount}` : ""}
                      </div>
                    </div>
                    {item.hasGeneration ? <Badge color="#16a34a">AI</Badge> : <Badge color="#94a3b8">只读</Badge>}
                  </button>
                );
              })}
            </SectionCard>
          ))}
        </div>

        {/* Bank detail */}
        {activeMeta && (
          <SectionCard
            title={
              <span>
                <span style={{ color: C.t3, fontWeight: 500, marginRight: 6 }}>{activeMeta.groupLabel} /</span>
                <span>{activeMeta.label}</span>
              </span>
            }
            right={
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: C.t3 }}>
                {activeMeta.hasGeneration && (
                  <Link href={`/admin-generate`} style={{ color: C.blue, fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
                    生成 &rarr;
                  </Link>
                )}
                {activeMeta.stagingCount > 0 && (
                  <Link href={`/admin-staging?type=${activeMeta.key}`} style={{ color: "#d97706", fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
                    暂存 {activeMeta.stagingCount} 项 &rarr;
                  </Link>
                )}
                <span>{formatBytes(activeMeta.bankSize)} · 更新 {fmtDate(activeMeta.modifiedAt)}</span>
              </div>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 16 }}>
              <div>
                <BankList
                  activeKey={activeKey}
                  meta={bankData?.meta || activeMeta}
                  items={bankData?.items}
                  total={bankData?.total ?? 0}
                  loading={bankLoading}
                  error={bankError}
                  selectedItemId={selectedItem?.[bankData?.meta?.idField || "id"]}
                  onSelectItem={setSelectedItem}
                />
              </div>
              <div>
                <Card padding={14} style={{ background: "#fafbfc" }}>
                  {selectedItem ? (
                    <ItemDetail item={selectedItem} meta={bankData?.meta || activeMeta} />
                  ) : (
                    <EmptyState title="点击左侧查看题目详情" hint="题库为只读视图，编辑请修改对应 JSON 文件或使用 /admin-questions" />
                  )}
                </Card>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Footer links */}
        <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: C.t3 }}>
          <Link href="/admin-questions" style={{ color: C.blue, textDecoration: "none" }}>编辑写作题库 (学术 / 邮件 / BS)</Link>
          <span>·</span>
          <Link href="/admin-generate" style={{ color: C.blue, textDecoration: "none" }}>AI 自动生成</Link>
          <span>·</span>
          <Link href="/admin-staging" style={{ color: C.blue, textDecoration: "none" }}>暂存库审核</Link>
        </div>
      </div>
    </AdminLayout>
  );
}
