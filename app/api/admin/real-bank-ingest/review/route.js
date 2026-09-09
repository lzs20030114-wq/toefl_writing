/**
 * GET /api/admin/real-bank-ingest/review —— 复核队列。
 *
 * 三份东西汇总给后台：
 *  ① 各 done job 的 result.holds（Worker 的 hold_policy 扣下的「整科不上线」）
 *  ② data/realBank/review-holds.json 的 holds（成品级下架清单，历史沉淀）
 *  ③ data/realBank/review-overrides.json 的 allow（已放行清单）
 * ①里能被③匹配上的标 resolved——放行后 job 的 result 不会回写，只能在这里对账。
 *
 * 仓库文件走 GitHub Contents API 读 main 最新版本，而不是读本地 data/：
 * Vercel 上的 data/ 是构建时快照，复核决定刚提交的那次改动它看不到。
 */
import { isAdminAuthorized } from "../../../../../lib/adminAuth";
import { jsonError } from "../../../../../lib/apiResponse";
import { listJobs } from "../../../../../lib/realBankIngest/jobs";
import {
  OVERRIDES_PATH,
  HOLDS_PATH,
  readOverrides,
  readRepoHolds,
  isAllowed,
} from "../../../../../lib/realBankIngest/review";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");

  let jobs = [];
  try {
    jobs = await listJobs({ limit: 200 });
  } catch (e) {
    return jsonError(500, e.message || "读取任务失败");
  }

  let allow = [];
  let repoHolds = [];
  let repoError = null;
  try {
    allow = (await readOverrides()).content.allow || [];
    repoHolds = (await readRepoHolds()).content.holds || [];
  } catch (e) {
    repoError = e.message || "读取仓库复核文件失败"; // GH_PAT 缺/过期时仍然要能看见 job 侧的 holds
  }

  // 同一套同一科同一 code 只留最新一条（重跑同一套会重复产生 hold）。
  const seen = new Map();
  for (const job of jobs) {
    if (job.status !== "done" || !job.result) continue;
    const holds = Array.isArray(job.result.holds) ? job.result.holds : [];
    for (const h of holds) {
      const setKey = h.set || job.set_key || job.set_name;
      const key = `${setKey}|${h.section}|${h.code}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        ...h,
        set: setKey,
        job_id: job.id,
        job_created_at: job.created_at,
        resolved: isAllowed(allow, setKey, h.section, h.code),
      });
    }
  }
  const sectionHolds = [...seen.values()];

  return Response.json({
    ok: true,
    holds: sectionHolds,
    pending: sectionHolds.filter((h) => !h.resolved).length,
    repoHolds,
    allow,
    repoError,
    paths: { overrides: OVERRIDES_PATH, holds: HOLDS_PATH },
  });
}
