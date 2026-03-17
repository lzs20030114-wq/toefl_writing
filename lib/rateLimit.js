/**
 * 共享内存限流器（滑动窗口计数，按 key 隔离）。
 *
 * ── 基本用法 ──────────────────────────────────────────────
 *
 *   import { createRateLimiter, getIp } from "@/lib/rateLimit";
 *
 *   // 在文件顶层创建限流器实例，name 必须全局唯一（用作 globalThis key）
 *   const limiter = createRateLimiter("feedback", { window: 60_000, max: 10 });
 *
 *   export async function POST(request) {
 *     if (limiter.isLimited(getIp(request))) {
 *       return Response.json({ error: "Too many requests" }, { status: 429 });
 *     }
 *     // 正常业务逻辑...
 *   }
 *
 * ── 参数说明 ──────────────────────────────────────────────
 *
 *   createRateLimiter(name, opts?)
 *     name          唯一标识，如 "feedback"、"auth"、"webhook"
 *     opts.window   时间窗口（毫秒），默认 60_000（1 分钟）
 *     opts.max      窗口内最大请求数，默认 10
 *
 *   limiter.isLimited(key)
 *     key           限流维度，一般传 getIp(request)（按 IP 限流）
 *     返回 true 表示已超限，应返回 429
 *
 *   getIp(request)
 *     从请求头提取客户端 IP，优先级：cf-connecting-ip > x-forwarded-for > x-real-ip
 *
 * ── 已接入的路由 ──────────────────────────────────────────
 *
 *   路由                              name           max
 *   /api/feedback          POST       "feedback"     10
 *   /api/iap/webhook       POST       "webhook"      20
 *   /api/auth/verify-code  POST       "auth"         10
 *   /api/auth/email-login  POST       "email-login"  10
 *   /api/auth/user-info    GET        "user-info"    20
 *   /api/usage             POST       "usage"        10
 *   /api/ai                POST       "ai"           45（带指纹 fallback）
 *
 * ── 原理 ──────────────────────────────────────────────────
 *
 *   每次调用 isLimited() 时：
 *   1. 先清理所有过期的 bucket（超过 window 的全删）
 *   2. 查找当前 key 的 bucket，不存在则新建（计数=1，未超限）
 *   3. 存在则 +1，判断是否超过 max
 *   bucket 通过 globalThis 存储，dev 热重载时不会丢失。
 *
 * ── 注意事项 ──────────────────────────────────────────────
 *
 *   - 这是单进程内存限流，Vercel Serverless 每个实例独立计数，不是精确全局限流
 *   - 对于防刷场景已经够用；如需精确全局限流需要 Redis/Upstash
 *   - name 重复会导致不同路由共享同一个 bucket（通常不是你想要的）
 *
 * ── 升级到全局限流 ──────────────────────────────────────────
 *
 *   当前方案在 Vercel Serverless 下每个实例独立计数，实际限流效果
 *   低于配置值。如需精确全局限流：
 *
 *   1. 注册 Upstash (upstash.com) 并创建 Redis 数据库
 *   2. npm install @upstash/ratelimit @upstash/redis
 *   3. 在 .env 中配置 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN
 *   4. 替换 createRateLimiter 实现为 Upstash slidingWindow
 *
 *   参考: https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
 */

/**
 * Extract client IP from request headers (Cloudflare → X-Forwarded-For → X-Real-IP).
 */
export function getIp(req) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

/**
 * Create a named rate limiter that persists across hot-reloads via globalThis.
 *
 * @param {string} name   - Unique name (used as globalThis key)
 * @param {object} opts
 * @param {number} opts.window - Time window in ms (default 60_000)
 * @param {number} opts.max    - Max requests per window (default 10)
 */
export function createRateLimiter(name, { window = 60_000, max = 10 } = {}) {
  const globalKey = `__rl_${name}`;
  const buckets = globalThis[globalKey] || new Map();
  if (!globalThis[globalKey]) globalThis[globalKey] = buckets;

  return {
    /**
     * Check if the given key (typically an IP) is rate-limited.
     * Automatically increments the counter and sweeps expired entries.
     * @param {string} key
     * @returns {boolean} true if over the limit
     */
    isLimited(key) {
      const now = Date.now();
      // Sweep expired
      for (const [k, v] of buckets) {
        if (now - v.t > window) buckets.delete(k);
      }
      const b = buckets.get(key);
      if (!b || now - b.t > window) {
        buckets.set(key, { t: now, c: 1 });
        return false;
      }
      b.c++;
      return b.c > max;
    },
  };
}
