---
name: research-reuse
description: Research whether an existing GitHub project or open-source solution can be reused instead of building from scratch, evaluate candidates against project constraints, and produce a build-vs-buy recommendation report. Use when the user asks "看看github有没有现成的"、"有没有半成品"、"能不能直接拿来用"、"调研一下方案" or wants to check for existing solutions before building something new.
user-invocable: true
argument-hint: <要调研的功能/方案主题>
---

# GitHub 半成品调研

在动手自建一个功能之前，先看看是否有现成的开源方案能直接用、或者能借鉴思路。目标是给出一个有依据的 build-vs-buy 结论，而不是"随便搜了几个链接"。

## Step 1 — 确认约束

先和用户确认调研的约束条件。**默认继承本项目的技术栈和场景**，除非用户另有说明：

- **技术栈**：JS / Next.js（App Router），能直接跑在 Vercel serverless 环境
- **网络可达性**：目标用户在中国大陆，任何运行时依赖（API、CDN、字体、第三方服务）必须国内可达，或者有能绕过网络限制的方案（本项目已有先例：TTS 走代理、DeepSeek 走国内可访问的 API）
- **许可**：需要能商用（本项目是收费 Pro 订阅产品），避免 GPL 类强 copyleft 许可污染商业代码库；MIT/Apache-2.0/BSD 优先
- **维护活跃度**：优先选最近有提交、issue 有人回应的项目，避免拖入一个已经死掉的库

如果用户的场景明显偏离以上默认值（比如调研的是纯离线脚本/管理后台工具，网络可达性约束不适用），跟用户确认一下再调整。

## Step 2 — 搜索

至少两轮不同关键词组合的搜索，兼顾 Web 搜索和 GitHub 搜索：

- 第一轮：直接功能描述关键词（中英文都试，例如 "TOEFL speaking scorer open source" 和 "英语口语评分 开源"）
- 第二轮：换用更技术化/更具体的关键词（具体算法名、库名、相邻领域的实现）
- 如果第一轮结果都是几年不更新的老项目，第三轮换关键词再搜一次

不要只看第一页结果就下结论，星标数不代表适配度，机制/接口是否契合本项目更重要。

## Step 3 — 候选评估表

对找到的每个有价值候选（通常 3-6 个），列表评估：

| 项目 | stars | 最近提交 | 许可 | fit 度 | 改造成本估计 |
|---|---|---|---|---|---|
| owner/repo | X.Xk | 2026-XX（几个月前/活跃/几乎停更） | MIT/... | 高/中/低 —— 说明为什么 | 小/中/大 —— 大致要改哪些地方才能接进本项目 |

fit 度要具体说明：是否需要额外后端服务（增加运维负担）、是否有现成的 JS/Node 绑定还是要跨语言调用、数据格式是否要转换、能否直接 npm install 还是要 vendor 进来改代码。

## Step 4 — 结论

三选一，给一句话理由：

1. **直接复用** —— 有合适的库，npm install 或 vendor 进来改动很小就能用
2. **借鉴思路自建** —— 没有能直接用的，但某个项目的架构/算法/prompt 设计值得参考，自己实现
3. **完全自建** —— 调研后发现现有方案都不合适（不可达/许可冲突/改造成本过高/质量不够），从零写

理由要基于 Step 3 的评估表，不要泛泛而谈。

## Step 5 — 落盘报告

把调研过程和结论写到 `data/claudeGen/reports/RESEARCH-<主题>-<日期>.md`（日期格式 YYYY-MM-DD，主题用英文/拼音短横线命名，参考仓库里已有的 `USER-BANK-ALL-TYPES-RESEARCH-2026-07-04.md` 命名风格）。

报告结构：
```markdown
# <主题> — 方案调研

## 约束
（Step 1 确认的约束条件）

## 候选评估
（Step 3 的表格）

## 结论
（Step 4 的结论 + 理由）

## 下一步
（如果结论是复用/借鉴，给出具体的接入/参考步骤建议）
```

调研完成后把报告路径和结论摘要回复给用户，不需要用户再单独要求才写报告。

## 触发示例

用户说：
- "看看 github 有没有现成的口语评分方案" → 完整走 Step 1-5
- "这个功能有没有半成品能拿来用" → 完整走 Step 1-5
- "调研一下听力题生成有没有开源方案" → 完整走 Step 1-5
- "能不能直接拿来用" （承接上文某个具体项目）→ 针对该项目走 Step 3-4，不用重新搜索

不应触发：
- "这个库怎么用" （已经决定要用某个库，只是问用法）→ 那是查文档，不是调研
- "重构一下 XX 模块" → 那是重构任务，不涉及外部方案选型
