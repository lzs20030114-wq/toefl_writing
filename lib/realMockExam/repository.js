import { randomUUID } from "crypto";
import { supabaseAdmin } from "../supabaseAdmin";
import { canonicalId } from "./identity";
import { planRealMockExam, loadRealMockPool } from "./planner";
import { REAL_MOCK_TEMPLATE_VERSION } from "./config";

const PAGE = 500;

async function allRows(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await queryFactory().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export function historicalIds(rows) {
  const out = new Set();
  const add = (id) => { if (id) out.add(canonicalId(id)); };
  for (const row of rows || []) {
    const d = row.details;
    if (Array.isArray(d)) d.forEach((x) => add(x?.qid));
    else if (d && typeof d === "object") {
      if (d.realMock) { for (const id of d.seenItemIds || []) add(id); continue; }
      add(d.itemId); add(d.setId); add(d.promptId); add(d.promptData?.id);
      for (const id of d.itemIds || []) add(id);
      for (const item of d.items || []) add(item?.id || item?.itemId || item?.qid);
      for (const task of d.tasks || []) {
        add(task?.id || task?.itemId || task?.setId || task?.promptId);
        for (const id of task?.itemIds || []) add(id);
      }
    }
  }
  return [...out];
}

// 每次「开始考试」都要读这个账号的全部历史。真题模考记录一条 120–300 KB（整卷题面 + 作答），
// 而 historicalIds 只认它的 seenItemIds —— 所以分两路：模考行只投影 seenItemIds，其余行才拉整段 details。
// 只有 realMock: true 会被写进 details（三个模考壳），所以两路正好覆盖全部行。
// 任一路出错（如 PostgREST 不认 JSON 路径过滤）就退回原来的整段单查询：最坏与从前一样慢，结果不变。
async function loadHistoricalIds(userCode) {
  const sessions = () => supabaseAdmin.from("sessions");
  let rows;
  try {
    const [mockRows, otherRows] = await Promise.all([
      allRows(() => sessions().select("id,type,seenItemIds:details->seenItemIds").eq("user_code", userCode)
        .eq("details->>realMock", "true").order("id", { ascending: true })),
      allRows(() => sessions().select("id,type,details").eq("user_code", userCode)
        .is("details->>realMock", null).order("id", { ascending: true })),
    ]);
    rows = [...mockRows.map((row) => ({ id: row.id, type: row.type, details: { realMock: true, seenItemIds: row.seenItemIds } })), ...otherRows];
  } catch {
    rows = await allRows(() => sessions().select("id,type,details").eq("user_code", userCode).order("id", { ascending: true }));
  }
  return historicalIds(rows);
}

async function blockedKeys(userCode) {
  const rows = await allRows(() => supabaseAdmin.from("real_mock_keys").select("key,seen_at,reserved_attempt,lease_expires_at").eq("user_code", userCode).order("key", { ascending: true }));
  const now = Date.now();
  return rows.filter((r) => r.seen_at || (r.reserved_attempt && Date.parse(r.lease_expires_at) > now)).map((r) => r.key);
}

export async function getAttempt(userCode, attemptId) {
  const { data, error } = await supabaseAdmin.from("real_mock_attempts")
    .select("id,user_code,section,route,status,snapshot,lease_expires_at")
    .eq("user_code", userCode).eq("id", attemptId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function prepareAttempt(userCode, section, localDoneIds = [], restartAttemptId = null) {
  const { data: existing, error } = await supabaseAdmin.from("real_mock_attempts")
    .select("id,snapshot,route,lease_expires_at").eq("user_code", userCode).eq("section", section)
    .eq("status", "active").gt("lease_expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) {
    if (restartAttemptId) {
      if (restartAttemptId !== existing.id) return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: existing.id, error: "另有正在进行的真题模考，请先处理该试卷。" };
      const done = await transitionAttempt(userCode, existing.id, "finish");
      if (done?.status !== "ok") throw new Error("无法结束旧试卷");
    } else {
      const { data: seen, error: seenError } = await supabaseAdmin.from("real_mock_keys")
        .select("key").eq("reserved_attempt", existing.id).not("seen_at", "is", null).limit(1);
      if (seenError) throw new Error(seenError.message);
      if ((seen || []).length) return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: existing.id, error: "已有正在进行的真题模考，请续考或选择重新开始。" };
    }
  }
  if (existing && !restartAttemptId) {
    // A reserve call renews both the attempt lease and all unseen held keys atomically.
    const response = await supabaseAdmin.rpc("real_mock_reserve", {
      p_user_code: userCode, p_section: section, p_attempt: randomUUID(),
      p_version: REAL_MOCK_TEMPLATE_VERSION, p_snapshot: existing.snapshot, p_keys: [],
    });
    if (response.error) throw new Error(response.error.message);
    if (response.data?.status === "active-attempt") return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: response.data.attemptId, error: "已有正在进行的真题模考，请续考或选择重新开始。" };
    if (response.data?.status === "version-conflict") return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: existing.id, error: "旧版试卷仍在进行，请续考或选择重新开始。" };
    if (response.data?.status === "existing") return { ok: true, paper: { ...response.data.snapshot, attemptId: response.data.attemptId, userCode, route: response.data.route }, resumed: true };
  }
  const pool = loadRealMockPool(section);
  const doneIds = [...new Set([...localDoneIds, ...(await loadHistoricalIds(userCode))])];
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = planRealMockExam(section, { pool, doneIds, blockedKeys: await blockedKeys(userCode) });
    if (!result.ok) return result;
    const attemptId = randomUUID();
    const paper = { ...result.paper, attemptId, userCode };
    const keys = [...new Set(paper.items.flatMap((item) => item.realMockKeys))];
    const { data, error: rpcError } = await supabaseAdmin.rpc("real_mock_reserve", {
      p_user_code: userCode, p_section: section, p_attempt: attemptId,
      p_version: REAL_MOCK_TEMPLATE_VERSION, p_snapshot: paper, p_keys: keys,
    });
    if (rpcError) throw new Error(rpcError.message);
    if (data?.status === "created" || data?.status === "existing") {
      return { ok: true, paper: { ...data.snapshot, attemptId: data.attemptId, userCode }, resumed: data.status === "existing" };
    }
    if (data?.status === "version-conflict") return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: data.attemptId, error: "旧版试卷仍在进行，请续考或选择重新开始。" };
    if (data?.status === "active-attempt") return { ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: data.attemptId, error: "已有正在进行的真题模考，请续考或选择重新开始。" };
  }
  return { ok: false, code: "RESERVATION_CONFLICT", deficits: [], error: "同时有别的组卷请求，请稍后重试。" };
}

export async function transitionAttempt(userCode, attemptId, action, keys = [], path = null, answered = false) {
  const { data, error } = await supabaseAdmin.rpc("real_mock_transition", {
    p_user_code: userCode, p_attempt: attemptId, p_action: action,
    p_keys: keys, p_path: path, p_answered: answered,
  });
  if (error) throw new Error(error.message);
  return data;
}
