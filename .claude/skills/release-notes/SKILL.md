---
name: release-notes
description: Publish a new release by updating both CHANGELOG.md (developer-facing) and data/announcements.json (user-facing in-app panel) together. Use whenever the user says "更新"、"发版"、"更新日志"、"更新公告"、"release notes" or asks to write release notes / announce a release.
user-invocable: true
argument-hint: [optional summary of what's in this release]
---

# 发版工作流 — CHANGELOG + 公告

这个 skill 负责把"代码已经合并、需要告诉用户"的工作做完。最关键的认知：
**项目有两份发版日志，职责不同，必须同时更新**。

| 文件 | 受众 | 风格 |
|---|---|---|
| `CHANGELOG.md` | 开发者 / 代码审计 | 技术细节：根因、call site、影响范围 |
| `data/announcements.json` | 终端用户（首页「更新公告」面板读取） | 结果导向人话："修复了 X 问题，现在 Y 能正常工作" |

只更新一份就是这次踩过的坑（user: "没见到更新啊"）。

---

## 标准流程

### Step 1 — 收集本次要发的内容

**先看现状**，不要凭空写：

```bash
# 看最新已发布版本（决定本次版本号 + 时间窗）
head -10 data/announcements.json
# 输出会告诉你最近一条的 id（如 "2026-05-20"）和 title（如 "v1.6.8 更新公告"）

# 列出自上次发版以来的所有 commit
git log --since="<上次发版日期>" --oneline
# 或者：git log <last-tag>..HEAD --oneline
```

**禁止**凭空编造内容。所有 item 必须能映射到某个 commit 或用户明说的事。

如果用户没明确说要发什么，**先列出候选 commit 给用户确认**：
> 自 v1.6.8（5-20）以来有 X 个 commit：
> 1. abc1234 fix(reading): ...
> 2. def5678 feat(speaking): ...
> 哪些要发？

### Step 2 — 决定版本号

读 `data/announcements.json[0].title` 看当前版本（如 `v1.6.8`）。

- **默认**：补丁号 +1（`v1.6.8` → `v1.6.9`）
- **bump minor**：用户明说"这是个大功能"或本次包含明显新特性（`v1.6.x` → `v1.7.0`）
- **bump major**：用户明说"重做了 XX" 或 BC-break

把建议的新版本号告诉用户，等确认。

### Step 3 — 更新 CHANGELOG.md（开发者视角）

在文件顶部 `# Changelog` 之后插入新条目。

格式（match 仓库现有风格，**用中文** 因为最近条目都是中文）：

```markdown
## YYYY-MM-DD

- 简短描述这次的核心修复 / 新增。
- 根因 / 机制：当前是 commit X 部分回退 / 数据迁移 / 并发竞争 等。
- 修复点：列出关键的 4 个 call site 或新增的文件 + tests。
```

每个 item 1-3 行，**包含技术细节**。开发者后续审计能凭这个找到为什么。

### Step 4 — 更新 data/announcements.json（用户视角）

在数组**头部**插入新对象：

```json
{
  "id": "YYYY-MM-DD",
  "date": "YYYY-MM-DD",
  "title": "vX.Y.Z 更新公告",
  "items": [
    "...",
    "..."
  ]
}
```

**items 写作准则**：
- ❌ "修复 SSR/CSR 水合错位" / "重构 ReferralContext state machine"
- ✅ "修复了首页偶尔闪烁的问题" / "邀请活动状态在多个标签页之间同步了"
- ❌ "extractCorrectedWord 去掉 last-word fallback"
- ✅ "拼写练习不再偶尔给出错误的正确答案"
- 每条聚焦**用户能感知到的变化**，剥离实现细节
- 每条尽量一句话，关键信息靠前

如果你要从 CHANGELOG 翻译到用户语言：去掉技术名词、保留结果。

### Step 5 — 验证 JSON 合法性

JSON 一旦坏掉首页公告面板会整个炸开。必查：

```bash
node -e "const a=require('./data/announcements.json'); console.log('OK', a.length, 'entries; latest:', a[0].title, a[0].date, '|', a[0].items.length, 'items')"
```

如果输出不是 `OK <N> entries...` 形式 → 修，不要 commit。

### Step 6 — Commit + push

**两份文件用一个 commit**：

```bash
git add CHANGELOG.md data/announcements.json
git commit -m "$(cat <<'EOF'
docs(release): vX.Y.Z — <一句话核心>

<2-4 行展开>。涵盖：<bullet 列表>。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

**只更新 CHANGELOG（没新发布）的话**用 `docs(changelog): ...`。
**只更新 announcements** 不应该发生 — 那意味着 CHANGELOG 缺了一条。

### Step 7 — 告诉用户结果

格式：

```
✅ 已推送（<commit-hash>）

- CHANGELOG.md +N 行
- data/announcements.json：v<old> → v<new>，<M> 个用户可见 item

Vercel 几分钟后自动部署，首页「更新公告」面板会出现新版本。
```

---

## 常见陷阱 & 已知约定

1. **跨日积压** — 如果上次发版到现在过了好几天，可能积累多个 CHANGELOG 条目都没进公告。本次 `announcements.json` 可能需要囊括 CHANGELOG 的多个日期。
   - 例子：今天 5-20，CHANGELOG 已经有 5-19 + 5-20 两批条目，但 announcements.json 只到 5-15。这种情况一个 v1.6.X 把两批都打包。

2. **announcement 不要回头改** — id 是日期 + 版本号唯一标识，发出去就不该改文案。要补充就开下一个版本。

3. **CHANGELOG 可以 polish** — CHANGELOG 是开发文档，发出去也能补内容 / 修措辞。

4. **格式参考已有条目** — 真要犹豫语气，复制最近一条改。

5. **版本号不能跳跃**：当前是 v1.6.8 → 下次只能是 v1.6.9 / v1.7.0，不能直接 v1.6.11。

6. **JSON 的字段顺序**：固定 `id, date, title, items` —— 与现有条目一致。

7. **`Co-Authored-By` 格式**：跟项目里其它 commit 一致（找几个 `git log --grep="Co-Authored-By"` 看模板）。

8. **永远不要 `--no-verify`** — 项目有 pre-commit 钩子的话让它跑。

---

## 触发示例

用户说：
- "更新一下" → 跑完整流程
- "更新日志" → 默认两份都更，除非用户明说只更一份
- "发版" → 跑完整流程
- "更新公告" → 跑完整流程
- "release notes" → 跑完整流程
- "把这次的改动发出去" → 跑完整流程

不应触发：
- "更新代码" / "更新依赖" / "改下 XX 字段" → 那是代码改动，不是发版
- "看下日志" / "查 changelog" → 那是查询，不是发版

如果用户的意图不清晰（例如刚做完一个修改，没说要发版），**问一句**：「这次的修改要不要也发个版本公告？」
