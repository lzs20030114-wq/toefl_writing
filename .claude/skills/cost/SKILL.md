---
name: cost
description: Estimate the app's real-money running cost (TTS audio generation) using the fixed cost model for this project. Use when the user says "成本多少"、"每天花多少钱"、"精算一下成本"、"出题成本"、"预算多少"、"按现在的出题速度成本有多少"、"算每周每月每季度每年的" or otherwise asks about generation/running cost.
user-invocable: true
argument-hint: [可选: 时间粒度 / --full-bank]
---

# 成本核算

## 成本口径（固化，不要每次重推导）

- **文本出题**（BS / Discussion / Email / 阅读 / 口语题干等）走 **claude.ai routine 订阅**，边际成本 **¥0**（不走 DeepSeek 按量计费）。
- **只有听力 TTS 配音**（gpt-4o-mini-tts）按量掏钱。
- 音频成本 ≈ 口播词数 ÷ 140（词/分钟，TOEFL 听力语速）× 每分钟单价。
- DeepSeek 写作评分（`/api/ai`）是另一项按量成本，跟出题 TTS 是两回事，用户问"出题成本"默认指 TTS。

## 步骤

### Step 1 — 跑脚本

```bash
node scripts/estimate-tts-cost.mjs                # 日常增量口径（routine 每晚的产出量）
node scripts/estimate-tts-cost.mjs --full-bank    # 全库一次性口径（把现有全部题库重新配一遍音）
```

脚本只读本地题库文件（`data/listening/bank/*.json`），没有外部调用、不产生真实费用。可选参数：`--wpm` 覆盖语速、`--model` 切换 TTS 模型、`--cny` 覆盖美元兑人民币汇率。

### Step 2 — 输出人民币表格

把脚本输出整理成：每天 / 每周 / 每月 / 每季 / 每年，人民币口径。**注明"满勤理论值 vs 实际"**——历史参考：满勤理论值约 ¥50/月，实际约 ¥33/月（routine 不是每晚满勤跑）。

### Step 3 — 用户问非 TTS 成本时

明确说明口径分界：
- **¥0（订阅内，边际零成本）**：文本出题（BS/Discussion/Email/阅读/口语），走 claude.ai routine。
- **按量计费**：听力 TTS 配音（gpt-4o-mini-tts）、DeepSeek 写作评分 API（`/api/ai`）。

不要把订阅内的文本生成也算进"出题成本"，那会让数字虚高、误导决策。

### Step 4 — 降本杠杆提示

如果用户觉得成本偏高，提示：**退回免费 edge-tts**（`--tts-provider edge`，历史上项目用过，语音质量较机械但零成本）是最直接的降本杠杆，目前用 gpt-4o-mini-tts 是为了语音质量做的取舍。

## 触发示例

用户说：
- "现在出题成本多少" → 完整走 Step 1-2
- "每天花多少钱" → Step 1（日常口径）+ Step 2
- "全库配音要多少钱" → Step 1（`--full-bank`）+ Step 2
- "精算一下成本" → 完整走 Step 1-4
- "文本生成也要花钱吗" → 直接回答 Step 3 的口径说明，不用跑脚本

不应触发：
- "DeepSeek 评分接口挂了" → 那是故障排查，不是成本核算
