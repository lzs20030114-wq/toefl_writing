# AI 点数基础设施

> 当前状态（2026-07-13）：代码已搭建，**未迁移、未启用、未接通**。现有定价、支付、AI 评分、口语和听力流程均保持原样。

## 安全开关

三个变量默认都为 `false`：

```env
NEXT_PUBLIC_CREDITS_ENABLED=false
CREDITS_ENABLED=false
CREDITS_ENFORCEMENT_ENABLED=false
```

- `NEXT_PUBLIC_CREDITS_ENABLED`：将来控制余额和点数购买 UI；当前无 UI 使用它。
- `CREDITS_ENABLED`：允许服务端读取/发放钱包。单独开启仍不会扣点。
- `CREDITS_ENFORCEMENT_ENABLED`：只有它和 `CREDITS_ENABLED` 同时为 true，`creditService.charge()` 才会真正调用原子扣点 RPC。

因此误开一个开关不会阻断现有评分或口语请求。

## 已准备的能力

- 双余额钱包：订阅赠送点数、额外购买点数分开保存。
- 消耗顺序：订阅点数优先，购买点数随后；购买点数不随订阅周期清零。
- 原子操作：订阅周期刷新、购买点数发放、扣点、失败退款。
- 幂等键：相同请求重试不会重复发点、扣点或退款。
- 周期防重：同一订阅周期即使换幂等键重放也不会恢复已消费点数，倒退、已结束或尚未开始的周期事件会被拒绝。
- 跨周期退款：当前周期内按原余额桶退回；原周期结束后才到达的订阅点退款自动转为长期有效点数，不会抬高新周期额度。
- 流水：每次余额变化保存前后余额、动作、来源和元数据。
- 过期处理：消费时自动清除已过期的订阅点数并记流水。
- RLS：浏览器匿名 key 和普通 authenticated role 均不能直接读写钱包或调用 RPC。
- 配置端点：`GET /api/credits/config`，只有服务端和客户端开关同时开启才返回目录；当前默认 404，不泄露候选价格，也不读取钱包。

## 尚未接通的地方

- `lib/iap/catalog.js` 和购买页仍是旧价格。
- 支付 webhook 不发放订阅点数或加量包点数。
- `/api/ai` 不调用 `creditService.charge()`。
- `/api/speech/transcribe` 不调用 `creditService.charge()`。
- 公共听力始终不扣点。
- 没有余额 UI、购买点数 UI、额度不足弹窗或后台人工调账页。
- `scripts/sql/credits-schema.sql` 未在生产 Supabase 执行。

## 未来启用顺序

1. 人工审核并执行 `scripts/sql/credits-schema.sql`，更新迁移登记状态。
2. 只开 `CREDITS_ENABLED=true`，建立测试钱包并验证发放、扣点、退款；保持 enforcement=false。
3. 接支付发放，但仍不拦截 AI 请求。
4. 以影子计费方式观察至少一个周期，确认动作成本和 100 点覆盖率。
5. 接余额 UI 和加量包支付。
6. 最后才开启 `CREDITS_ENFORCEMENT_ENABLED=true`。

## 代码入口

- 候选套餐/加量包/动作价格：`lib/credits/catalog.js`
- 服务开关与扣点入口：`lib/credits/service.js`
- Supabase RPC 适配：`lib/credits/repository.js`
- 幂等原子数据库操作：`scripts/sql/credits-schema.sql`
- 真实 PostgreSQL 行为测试：`__tests__/credits.schema.integration.test.js`（PGlite，仅开发依赖）
- 方案和使用统计：`docs/PRICING-USAGE-PLAN-2026-07-13.md`
