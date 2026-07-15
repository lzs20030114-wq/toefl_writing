# SQL 迁移登记表

本项目 Supabase 没有 CLI 迁移链路，所有 SQL 由人工复制粘贴到 Supabase 控制台 SQL Editor 执行。
这份文件是登记表，记录每个 `scripts/sql/*.sql` 文件是否已经在生产 Supabase 上执行过。

**维护规则**：
- 新迁移通过 `/sql-migrate` skill 创建 + 登记，不要手写绕过登记流程
- 状态只有在用户明确确认"跑完了"之后才能标记为「已跑」
- `/ship` 推送前置检查会读这份文件，判断本次改动依赖的迁移是否已登记为「已跑」
- 不要回填/修改历史迁移的登记状态，除非用户明确告知真实执行情况
- 表格按文件名字母序排列

| 文件 | 日期 | 状态 | 作用 |
|---|---|---|---|
| `analytics-schema.sql` | 2026-03-16 | 历史迁移,状态未知(建库早期) | 页面访问事件追踪 + 管理后台分析表 |
| `cohort-retention.sql` | 2026-06-30 | 无需跑 | 留存分析 SQL 已被 `/api/admin/retention` 的 JS 直读重写架空,不需要单独执行 |
| `credits-schema.sql` | 2026-07-13 | **未跑** | AI 点数钱包+双余额(订阅/购买)+幂等原子刷新/发放/扣点/退款 RPC；仅建基础设施，不接现有流程，需保持三个 credits feature flags=false |
| `daily-usage-quota.sql` | 2026-06-04 | 历史迁移,状态未知(建库早期) | `/api/ai` 服务端每日 AI 用量计数 |
| `feature-engagement.sql` | 2026-07-09 | 已跑 | 留存分析改版「做题量/功能吸引力」(PR #4):`session_item_count()` 题目数口径函数 + `feature_sessions`/`feature_engagement_totals`/`feature_first_touch`/`feature_stickiness`/`feature_weekly` 只读视图(仅 service role 可读)。注意:改视图列序时 `CREATE OR REPLACE` 会报 42P16,需先 DROP 全部 5 个视图再重跑本文件 |
| `feedback-status-migration.sql` | 2026-03-01 | 历史迁移,状态未知(建库早期) | 反馈状态追踪 + 管理员回复系统 |
| `iap-schema.sql` | 2026-02-28 | 历史迁移,状态未知(建库早期) | IAP 支付相关表(entitlements/webhook_events 等) |
| `login-code-management.sql` | 2026-02-19 | 历史迁移,状态未知(建库早期) | 管理员可管理的登录码 + 登录流程加固 |
| `mistake-favorites.sql` | 2026-05-07 | 历史迁移,状态未知(建库早期) | 错题本收藏(⭐)功能 |
| `pro-codes-batch-2026-03-23.sql` | 2026-03-23 | 历史迁移,状态未知(建库早期) | 可变时长 Pro 登录码 + 首次登录激活 |
| `pro-trial-migration.sql` | 2026-03-19 | 历史迁移,状态未知(建库早期) | 新用户自动赠送 3 天 Pro 试用 |
| `referral-email-optout.sql` | 2026-05-13 | 历史迁移,状态未知(建库早期) | 邀请奖励到账邮件通知的退订字段 |
| `referral-events.sql` | 2026-05-13 | 历史迁移,状态未知(建库早期) | 邀请增长循环 Phase 1 基础表 |
| `referrals.sql` | 2026-05-13 | 历史迁移,状态未知(建库早期) | 邀请好友计划(邀请人+3天Pro) |
| `speech-recording-retention.sql` | 2026-07-16 | 已跑 | 口语录音留存基建:`users.speech_consent_version` 列 + `speech_recordings` 元数据表(RLS 无 policy,仅 service role) + 私有桶 `speech_recordings`;v2 同意才留存,90 天清理走 `scripts/ops/cleanup-speech-recordings.mjs` |
| `speech-stt-schema.sql` | 2026-05-20 | 历史迁移,状态未知(建库早期) | 口语 PIPL 合规同意流程 + 每用户每日语音额度 |
| `audio-events.sql` | 2026-07-15 | 已跑 | 考试音频持久播放器遥测表 `audio_events`(解锁/播放/被拦/兜底/覆盖层全生命周期,RLS 无公开策略,仅 service role 经 /api/analytics/audio 写入) |
| `user-question-banks-widen-types.sql` | 2026-07-04 | 已跑 | 「我的题库」12 题型全量扩展:把 `user_question_banks.type` 的 CHECK 约束放宽到全部 12 类(见 CHANGELOG v1.11.0) |
| `user-question-banks.sql` | 2026-06-27 | 历史迁移,状态未知(建库早期) | 「我的题库」P0:用户自助导入题目到个人库 + 视觉识别接入 |
| `user-surveys-schema.sql` | 2026-05-26 | 历史迁移,状态未知(建库早期) | 新用户首套题完成度调研 + 管理后台统计页 |
