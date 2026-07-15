# 按需出题信号 (On-demand Generation Signal)

> 让每晚的 Claude 出题 routine 从「12 库全量出」改为「谁快刷穿就补谁」。

## 为什么

以前 R1 routine 每晚给全部 12 个题库无差别出题。绝大多数库其实没人做到底，
纯属浪费额度（尤其听力 TTS 是真金白银）。本功能每天先统计真实做题进度，
只对「有人接近刷穿 / 跑道不足 / 库存跌破红线」的库出题，其余库当晚跳过。

## 机制（数据流）

```
GitHub Action gen-demand.yml (cron 17:30 UTC = 北京 01:30, 03:00 routine 前的 buffer)
  → node scripts/compute-gen-demand.mjs
       ├── 分页拉 Supabase sessions 表 (只取 user_code,type,date,details；type="mock" 过滤掉)
       ├── 读 13 个 live 库文件拿 {每库 id 集合 + 题量}
       └── lib/genDemand/computeDemand.js (纯函数) 算需求
  → 写 data/.gen-demand.json (仅聚合数字，绝无 user_code)
  → 有变化才 commit ([skip ci]) + push
→ 03:00 Claude routine 读该文件 → 只出 generate=true 的库，各出 n 题
```

- **纯函数** `lib/genDemand/computeDemand.js`：所有 id 提取、交集归属、触发、产量、
  音频总量裁剪都在这里，无 I/O，单测覆盖在 `__tests__/gen-demand.test.js`。
- **薄壳** `scripts/compute-gen-demand.mjs`：只负责拉数据、读库文件、写文件。

## 指标口径

**活跃用户**：近 7 天（按 session 的 `date` 字段）有任意一条 session 的用户。

**消耗 (consumed)**：某用户某库的 consumed = 「该用户历史所有 session 提取出的题目 id
去重集」∩「当前库的 id 集」的大小。用**交集**归属有两个好处：

- 退役题、个人题库（"我的"）的题自动不计入（它们的 id 不在 live 库里）。
- `rdl` 练习只存 `subtype:"rdl"` 不分 short/long——靠 id 落在哪个库来区分归属。

各类型的 id 提取来源：

| session | 提取字段 |
|---|---|
| 阅读练习 `type=reading` | `details.itemId` |
| 听力练习 `type=listening` | `details.itemIds[]`（展平） |
| 口语练习 `type=speaking` | `details.setId` |
| 写作 `type=email` / `discussion` | `details.promptId` |
| 阅读/听力模考 `subtype:"mock"` | `details.m1.tasks[].itemId` + `m2.tasks[].itemId` |
| 口语模考 `subtype:"mock"` | `details.repeatSetId` + `details.interviewSetId`（口语模考**没有** m1/m2.tasks） |
| BS 造句 `type=bs` | 无 id，特殊处理见下 |
| 写作模考 `type=mock` | **忽略**（v1 不计写作 3-task 模考的消耗） |

**BS 特例**：BS session 的 `details` 是数组、没有任何 set id。所以 BS 的
consumed ≈ 该用户 `type=bs` 且 `date >= 2026-06-16`（换库日）的 **session 次数**
（picker 排重保证每 session ≈ 一个新 set）。误差方向是**高估**消耗，可接受。

**每库指标**（写进 `.gen-demand.json`）：

- `bank_size`：live 库题量。
- `top_user_consumed` / `top_user_pct`：**活跃用户里**消耗最多的那个人的量 / 占比。
- `burn_7d`：近 7 天窗口内全站消耗的去重 id 数 ∩ 当前库（BS 用窗口内 session 数）。
  **仅作信息展示**，不参与任何触发判定（见下）。
- `min_user_runway_days`：跨活跃用户的**最小个人跑道**（天，1 位小数）；
  窗口内没人碰过该库时为 `null`。这是 T2 的判定依据。

## 触发与产量

**核心前提：题库不是共享消耗池。** 每个用户各自刷各自的进度——A 做过某题不影响
B 还能做它。所以「还有几天刷穿」必须按**每个用户自己的剩余量 ÷ 自己的速度**算，
绝不能拿全站合计燃烧速度去除头号用户的剩余量（那是 v1 初稿的设计错误，会导致
夜夜过量生产）。

对每个 bank、每个活跃用户 u：

```
remaining_u = bank_size - consumed_u        （consumed_u 即上文交集口径）
burn_u      = 用户 u 近 7 天窗口内消耗的去重 id 数 ∩ 当前库
              （BS 特例 = 该用户窗口内 type=bs 且 date>=换库日 的 session 次数）
runway_u    = burn_u > 0 ? remaining_u / (burn_u/7) : +∞   （天）
```

**触发条件（满足任一即出）**：

- **T1**：`top_user_pct >= 0.70`（有人快刷穿了）。
- **T2**：存在任一活跃用户 `runway_u < 14`（有人按自己的速度 14 天内会刷穿）。
- **T3**：`bank_size < 红线`（文本库 40 / 音频库 30）。

**建议产量 n** = 各触发项对应量取最大，再 clamp 到 `[4, cap]`：

