/**
 * users 行查询的统一入口。
 *
 * 起因是一条线上事故(2026-09-12 16:54Z)：PostgREST 偶发 504 网关超时，而各调用方
 * 都写成 `const { data: user } = await ...`，把 error 整个丢掉。查库失败时 data 同样
 * 是 null，于是「基础设施抖动」被误判成「这个用户不存在」——/api/ai 回 403
 * Invalid user.（用户只看到红字 "API error 403"，无从自救），IAP webhook 则静默跳过
 * Pro 升级（付了钱不到账）。
 *
 * 两条规矩：
 *   1) 永远把「查库失败」和「查无此人」分开返回，语义交给调用方判；
 *   2) 先自己重试一次 —— 504 是瞬时的，重试基本就过，比把错误甩给用户划算。
 */
import { supabaseAdmin } from "./supabaseAdmin";

const RETRY_DELAY_MS = 200;
const ATTEMPTS = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 读取用户的 tier 信息。
 *
 * @param {string} userCode 6 位用户码（调用方负责大写/裁剪）
 * @returns {Promise<{user: {tier: string, tier_expires_at: string|null}|null, error: any}>}
 *   - `{ user: {...}, error: null }` 查到了
 *   - `{ user: null,  error: null }` 确认查无此人（code 不在表里）
 *   - `{ user: null,  error }`       查库失败；调用方必须按「暂时不可用」处理，
 *                                    **不许**当成无此用户
 */
export async function lookupUserTier(userCode) {
  let lastError = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("tier, tier_expires_at")
      .eq("code", userCode)
      .maybeSingle();
    if (!error) return { user: data || null, error: null };
    lastError = error;
  }
  return { user: null, error: lastError };
}
