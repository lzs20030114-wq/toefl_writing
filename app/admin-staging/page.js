"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminLayout from "../../components/admin/AdminLayout";
import {
  StatCard,
  SectionCard,
  PageHeader,
  Skeleton,
  ShimmerCSS,
  EmptyState,
  Badge,
  Button,
  InlineAlert,
  Card,
} from "../../components/admin/primitives";
import { callAdminApi, fmtDate, relativeTime } from "../../lib/adminHelpers";
import { C } from "../../components/shared/ui";

function formatBytes(n) {
  if (n == null) return "--";
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

// Map content key → generate task key for the existing /api/admin/staging/[runId] API.
// Only types hooked up to the GitHub Actions workflow can be deployed via this admin flow.
const GENERATE_TASK_KEY = {
  bs: "bs",
  disc: "disc",
  email: "email",
};

function StagingFilePreview({ typeKey, file, onClose, onDeployed, onDiscarded }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    callAdminApi(`/api/admin/content/staging?type=${encodeURIComponent(typeKey)}&file=${encodeURIComponent(file)}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [typeKey, file]);

  async function doDeploy() {
    const taskKey = GENERATE_TASK_KEY[typeKey];
    if (!taskKey) return;
    const runId = String(file).replace(/\.json$/, "");
    if (!window.confirm(`确认部署暂存 ${runId} 到正式 ${taskKey} 题库？`)) return;
    setBusy("deploying");
    try {
      await callAdminApi(`/api/admin/staging/${encodeURIComponent(runId)}/deploy?taskType=${taskKey}`, { method: "POST" });
      if (onDeployed) onDeployed(runId);
    } catch (e) {
      alert("部署失败: " + e.message);
    } finally {
      setBusy("");
    }
  }

  async function doDiscard() {
    const taskKey = GENERATE_TASK_KEY[typeKey];
    if (!taskKey) return;
    const runId = String(file).replace(/\.json$/, "");
    if (!window.confirm(`确认丢弃暂存 ${runId}？此操作不可恢复。`)) return;
    setBusy("discarding");
    try {
      await callAdminApi(`/api/admin/staging/${encodeURIComponent(runId)}?taskType=${taskKey}`, { method: "DELETE" });
      if (onDiscarded) onDiscarded(runId);
    } catch (e) {
      alert("丢弃失败: " + e.message);
    } finally {
      setBusy("");
    }
  }

  const canManage = Boolean(GENERATE_TASK_KEY[typeKey]);
  const content = detail?.content;
  const items = useMemo(() => {
    if (!content) return [];
    if (Array.isArray(content.items)) return content.items;
    if (Array.isArray(content.questions)) return content.questions;
    if (Array.isArray(content.question_sets)) {
      return content.question_sets.flatMap((s, si) =>
        (s.questions || []).map((q, qi) => ({ ...q, _setIdx: si, _qIdx: qi }))
      );
    }
    return [];
  }, [content]);

  return (
    <Card padding={16}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.nav }}>{file}</div>
          <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
            {detail ? <>{formatBytes(detail.size)} · {fmtDate(detail.modifiedAt)}</> : "…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canManage ? (
            <>
              <Button variant="secondary" size="sm" onClick={doDiscard} disabled={busy !== ""}>
                {busy === "discarding" ? "处理中…" : "丢弃"}
              </Button>
              <Button variant="success" size="sm" onClick={doDeploy} disabled={busy !== ""}>
                {busy === "deploying" ? "部署中…" : "部署到正式库"}
              </Button>
            </>
          ) : (
            <Badge color="#94a3b8">只读（非生成型）</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>
      </div>

      {loading && <Skeleton height={120} />}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {!loading && !error && detail && (
        <>
          {items.length > 0 ? (
            <>
              <div style={{ fontSize: 12, color: C.t3, marginBottom: 8 }}>包含 {items.length} 项</div>
              <div style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {items.slice(0, 40).map((item, i) => (
                  <div key={i} style={{ padding: "8px 10px", border: "1px solid " + C.bdr, borderRadius: 7, fontSize: 12 }}>
                    {item.id && <div style={{ fontFamily: "monospace", fontSize: 11, color: C.t3 }}>{item.id}</div>}
                    <div style={{ color: C.t1, marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {item.prompt || item.topic || item.situation || item.scenario || item.announcement?.slice(0, 120) || JSON.stringify(item).slice(0, 120)}
                    </div>
                  </div>
                ))}
                {items.length > 40 && <div style={{ fontSize: 11, color: C.t3, textAlign: "center" }}>... 及另外 {items.length - 40} 项</div>}
              </div>
            </>
          ) : (
            <pre style={{ margin: 0, fontSize: 11, overflow: "auto", background: "#f8fafc", padding: 10, borderRadius: 6, maxHeight: 400 }}>
              {JSON.stringify(content, null, 2).slice(0, 4000)}
            </pre>
          )}
        </>
      )}
    </Card>
  );
}

function AdminStagingInner() {
  const searchParams = useSearchParams();
  const filterType = searchParams.get("type") || "";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // { typeKey, file }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const path = filterType
        ? `/api/admin/content/staging?type=${encodeURIComponent(filterType)}`
        : `/api/admin/content/staging`;
      const d = await callAdminApi(path);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  const allItems = useMemo(() => {
    if (!data) return [];
    if (filterType) return data.items || [];
    return data.items || [];
  }, [data, filterType]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const it of allItems) {
      const g = it.groupLabel || "其他";
      if (!groups[g]) groups[g] = [];
      groups[g].push(it);
    }
    return groups;
  }, [allItems]);

  const totals = useMemo(() => {
    let total = allItems.length;
    let deployable = 0;
    let readOnly = 0;
    for (const it of allItems) {
      if (GENERATE_TASK_KEY[it.typeKey]) deployable++;
      else readOnly++;
    }
    return { total, deployable, readOnly };
  }, [allItems]);

  function onDeployed(runId) {
    setSelected(null);
    load();
  }
  function onDiscarded(runId) {
    setSelected(null);
    load();
  }

  return (
    <AdminLayout title="暂存库审核">
      <div className="adm-page" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <ShimmerCSS />
        <PageHeader
          title="AI 生成暂存库"
          subtitle="所有题型的 AI 生成结果在入正式库前暂存于此。可预览、丢弃或部署。"
          right={<Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "加载中…" : "刷新"}
          </Button>}
        />

        <div className="adm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard value={totals.total} label="暂存文件总数" color={totals.total > 0 ? "#d97706" : C.t2} />
          <StatCard value={totals.deployable} label="可部署" color="#16a34a" sub="BS / Discussion / Email" />
          <StatCard value={totals.readOnly} label="只读（待接通）" color="#94a3b8" sub="Listening / Reading / Speaking" />
        </div>

        {filterType && (
          <div style={{ marginBottom: 16 }}>
            <InlineAlert tone="info">
              当前筛选：<strong>{filterType}</strong> · <a href="/admin-staging" style={{ color: "inherit", textDecoration: "underline" }}>清除筛选</a>
            </InlineAlert>
          </div>
        )}

        {error && <div style={{ marginBottom: 16 }}><InlineAlert tone="error">{error}</InlineAlert></div>}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={70} />)}
          </div>
        ) : allItems.length === 0 ? (
          <EmptyState title="没有暂存文件" hint="所有 AI 生成批次都已处理完毕。" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {Object.entries(grouped).map(([groupLabel, items]) => (
                <SectionCard key={groupLabel} title={`${groupLabel} (${items.length})`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map((it) => {
                      const isSelected = selected && selected.typeKey === it.typeKey && selected.file === it.file;
                      const canDeploy = Boolean(GENERATE_TASK_KEY[it.typeKey]);
                      return (
                        <button
                          key={it.file}
                          onClick={() => setSelected({ typeKey: it.typeKey, file: it.file })}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid " + (isSelected ? C.nav : C.bdr),
                            background: isSelected ? "#f1f5f9" : "#fff",
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <Badge color={canDeploy ? "#16a34a" : "#94a3b8"}>{it.typeKey}</Badge>
                          <span style={{ flex: 1, fontSize: 12, color: C.t1, fontFamily: "monospace" }}>{it.file}</span>
                          <span style={{ fontSize: 11, color: C.t3 }}>{formatBytes(it.size)}</span>
                          <span style={{ fontSize: 11, color: C.t3, minWidth: 80, textAlign: "right" }}>{relativeTime(it.modifiedAt)}</span>
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>
              ))}
            </div>
            {selected && (
              <div>
                <StagingFilePreview
                  typeKey={selected.typeKey}
                  file={selected.file}
                  onClose={() => setSelected(null)}
                  onDeployed={onDeployed}
                  onDiscarded={onDiscarded}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default function AdminStagingPage() {
  return (
    <Suspense fallback={<AdminLayout title="暂存库审核"><div style={{ padding: 24 }}>加载中…</div></AdminLayout>}>
      <AdminStagingInner />
    </Suspense>
  );
}
