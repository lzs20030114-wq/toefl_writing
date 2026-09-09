/**
 * 真题自动录入 —— 触发 GitHub Actions Worker。
 *
 * 写法照抄 app/api/admin/generate-bs/route.js（同一套 GH_PAT / owner / repo 约定），
 * 只是 workflow 文件名和 inputs 不同。Actions 侧见 .github/workflows/real-bank-ingest.yml（B 线）。
 *
 * GH_PAT 需要 actions:write（dispatch）+ contents:write（复核决定提交 main）。
 * PAT 过期是本项目栽过的坑（见 memory/gh-pat-expired-r3-merge-stall），
 * 所以这里把 401/403 单独翻成「PAT 无效或过期」的人话，别让后台只显示一个数字。
 */
const GH_OWNER = process.env.GH_OWNER || "lzs20030114-wq";
const GH_REPO = process.env.GH_REPO || "toefl_writing";
const WORKFLOW_FILE = "real-bank-ingest.yml";

function ghConfig() {
  return { owner: process.env.GH_OWNER || GH_OWNER, repo: process.env.GH_REPO || GH_REPO, workflow: WORKFLOW_FILE };
}

function ghHeaders() {
  const pat = process.env.GH_PAT;
  if (!pat) throw new Error("GH_PAT 未配置：无法触发录入 Worker（Vercel 环境变量里补上，需要 actions:write + contents:write）");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * workflow_dispatch real-bank-ingest.yml。
 * @param {string} jobId
 * @returns {Promise<{ok:true}>} 失败一律抛 Error（调用方负责把 status 回滚成 queued）
 */
async function dispatchIngestWorkflow(jobId) {
  const { owner, repo, workflow } = ghConfig();
  const headers = ghHeaders();
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: "main", inputs: { job_id: String(jobId) } }),
    });
  } catch (e) {
    throw new Error(`触发 Actions 失败（网络）：${e.message || e}`);
  }
  if (res.status === 204) return { ok: true };
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    throw new Error(`GH_PAT 无效或已过期（${res.status}）：换一个带 actions:write 的 PAT 再试。${text.slice(0, 200)}`);
  }
  if (res.status === 404) {
    throw new Error(`找不到工作流 ${workflow}（404）：确认它已经合进 main 分支。`);
  }
  throw new Error(`触发 Actions 失败 ${res.status}: ${text.slice(0, 300)}`);
}

/**
 * 「置 queued → dispatch → 置 dispatched」这三步在 start/format/retry/rebuild 四个端点里
 * 完全一样，抽这里保证失败回滚口径一致：dispatch 失败一律把 status 留在 queued（可重试），
 * 并把人话错误写进 job.error，后台列表能直接看到。
 * @returns {Promise<{ok:boolean, job:object, error?:string}>}
 */
async function queueAndDispatch(jobId, patch = {}) {
  const { updateJob } = require("./jobs");
  let job = await updateJob(jobId, { ...patch, status: "queued", error: null });
  try {
    await dispatchIngestWorkflow(jobId);
  } catch (e) {
    const msg = e.message || "触发 Actions 失败";
    job = await updateJob(jobId, { status: "queued", error: msg }).catch(() => job);
    return { ok: false, job, error: msg };
  }
  job = await updateJob(jobId, { status: "dispatched" });
  return { ok: true, job };
}

/**
 * 建一个 kind=rebuild 的 job 并派工。手动按钮和「复核决定」都走它，
 * 保证决定改完文件后一定会重建推库（否则线上还是旧库）。
 */
async function startRebuild(reason) {
  const { createJob, appendProgress } = require("./jobs");
  const text = String(reason || "手动触发").slice(0, 200);
  const job = await createJob({ set_name: `rebuild ${new Date().toISOString().slice(0, 16)}`, kind: "rebuild" });
  await appendProgress(job, { stage: null, msg: `rebuild 原因：${text}` }).catch(() => {});
  return queueAndDispatch(job.id, {});
}

module.exports = {
  GH_OWNER,
  GH_REPO,
  WORKFLOW_FILE,
  ghConfig,
  ghHeaders,
  dispatchIngestWorkflow,
  queueAndDispatch,
  startRebuild,
};
