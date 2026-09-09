"use client";
/**
 * 后台「真题录入」——把一套真题源拖进来，云端 Worker 自动跑完整条管线并推 main。
 * 链路与端点见 docs/realbank-ingest-contract.md。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AdminLayout from "../../components/admin/AdminLayout";
import { PageHeader, Button, InlineAlert, Tabs } from "../../components/admin/primitives";
import { useAdminToken, callAdminApi } from "../../lib/adminHelpers";
import NewJobPanel from "../../components/admin/realBankIngest/NewJobPanel";
import JobList from "../../components/admin/realBankIngest/JobList";
import ReviewQueue from "../../components/admin/realBankIngest/ReviewQueue";

const POLL_MS = 5000;

export default function AdminRealBankIngestPage() {
  const { token, ready } = useAdminToken();
  const [tab, setTab] = useState("jobs");
  const [jobs, setJobs] = useState([]);
  const [gh, setGh] = useState(null);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const inflight = useRef(false);

  const loadJobs = useCallback(async () => {
    if (inflight.current) return; // 5s 轮询遇上慢响应时不要叠加请求
    inflight.current = true;
    setLoading(true);
    try {
      const body = await callAdminApi("/api/admin/real-bank-ingest/jobs?limit=50");
      setJobs(body.jobs || []);
      setGh(body.gh || null);
      setErr(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  const loadReview = useCallback(async () => {
    setReviewLoading(true);
    try {
      const body = await callAdminApi("/api/admin/real-bank-ingest/review");
      setReview(body);
      setErr(null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setReviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !token) return undefined;
    loadJobs();
    const t = setInterval(loadJobs, POLL_MS);
    return () => clearInterval(t);
  }, [ready, token, loadJobs]);

  useEffect(() => {
    if (ready && token && tab === "review" && !review) loadReview();
  }, [ready, token, tab, review, loadReview]);

  async function manualRebuild() {
    const reason = window.prompt("手动重建题库的理由：", "手动触发");
    if (!reason) return;
    try {
      await callAdminApi("/api/admin/real-bank-ingest/rebuild", { method: "POST", body: JSON.stringify({ reason }) });
      setMsg({ tone: "success", text: "已派 rebuild 任务，进度看下面的任务列表。" });
      loadJobs();
    } catch (e) {
      setMsg({ tone: "error", text: String(e.message || e) });
    }
  }

  const pendingReview = review ? review.pending : null;

  return (
    <AdminLayout title="真题录入">
      <div className="adm-page" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <PageHeader
          title="真题录入"
          subtitle="拖一套真题源进来 → 云端跑结构化/盲审/配音/建库 → 自动提交 main → Vercel 部署"
          right={<Button variant="secondary" onClick={manualRebuild}>手动 rebuild</Button>}
        />

        {!token && ready && (
          <div style={{ marginBottom: 14 }}>
            <InlineAlert tone="warn">缺少管理员口令，请先在其他后台页输入 ADMIN_DASHBOARD_TOKEN。</InlineAlert>
          </div>
        )}
        {msg && <div style={{ marginBottom: 14 }}><InlineAlert tone={msg.tone}>{msg.text}</InlineAlert></div>}
        {err && <div style={{ marginBottom: 14 }}><InlineAlert tone="error">{err}</InlineAlert></div>}

        <Tabs
          tabs={[
            { key: "jobs", label: "录入任务", count: jobs.length },
            { key: "review", label: "复核队列", count: pendingReview },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "jobs" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <NewJobPanel onJobStarted={loadJobs} />
            <JobList jobs={jobs} gh={gh} loading={loading} onRefresh={loadJobs} onAction={loadJobs} />
          </div>
        ) : (
          <ReviewQueue data={review} loading={reviewLoading} onRefresh={loadReview} />
        )}
      </div>
    </AdminLayout>
  );
}