- T1：`ceil(top_user_consumed / 0.6) - bank_size`（补到头号用户占比回落 60%）。
- T2：`max over 触发用户 of ceil((burn_u/7)*14 - remaining_u)`（把最紧张用户的跑道补到 14 天）。
- T3：`红线 + 10 - bank_size`（补到安全线以上）。
- **cap**：文本库每晚每库 ≤ 20；音频库每晚每库 ≤ 10，且**所有音频库 n 总和 ≤ 25**
  （超了按严重度裁剪：`top_user_pct` 降序、再按 `min_user_runway_days` 升序，
  保留最紧张的，边界库裁到剩余额度，其余顺延到明晚）。

红线归类：
- 文本库（floor 40, cap 20）：`bs` `discussion` `email` `ctw` `reading-ap` `rdl-short` `rdl-long`
- 音频库（floor 30, cap 10）：`lcr` `lc` `la` `listening-lat` `speaking-repeat` `interview`

## bank key 命名（重要）

`.gen-demand.json` 里 `banks` 的键和 `routine_instructions` 用的是这套 key：

```
bs, discussion, email, reading-ap, ctw, rdl-short, rdl-long,
listening-lat, lc, la, lcr, speaking-repeat, interview
```

注意这和 `docs/quality-pipeline.md` 里 gate/report 用的键**略有出入**
（那边是 `reading-ctw` / `listening-lc` / `listening-la` / `listening-lcr`）。
routine 读 `.gen-demand.json` 时以**本文件这套 key 为准**；接线时把 routine 内部的
库名映射对齐到这里即可。`interview` 因为 prompt 校准还没做（deferred），
在文件里照常统计但打上 `"not_in_routine": true`，且**不会**出现在 `routine_instructions`。

## 输出文件形状 `data/.gen-demand.json`

```json
{
  "generated_at": "ISO 时间",
  "window_days": 7,
  "active_users": 18,
  "banks": {
    "ctw": {
      "bank_size": 276, "top_user_consumed": 95, "top_user_pct": 0.344,
      "burn_7d": 147, "min_user_runway_days": 13.3,
      "triggers": ["T2"], "generate": true, "n": 6,
      "reason": "最快用户按其近7天速度仅剩约 13 天刷穿（低于 14 天），建议补 6 题。"
    }
  },
  "routine_instructions": [
    "Generate 6 ctw reading items"
  ]
}
```

**隐私红线**：文件里任何位置都不出现 `user_code` 或任何用户标识，只有聚合数字。
纯函数强制保证这一点（`top_user_consumed` 等都是「最大值」而非「谁」）。

## 每晚对账邮件

demand 为空的夜晚 routine **按设计**不出题，但从外面看和 routine 挂了一模一样——
所以 gen-demand workflow 每晚算完信号后必发一封对账邮件
（`scripts/build-gen-demand-email.mjs` 生成，Gmail SMTP 发给自己，
**不加 continue-on-error**：邮件本身就是心跳，发不出去 workflow 直接红掉）。
主题一眼区分两种夜晚：`今晚无需出题 ✅` vs `今晚计划: bs×7, ctw×20`；
正文含活跃用户数、每库一行摘要（库存/top用户%/最小跑道/触发/n）。

**判读表**：

| 现象 | 结论 |
|---|---|
| 没收到本邮件 | 信号 workflow 没跑成，去 GitHub Actions 查 `gen-demand` |
| 收到「无需出题」+ 明早无出题 commit | 正常 |
| 收到「计划出题」+ 明早无出题 commit | routine 没跑，需检查 |

interview 若触发生成，邮件会单独注明「not_in_routine，routine 不会出，需人工关注」。

## v1 已知局限

1. **未登录用户盲区**：只统计有 session 落库的用户。纯本地/未登录做题不产生
   Supabase session，看不到，因此可能低估真实消耗。
2. **不区分难度分层**：只看整库消耗，不看 easy/medium/hard 各档跑道。若某档特别快
   被刷穿，整库指标可能掩盖它。routine 拿到 n 后仍应按各难度层均衡产出。
3. **写作模考不计**：`type="mock"`（写作 3-task 固定卷）的消耗 v1 不统计。
4. **BS 是近似**：BS 无 id，按 session 计次，方向性高估。
5. **口语 interview 不进 routine**：统计但不出（prompt 校准 deferred）。

## 边界行为

- 零活跃用户：只有 T3 可能触发（库存本身低于红线）。
- malformed 的 session 行（`details` 缺失/形状不对）：静默跳过，绝不 throw。
- 空名单：当晚所有库都不触发 → `routine_instructions: []` → routine 只做常规维护、不出题。

---

## 贴进 routine trigger prompt 的文字

> 把下面这段加进 R1 routine 的 prompt（trigger 配置里，不在本仓库），
> 让它开跑前先读需求文件：

```
Before generating, read the file data/.gen-demand.json from the repo.

- If the file is MISSING, or its `generated_at` is more than 48 hours old,
  IGNORE it and fall back to the original behavior: generate a small batch for
  all 12 banks as before.

- Otherwise, generate ONLY the banks whose `generate` field is true AND that do
  NOT have `"not_in_routine": true`. For each such bank, produce exactly the
  number of items given by its `n` field. The human-readable list is in
  `routine_instructions` (e.g. "Generate 20 ctw reading items").

- Map the demand-file bank keys to your internal bank names as needed. The keys
  are: bs, discussion, email, reading-ap, ctw, rdl-short, rdl-long,
  listening-lat, lc, la, lcr, speaking-repeat (interview is measured but never
  generated here).

- If `routine_instructions` is EMPTY, skip generation entirely tonight and only
  do routine maintenance. Nothing is close to being exhausted — do not force
  output just to have output.
```
