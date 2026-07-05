---
name: smoke
description: Simulate a real user and walk every question type + likely user action to find blocking bugs before/after a release. Use when the user says "模拟真实用户"、"把所有题型和做题时候可能出现的操作都做一下"、"浏览器跑一下看看"、"过一遍所有题型"、"线上看一眼"、"冒烟"、"上线后检查一下".
user-invocable: true
argument-hint: [可选: 线上/本地, 指定题型]
---

# 真实用户冒烟走查

目标环境和范围先确认，走查过程截图留证，只报告不修复。

## Step 0 — 确认目标环境

- **线上**：生产域名是 `https://treepractice.com`（来自 `.env.example` 的 `NEXT_PUBLIC_SITE_URL`）。除非用户另有说明，走查这个地址。
- **本地**：用 `preview_start`（`dev` 配置，端口 3000，见 `.claude/launch.json`）。

用户说"线上看一眼"默认走 `treepractice.com`；说"本地跑一下"/没有明确浏览器连接时走 preview_*。

## Step 1 — 登录

个人题库/Pro 功能需要登录态。**问用户要一个测试登录码**（历史上用户会直接在消息里给，如"用 XXXXXX 这个登录码"）——仓库里没有硬编码的测试账号，不要凭空猜一个码去试。

## Step 2 — 固定走查路径清单（按阻断风险排序）

1. **听力四题型**（LCR / LC / LA / LAT）——重点检查：音频能否正常播放、播放按钮是否可点、有没有"跳过"逃生口（避免像历史上出现过的音频卡死导致做不下去）。
2. **写作三题型**（build-sentence / academic-writing / email-writing）——提交 + AI 评分能否正常返回（DeepSeek 接口、耗时、分数展示）。
3. **阅读**——CTW（填词，注意输入框能不能正常打字提交）/ RDL / AP。
4. **口语**——录音权限提示能正常弹出即可，不强制真的录音评分。
5. **模考入口**——各科目（听力/阅读/写作/口语）能否正常进入、计时器是否运作。
6. **个人题库导入页**（Pro 专属）——上传/导入流程走一遍。
7. **升级按钮弹窗**（UpgradeModal）——注意历史已知坑：有三处升级按钮的 `open-upgrade-modal` 事件监听缺失，点击可能没反应，重点验证。

## Step 3 — 记录

每一步截图留证。发现问题按三级分类：
- **[阻断]** — 用户完全做不下去（例如音频放不出且无跳过、提交按钮报错、页面白屏）
- **[体验]** — 能用但别扭（例如加载慢、反馈延迟、交互不直观）
- **[观感]** — 视觉/文案瑕疵（例如错别字、样式错位、机器味文案）

## Step 4 — 产出

用中文列问题清单，每条标注：题型/页面 + 分级 + 复现步骤 + 截图。**只报告，不修复** —— 修复方案等用户拍板后再动手。

## 工具

- 线上走查：优先用 `claude-in-chrome`（需要用户的浏览器扩展已连接）；如果没连接，退回让用户手动配合或改走本地。
- 本地走查：`preview_start` / `preview_navigate` / `preview_screenshot` / `preview_console_logs` / `preview_network` 等 `mcp__Claude_Preview__*` 工具。

## 触发示例

用户说：
- "模拟真实用户把所有题型走一遍" → 完整走 Step 0-4
- "线上看一眼" → Step 0 默认线上 treepractice.com，走 Step 1-4
- "冒烟一下" → 完整流程
- "上线后检查一下" → 完整流程，通常紧跟在 `/ship` 之后

不应触发：
- "帮我修一下这个 bug" → 那是修复任务，不是走查
- "写个 e2e 测试" → 那是自动化测试代码，不是人工/浏览器走查
