---
name: ship
description: Pre-push check chain — review diff scope, run the test suite, self-audit the changes, verify migration/flag/env preconditions, then commit and push to main. Use whenever the user says "推"、"推送"、"推上去"、"合main"、"部署"、"提交改动"、"确认无bug就推送"、"查一下bug 没bug就提交"、"替换题库 然后推"、"更新日志推上去"、"提交上去" or otherwise asks to ship the current changes. "更新日志推上去" means run /release-notes first, then this skill.
user-invocable: true
argument-hint: [optional commit message hint]
---

# 推送前检查链

在把改动推到 `main` 之前，把该做的检查都做完。这个 skill 假设改动已经在本地完成、待验证待推送。

## Step 1 — 审视改动范围

```bash
git status
git diff --stat
```

把改了哪些文件、大致改了什么列给用户看一眼（不用逐行贴 diff，除非文件很少）。如果有不在预期范围内的文件被改动（例如无关的配置文件），提出来问一句。

## Step 2 — 跑测试

```bash
npx jest --silent 2>&1 | tail -20
```

当前基线是 **571 个测试全过**。如果本次改动新增了测试，数字会更高，以实际输出为准。

- 全过 → 继续下一步
- 有失败 → **停止**，把失败的测试名 + 报错摘要报告给用户，不要继续推送流程

## Step 3 — 自审 diff

对 `git diff` 做一次快速审查，重点看：
- 逻辑错误（边界条件、空值处理、await 漏掉等）
- 漏改的文件（例如改了调用方没改被调用方，或改了一处硬编码的多处副本没同步）
- 调试残留：`console.log`、`debugger`、临时注释掉的代码、写死的测试数据
- 是否不小心带上了 `.env.local`、密钥等敏感文件

发现问题就修，不确定就问用户。

## Step 4 — 核对上线前置条件

读 `docs/BACKLOG.md`（如果存在）和 `scripts/sql/MIGRATIONS.md`（如果存在），对照本次改动检查：

1. **新 SQL 迁移**：本次改动是否新增/修改了数据库 schema？如果 `scripts/sql/` 下有本次新增的 `.sql` 文件，检查它是否已经在 `MIGRATIONS.md` 里登记为"已跑"。没登记 → 必须提醒用户「这个迁移登记了吗？跑过了吗？」并等待确认，不要替用户假设已经跑过。
2. **Feature flag**：本次改动是否引入或依赖需要手动打开的 flag（例如 `BS_GATE_ENFORCE`、`IAP_PROVIDER` 等环境开关）？如果代码路径依赖某个 flag 才生效，明确告知用户「这个功能要生效需要翻 XX flag，目前状态是 ___，需要手动改」。
3. **新 env var**：本次改动是否新增了 `.env.local` 里的变量（读 `process.env.XXX` 出现新名字）？如果有，提醒用户「Vercel 项目设置里要补充勾选/填写 XXX 这个环境变量，否则线上会报错或功能静默失效」。

**任何一项前置条件不满足，必须明确列出并等用户确认后才能继续到 Step 5。** 不要自作主张替用户执行 SQL 或翻 flag。

## Step 5 — Commit + push

```bash
git add <相关文件>
git commit -m "$(cat <<'EOF'
类型(范围): 中文描述

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- 只 add 相关文件，不要 `git add -A` / `git add .`
- 遵循仓库现有 commit 规范（`feat/fix/docs/refactor(scope): 中文描述`，参考 `git log` 最近条目）
- 不要用 `--no-verify` 跳过 hook
- 不要用 `--force`

## Step 6 — 推送后提醒

推送成功后，根据本次改动类型给出后续建议：

- **用户可见变更**（新功能、修复了用户能感知的 bug、UI 调整）→ 建议：「这次改动用户可感知，要不要顺手 `/release-notes` 发个版本公告？」
- **涉及听力/音频/TTS 相关代码** → 提醒：「涉及音频播放逻辑，建议上线后去真实站点走一遍听力练习冒烟测试。」
- **涉及支付/IAP/webhook 相关代码** → 提醒：「涉及支付流程，建议用测试码走一遍 checkout → webhook → tier 升级全链路冒烟测试。」
- **其余情况** → 简单确认推送完成即可，不用画蛇添足。

## 触发示例

用户说：
- "推送" / "推一下" / "推到main" → 跑完整流程
- "确认没问题就推" → 先完整跑完 Step 1-4，全部通过再推
- "部署" → 跑完整流程（本项目是 Vercel 自动部署，push 即部署，不需要额外部署命令）
- "提交上去" → 跑完整流程

不应触发：
- "commit 一下但先别推" → 只做到 Step 3，不要 push
- "看看测试过不过" → 只做 Step 2，不需要整条链路
