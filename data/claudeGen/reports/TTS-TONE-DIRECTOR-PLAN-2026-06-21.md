# TTS 语气导演（Tone Director）— 锁定执行方案

> 状态：**LOCKED**（2026-06-21）。经 10-agent 工作流（4 并行摸码 → 设计 → 4 视角对抗自审 → 定稿）+ 人工复核两处承重断言。
> 目标：听力生题时，每条题自动按内容导出语气——**确定的倾向（emotion）+ 内部数值（intensity 0–1，永不发给 OpenAI）+ 渲染出的自然语言 instructions**，喂给 gpt-4o-mini-tts。真考语速、永不放慢；默认克制。

---

## 0. 一句话架构

新模块 `lib/tts/toneDirector.js` 是唯一大脑（注入 DeepSeek、无文件 IO、可单测）。它对每条题产出语气记录，存进 **sidecar** 文件；`backfill-tts.mjs` 合成时把 `instructions` 透传给 OpenAI。**`lib/tts/openaiTts.js` 零改动**（已验证它本就解析并透传 `opts.instructions`）。

```
文本 + 角色
  → derivePersona（同步/确定/无 LLM：角色→安全音色 + persona 文案 + intensity 上限）
  → deriveItemTone（1 次 DeepSeek/题，温度0.2，整段上下文，输出每句 ToneRecord）
  → reviewItemTone（alexandria 式二次过：封顶强度、回退过度情绪、全题 affect 上限）
  → renderInstructions（确定渲染：中性走快速路径=纯 persona+语速句；永不返回 ''）
  → 写 sidecar {type}.tone.json + _src 缓存哈希
  → backfill-tts 读 sidecar，在 3 个 segment 接缝把 instructions 传给 OpenAI
```

## 1. 对抗自审改写了原设计的 6 个关键事实（均已核码）

1. **1,484 条题全部已有 `audio_url`（edge 合成），无一有 `tts_sig`** → 朴素"sig 不符就重合成"会在首次切 openai 时**整库重合成**。→ 重合成**默认关闭**，仅 `TTS_RESYNTH=1` 开启；默认 `backfill-tts` 行为不变（有 audio_url 就跳过）。
2. **`deepseekHttp.js` 不重试 429/超时**（已核 [deepseekHttp.js:33](../../lib/ai/deepseekHttp.js)）→ `backfill-tone.mjs` 自带有界并发(2–4)+429 退避，**只在成功时写缓存哈希**。
3. **原 gate 建在 substring bug 上**：真语料里 substring `ugh` 命中 40 条（全是 b**ough**t / en**ough** / thr**ough** 的误报），词边界 `\bugh\b` = 0。→ 探测器改用**词边界 + 语气词位置**匹配。
4. **真·多轮对话语料只有 5 条**（太稀疏不能按句建 band）→ 改为**按题、跨 4 个文件拍平文本**度量，n=390；用 `share_over` 聚合（"出现即计"的近零不变量）。
5. **`gateHarness.aggregate` 只实现了 mean**（已核 [gateHarness.js:42](../../lib/gate/gateHarness.js)）→ 一条 "Yikes!!" 异常题会被 397 条均值冲淡。→ **给 harness 加 `share_over` 聚合器**（真改 harness，非仅注册表），专抓异常热项。
6. **preset key 三处不一致**（generate-lc 用 `student_male/librarian`、backfill 用 `lcr_staff_female`、openaiTts 表又不同，且含 400-风险的 cedar/marin）→ persona 内置**确定的"角色→安全音色"表** + backfill 启动时**断言每个 preset key 在当前 provider 存在**（否则快速失败，绝不静默回落到 marin 单一音色）。

## 2. 锁定决策

