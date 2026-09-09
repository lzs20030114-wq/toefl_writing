/**
 * 真题自动录入 —— jobs 表访问层（service role）。
 *
 * 表定义见 scripts/sql/real-bank-ingest-jobs.sql / 契约 §1。
 * Worker（scripts/realbank/worker.mjs）不经 API，直接用 service-role supabase-js
 * 读写同一张表；这里只服务后台 API 侧。
 *
 * 约定：updated_at 由应用层写（表默认值只管插入那一次）。
 */
const TABLE = "real_bank_ingest_jobs";

// 列表页不拉 progress/result 全文（progress 可能上百条），只带最后一条。
const LIST_COLUMNS =
  "id,set_name,set_key,kind,source_kind,detected_kind,status,stage,cost_cny,error,gh_run_id,created_at,updated_at,files,progress,result";

let _admin;
function getAdmin() {
  if (_admin !== undefined) return _admin;
  try {
    const { supabaseAdmin } = require("../supabaseAdmin");
    _admin = supabaseAdmin || null;
  } catch {
    _admin = null;
  }
  return _admin;
}

function requireAdmin() {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin 未配置（缺 SUPABASE_SERVICE_ROLE_KEY）");
  return admin;
}

async function createJob({ set_name, kind = "ingest", source_kind = "auto", files = [] }) {
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const row = {
    set_name,
    kind,
    source_kind,
    // rebuild 没有源文件，建完就等着 dispatch，不走 uploading。
    status: kind === "rebuild" ? "queued" : "uploading",
    files,
    progress: [],
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await admin.from(TABLE).insert(row).select().single();
  if (error) throw new Error(`创建任务失败: ${error.message}`);
  return data;
}

async function getJob(id) {
  const admin = requireAdmin();
  const { data, error } = await admin.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`读取任务失败: ${error.message}`);
  return data || null;
}

/** 列表：最新在前；progress 只回最后一条，result 只回摘要用得到的字段。 */
async function listJobs({ limit = 50 } = {}) {
  const admin = requireAdmin();
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const { data, error } = await admin
    .from(TABLE)
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) throw new Error(`读取任务列表失败: ${error.message}`);
  return (data || []).map((j) => {
    const progress = Array.isArray(j.progress) ? j.progress : [];
    const files = Array.isArray(j.files) ? j.files : [];
    return {
      ...j,
      progress: undefined,
      files: undefined,
      file_count: files.length,
      total_bytes: files.reduce((s, f) => s + (Number(f && f.size) || 0), 0),
      last_progress: progress.length ? progress[progress.length - 1] : null,
      progress_count: progress.length,
    };
  });
}

/** 局部更新；总是带上 updated_at。 */
async function updateJob(id, patch) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`更新任务失败: ${error.message}`);
  return data;
}

/** 追加一条 progress（后台侧只在 dispatch/取消这类动作上用，Worker 有自己的实现）。 */
async function appendProgress(job, { stage, msg, level = "info" }) {
  const prev = Array.isArray(job.progress) ? job.progress : [];
  const next = [...prev, { ts: new Date().toISOString(), stage: stage || job.stage || null, msg, level }];
  return updateJob(job.id, { progress: next });
}

module.exports = { TABLE, createJob, getJob, listJobs, updateJob, appendProgress };
