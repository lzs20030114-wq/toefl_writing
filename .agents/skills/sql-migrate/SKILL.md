---
name: sql-migrate
description: Supabase migration ritual for this project — write SQL to scripts/sql/, hand it to the user to run in the Supabase SQL Editor, then register it in scripts/sql/MIGRATIONS.md once confirmed. Use whenever the user talks about creating tables, database migrations, schema changes, or adding/altering columns ("建表"、"迁移"、"SQL"、"schema"、"字段"、"给我建表的命令"、"给我建表的代码"、"supabase的建表命令发我"、"sql要我怎么跑"). Also trigger when the user reports completion ("建好了"、"跑完了"、"建表完成了") — that means run the registration/bookkeeping step.
user-invocable: true
argument-hint: [description of the schema change]
---

# Supabase 迁移仪式

**背景**：本项目 Supabase 没有 CLI 迁移链路（没有 `supabase migration` / migration 目录跟踪状态）。所有 SQL 都是手写文件放在 `scripts/sql/`，由用户手动复制粘贴到 Supabase 控制台的 SQL Editor 里执行。这个 skill 负责把这套手动流程走完整、并且留痕，避免"写了但没人知道跑没跑"。

## Step 1 — 写迁移文件

把本次的 SQL 写到 `scripts/sql/<语义化名字>.sql`，文件名用连字符、能看出用途（参考现有文件如 `user-question-banks-widen-types.sql`、`daily-usage-quota.sql`）。

**幂等写法是硬要求**，因为用户可能重复执行、或者这段 SQL 会在不同环境跑多次：
- 建表用 `CREATE TABLE IF NOT EXISTS`
- 建索引用 `CREATE INDEX IF NOT EXISTS`
- 加列用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- 建/替换函数、视图用 `CREATE OR REPLACE`
- 改约束（如 CHECK）通常需要先 `DROP CONSTRAINT IF EXISTS` 再加新的
- 如果是一次性数据修复/回填，加注释说明这条语句重复执行是否安全

## Step 2 — 交给用户执行

把 SQL 全文贴出来（不要只说"写好了"），明确请用户：

> 请把下面这段 SQL 复制到 Supabase 控制台的 SQL Editor 里执行，跑完告诉我一声。

不要假设自己能直接连接 Supabase 执行 —— 本项目没有配置这条自动化链路，必须走人工执行。

## Step 3 — 登记

等用户回复"跑完了"/"执行了"/"建好了"/"建表完成了"/类似确认后，在 `scripts/sql/MIGRATIONS.md` 里追加一行登记：

```
| <文件名> | <今天日期> | 已跑 | <一句话说明这个迁移做了什么> |
```

**不要在用户确认之前就写"已跑"** —— 这是留痕的意义所在，防止"以为跑了其实没跑"。

## Step 4 — 提醒下游影响

告知用户：

> 这条迁移在 `MIGRATIONS.md` 里登记为"已跑"之前，`/ship` 推送前置检查会拦下相关代码改动的推送（如果它依赖这个迁移的话）。

如果本次改动的代码（如新 API 读写某张表/字段）依赖这条迁移，提醒用户：**先跑迁移，再推代码**，顺序反了会导致线上报错（代码已上线但字段/表还不存在）。

## MIGRATIONS.md 维护规则

`scripts/sql/MIGRATIONS.md` 是本项目所有 SQL 文件的登记表，字段：文件名 | 执行日期 | 状态 | 作用。

- 状态取值：`已跑` / `无需跑`（例如后来被代码路径架空、或只是文档性质）/ `历史迁移,状态未知(建库早期)`（早期文件，创建时未建立登记习惯，无法追溯）
- 每次用 `/sql-migrate` 新增迁移都要追加登记，不要漏登记
- 不要回填修改历史迁移的登记状态，除非用户明确告知这条历史迁移的真实执行情况

## 触发示例

用户说：
- "建个表存 XX" → 完整走 Step 1-3
- "加个字段" → 完整走 Step 1-3
- "这个功能需要改 schema" → 完整走 Step 1-3
- "SQL 迁移登记一下" → 只做 Step 3（用户已经手动跑过，只需登记）

不应触发：
- "查一下数据库里有什么" → 那是查询，不是迁移
- "这个字段是干嘛的" → 那是提问，读代码回答即可
