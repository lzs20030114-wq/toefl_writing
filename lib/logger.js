/**
 * 结构化日志工厂。替代散落的 console.log("[xxx] ...")，统一格式方便搜索和过滤。
 *
 * ── 基本用法 ──────────────────────────────────────────────
 *
 *   import { createLogger } from "@/lib/logger";
 *   const log = createLogger("iap");          // tag = 模块名
 *
 *   log.info("Upgraded user", { userCode, plan });
 *   // 输出: [iap] Upgraded user {"userCode":"ABC","plan":"monthly"}
 *
 *   log.warn("Missing remark", { orderId });
 *   // 输出: [iap] Missing remark {"orderId":"123"}
 *
 *   log.error("Verification failed", { err });
 *   // 输出: [iap] Verification failed {"err":"timeout"}
 *
 *   log.info("Simple message");               // 第二个参数可省略
 *   // 输出: [iap] Simple message
 *
 * ── 三个方法 ──────────────────────────────────────────────
 *
 *   log.info(msg, data?)    普通信息（对应 console.log）
 *   log.warn(msg, data?)    警告（对应 console.warn）
 *   log.error(msg, data?)   错误（对应 console.error）
 *
 *   msg:  字符串描述，写"发生了什么"
 *   data: 可选对象，会被 JSON.stringify 追加到消息后面
 *
 * ── 已接入的模块 ──────────────────────────────────────────
 *
 *   模块                              tag
 *   lib/iap/service.js               "iap"
 *   lib/iap/providers/afdianProvider  "afdian-webhook"
 *   app/api/iap/webhook/route.js      "webhook"
 *
 * ── 在 Vercel 日志面板怎么用 ─────────────────────────────
 *
 *   搜索 "[iap]" → 过滤出所有支付相关日志
 *   搜索 "[afdian-webhook]" → 只看爱发电回调日志
 *   搜索 "userCode" → 查某个用户相关的所有操作
 *   JSON 部分可以直接复制出来解析
 *
 * ── 什么时候用 ───────────────────────────────────────────
 *
 *   - 后端 API 路由和 lib/ 里的服务端逻辑 → 用 createLogger
 *   - 前端组件里的 console.log → 不需要改（前端日志用户看不到）
 *   - 临时调试的 console.log → 不需要改（调完会删）
 */

/**
 * @param {string} tag - 模块/上下文标签（如 "iap", "webhook", "session"）
 */
export function createLogger(tag) {
  const prefix = `[${tag}]`;

  function fmt(msg, data) {
    if (data !== undefined) {
      return `${prefix} ${msg} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${msg}`;
  }

  return {
    info(msg, data) { console.log(fmt(msg, data)); },
    warn(msg, data) { console.warn(fmt(msg, data)); },
    error(msg, data) { console.error(fmt(msg, data)); },
  };
}