- **接入**：backfill-pass 为主、gen-time hook 为辅，二者都调 `toneDirector.annotateItem`。
- **`openaiTts.js` 零改动**（已验证）。
- **语气存 sidecar** `data/listening/bank/{lc,lat,la,lcr}.tone.json`（按 id 键），**不内联**进题库——保持题库 diff 可读、语气可独立重导。
- **缓存** `_src = sha256(text + personaInputs(含解析后的 presetKey) + policyVersion + emotionEnumVersion)`；命中即**逐字复用**已存 ToneRecord（含最终 instructions），**不再调 DeepSeek** → 把温度 0.2 的非确定性只限在首次导出。**只在成功时**写缓存。
- **`tts_sig = sha256(provider + presetKey + instructions + text)`**——**voice 不进 sig**（voice 是 presetKey 的纯函数、且未存在题库上，进 sig 会非确定）。由 `backfill-tts` 在合成时算。
- **openai 音频写版本化路径** `{id}.openai.mp3`，绝不覆盖 edge 音频（回滚=改回 audio_url 指向）。
- `renderInstructions` **永不返回 ''**；若语气记录存在但 instructions 为空 → `backfill-tts` **致命报错**（绝不静默回落到慢速 preset，已核 openaiTts:139 的 `||` 回落）。
- **全库语气大扫除（Phase 5）阻塞**于已排队的"文本层 register 校准（Yikes/Ugh）"先落地——二次过只导**朗读方式**，不改文本层口语词。

## 3. ToneRecord（存进 sidecar 的规范）

```jsonc
{
  "emotion": "<enum>",      // 单一主导倾向
  "intensity": 0.0,         // 0–1，内部用：永不发 OpenAI；喂渲染分档 + gate 审计
  "emphasis": ["..."],      // LC 至多 1 个短语（原设计 0–3 会过度导演）；单句题 0–2
  "pace": "natural",        // 冻结；schema 拒绝其它值；渲染硬禁更慢
  "instructions": "..."     // 渲染出的、真正发给 gpt-4o-mini-tts 的自由文本；永不 ''
}
```
**emotion 枚举（冻结、小、对齐真题克制）**：`neutral`(默认) / `mild_concern` / `reassuring` / `encouraging` / `curious` / `amused` / `apologetic` / `emphatic_info`。**无 panicked/angry/excited**——真语料感叹号占比 0.0026、强语气词 0.0077（实测），热情绪天然出局。

**渲染（确定）**：
- 中性快速路径：`{personaText} Keep a natural, exam-standard speaking pace; do not slow down.`
- 非中性：`{personaText} Deliver this line {emotionPhrase} {intensityBand}.{ 可选 " Lightly stress: …."} Keep a natural, exam-standard speaking pace; do not slow down.`
- intensity → 只转**粗档副词**（0–.33 无夸张 / .34–.66 轻微自然起伏 / .67–1 明显但仍克制）；**数字永不进 instructions**。

## 4. 防退化门（只度量"文本里真能量到的")

- **(A) 源文本 register 探测器** `lib/gate/measurers/listeningTone.js`：按题、跨 4 文件拍平文本（n=390）；词边界 + 语气词位置；`strong_interjection_present` = **hard / share_over / band [0, 0.02] / precision 1.0**（克制托福里语气词"出现"是分类近零不变量，任意 n 都成立）；`exclamation_present` = monitor。
- **(B) 渲染输出探测器** `lib/gate/measurers/toneOutput.js`（审导演自己的产物）：每条 instructions **必含语速句、无慢速措辞**、`intensity ≤ 类型上限`、**一题内 instructions 不得全相同**（反退化为"哑导演"）——precision 1.0 的确定断言，可硬门。
- **harness 改动**：`aggregate` 加 `share_over`；`validateRegistry` 禁止对 zero-target 用 drift（会塌成 [0,0]）。

## 5. 分阶段路线（原型优先）

| Phase | 内容 | 产出/门槛 |
|---|---|---|
| **0** | 大脑原型（lc-first，不写库）：抽 `pickVoicePresets`(含 tie-break)进 `derivePersona`+安全音色表；写 `renderInstructions`+stub `deriveItemTone`；单测渲染不变量 | 纯本地，零成本 |
| **1** | 单条 lc 端到端真 DeepSeek 行级语气 + 二次过：验克制默认、热句被封顶、全题 affect 上限 | 只打印不落库 |
| **2** | **先把两个门立起来（先有尺再量）**：加 `share_over`；写两个 measurer + 注册表 + 退化 fixture；`--derive`(n=390)/`--selfcheck`/`--gate` 记基线 | 门绿 |
| **3** | `backfill-tone.mjs` 跑 ~20 条 lc 切片：写 sidecar+缓存、有界并发+429退避；重跑证幂等(DeepSeek 不再调)；`--retry-failed` | 两门绿 |
| **4** | 接生产音频（仅 lc 切片，A/B 干净）：backfill-tts 分支 openaiTts + preset-key 断言；3 接缝传 instructions + 空值致命断言；版本化路径；`TTS_RESYNTH` + `--dry-run` 花费预检 | **A/B 仅变 instructions、同音色同引擎**，对真题中性基线打分 |
| **5** | 全库扫除（**阻塞**于文本 register 校准先落地）：全 4 库 backfill-tone → 仅净增/变更 sig 走 openai；门保持绿 | 一次性、命名、预算、需 `TTS_RESYNTH=1`，**绝不 cron 隐式触发** |
| **6** | gen-time hook：generate-lc/lat/la/lcr 加可选 annotateItem（语气失败退回中性默认，绝不让建题失败）；edge 路径保持 tone-blind、快、默认 | — |

## 6. 成本

- **DeepSeek（分析）= 唯一 per-item LLM 成本**；OpenAI 只出声。冷扫 ≈ 2×(398+233+289+564) ≈ **~3,000 次低温短 JSON 调用，按 `_src` 缓存 → 一次性，重跑免费**；有界并发(3)+退避，约 **30–50 分钟** 可断点续。
- **OpenAI**：语气**零增量**（instructions 同一调用内的自由文本）。真正花钱的是 **edge→openai 切换**：首次切换每条都没 sig，`TTS_RESYNTH=1` 下整库重合成 ≈ 3,600 个付费 clip ≈ **$15–40 一次性** + 全量 Supabase 重传。**预算化、命名、需 `--confirm`、有 `--dry-run` 预检**；默认 backfill 不开此 flag → 除净增题外 **$0**。

## 7. 我的人工自审补充（工作流范围外的策略点）

1. **先后顺序**：本方案是"语音升级"的**生产化泛化**，应在**投票弹窗验证用户意愿（并愿付费）之后**再大投入。先上投票 → 用户说值 → 再建导演。Phase 0–1 是小原型，可先做 spike 验证方向。
2. **讲座(lat)在 v1 收益最弱**（每条长稿只一个语气；逐段强调延后）。"生硬"投诉里讲座占比不小，但 v1 讲座主要靠**引擎换代 + persona** 改善，逐句语气红利集中在**对话(lc)**。预期要摆正。
3. **方案体量不小**（12 处文件改动 + 新门 + harness 改 + sidecar），但**分阶段良好**：Phase 0–1 低风险小原型，证明大脑后再决定是否投后续重活——**不必一次性承诺全部 6 阶段**。
4. **Phase 5 阻塞**于我先前排队的"文本 register 校准"任务，二者同源（真题 = ground truth），应合并考虑。

## 8. 文件改动清单

- **NEW** `lib/tts/toneDirector.js`
- **NEW** `scripts/backfill-tone.mjs`
- **EDIT** `scripts/backfill-tts.mjs`（provider 分支 + preset-key 断言 + 读 sidecar + 3 接缝传 instructions + 空值致命 + 算/存 tts_sig + TTS_RESYNTH + --dry-run + 逐项 checkpoint）
- **NEW** `data/listening/bank/{lc,lat,la,lcr}.tone.json`
- **EDIT** `lib/gate/gateHarness.js`（加 share_over 聚合器）
- **EDIT** `lib/gate/gate-registry.js`（REGISTRY.listening_tone + 渲染输出维度 + 禁 zero-target drift）
- **NEW** `lib/gate/measurers/listeningTone.js`、`lib/gate/measurers/toneOutput.js`
- **NEW** `data/eval-profiles/listening-tone-standard.json` + 两个 degraded fixture
- **EDIT** `scripts/generate-lc.mjs / generate-lat.mjs / generate-la.mjs / generate-lcr.mjs`（可选 annotateItem）
- **NEW** 单测（渲染不变量 + tts_sig 契约）
