# 口语发音/语调/连贯度评估 — 方案调研

日期：2026-07-15。触发问题：「真的要用 Whisper 来猜口音和连贯度吗？有没有别的方法？」
调研方式：三路并行（商业发音评测 API 横向对比 / 音频多模态 LLM 直听 + 学术证据 / 开源自托管），所有价格与论文结论均经 WebFetch 实查并标注来源。

## 约束

- Next.js 14 on Vercel serverless，**无 GPU**；音频 blob 已上传到服务端（/api/speech/transcribe）
- 成本敏感（现口语 STT 成本 Whisper $0.006/分钟；TTS 月增量 ¥33-53 是既有成本量级参照）
- 用户在中国大陆，但服务端跑 Vercel 美区可自由访问外网 API（同 Whisper/DeepSeek 先例）
- 已有 OPENAI_API_KEY、DASHSCOPE_API_KEY；评分反馈链路已有 DeepSeek 三路取中位 + 护栏（lib/speakingEval/）
- 题型：跟读（scripted，8-12 秒/句，有参考文本）+ 采访（unscripted，45 秒/题，无参考文本）
- 商用产品，避免 AGPL 传染；官方评分锚点已落库 data/speakingScoring/

## 候选评估

### 路线一：音频多模态 LLM 直听打分 — ❌ 学术证据一致否定

| 模型 | 每分钟音频成本 | 结论 |
|---|---|---|
| OpenAI gpt-audio | ≈$0.038/min（换算系数未公开，±50%） | 官方从未承诺发音评估能力 |
| Gemini 2.5 Flash | ≈$0.0019/min（32 token/秒官方系数） | 最便宜，但同样不可靠 |
| Qwen-Omni (DashScope) | ≈¥0.009/45秒题 | 现成 key，但 zero-shot 实证不理想；Qwen-Audio 音频上限 30 秒装不下采访题 |

**关键学术证据**（2025-2026 多篇独立验证，非孤证）：
- arXiv:2503.11229 — GPT-4o 在 speechocean762 上单词准确度 PCC 0.241（专用模型 0.693），流利度 0.418 vs 0.843；>40% 输出格式错乱。作者建议：专用工具出分 + LLM 只写反馈。
- arXiv:2601.16230 — Qwen2-Audio zero-shot 流利度 PCC 0.053、完整度 -0.021；对真实低分录音几乎从不打低分（中心化偏差）。
- arXiv:2606.15325 — GPT-4o/Gemini/Qwen 存在「刻板印象驱动诊断」：39.6% 打分理由是编造的、仅 15.8% 理由真正支持评分；隐藏说话人母语标签后判断显著改变。
- arXiv:2604.19300 — 静音/噪声段幻觉转录、肯定性偏见、跨任务表现 0%-99% 剧烈波动。

**判定：音频 LLM 不能出分数，只配生成反馈文字。**

### 路线二：开源自托管专用模型 — ❌ 现阶段运维不划算

| 项目 | stars | 最近提交 | 许可 | fit | 改造成本 |
|---|---|---|---|---|---|
| YuanGongND/gopt | 216 | 2023-02 停更 | BSD-3 ✅ | 高（PCC 0.61-0.74 实证） | 中高：需自建推理 server + Kaldi 对齐链 |
| Thiagohgl/ai-pronunciation-trainer | 505 | 2025-08 | **AGPL-3.0 ⚠️商用传染** | 中（无 benchmark 验证） | 中 + 许可风险 |
| Halleck45/OpenPronounce | 22 | 2025-12 活跃 | MIT ✅ | 低中（无 benchmark） | 低（有 FastAPI）但质量未知 |
| jimbozhang/kaldi-gop | 161 | 2021 停更 | 不明 | 中（技术过时） | 高 |

部署现实：CPU 推理 RTF 1-5×（45 秒音频要跑数十秒，不可用）；Modal T4 按次 ≈$0.001/次但冷启动 2-4 秒；常驻 GPU 月 $360+。对一两人无 GPU 运维经验团队 = 新增**持续性**运维面，且打分质量高的项目开源维护状态越差。

### 路线三：商业发音评测 API — ✅ 可行，两个优选

| 服务 | 发音/流利/韵律 | 语法/词汇/相关性 | Unscripted(采访) | 跟读1套(1.2min) | 采访1套(3min) | 接入 | 备注 |
|---|---|---|---|---|---|---|---|
| **Azure Speech PA** | ✅ 音素级+Prosody | 官方已退役（用自家 LLM 补） | ✅ 但 REST ≤30s，45s 需 SDK 流式 | ≈¥0.19 | ≈¥0.47 | 官方 Node SDK / REST | **性价比第一**；免费层 5 小时/月够试点 |
| **Language Confidence** | ✅ | ✅ 含 relevancy（专为开放问答设计） | ✅ 纯 REST | 套餐内边际≈0 | 套餐内边际≈0（$100/月含 8000+ 分钟） | REST + api-key 自助 | 一站式最贴合采访题；延迟 4-20s 注意 maxDuration |
| Speechace | ✅ | ✅（Pro 档起） | ✅ 需 Premium $125/月 | 订阅内 | ≈¥1.08 溢出价 | REST | IELTS/TOEFL 换算口径直接，但强制订阅贵 |
| ELSA API | ✅ | ✅ | ✅ | ¥0.40 | ¥2.16 | 需签 NDA | 流程慢，后备 |
| 腾讯云 SOE | ✅ | ❌ 只评发音 | ✅ free_speak | ¥0.035-0.007 | ≈¥0.10 | 纯 WebSocket，无 Node SDK | 人民币结算优势；自由说计费规则不透明 |
| 讯飞 ISE | ✅ | ❌ | **✗**（"自由说"实为 keypoint 复述，非开放问答；未公开定价） | ¥0.011-0.042 | 定制 | WebSocket | 采访题不适用，不选 |
| SpeechSuper | ✅ | ✅ | ✅ 仅 IELTS 口径，**TOEFL "coming soon"** | ¥0.30 | ¥1.01 | REST/WS | 观察名单 |

关键成本洞察：**Azure PA 自带转写**——接入后跟读/采访题可以省掉现在的 Whisper 调用（一次调用同时拿转写+发音分），实际边际成本 = Azure $1.30/hr − Whisper $0.36/hr ≈ **每套只多几分到一毛钱**。

## 结论：借鉴思路 + 部分复用（混合架构）

学术界与工业界（Duolingo 等）收敛的架构 = **专用工具出客观分 + LLM 出综合判断与反馈文字**，这与本项目现有三路取中位 + 护栏的思路同构。落到实处分三层：

1. **流利度（语速/停顿/语流长）→ Whisper 词级时间戳，照原 Phase 2 计划做**。澄清：这不是"用 Whisper 猜"——时间戳算 wpm/停顿是确定性测量，与专用模型用的 fluency 特征同源，零新增成本，且永远是外接 API 的独立交叉验证信号。
2. **发音/韵律（音素准确度/重音/语调）→ 接 Azure Pronunciation Assessment 试点**：跟读题是 scripted+8-12 秒，Azure REST 一次 POST 完美匹配（改造最小）；免费层 5 小时/月够整个试点期。试点验收 = 与现有 LCS 档位、真实录音人工听感对比。
3. **内容/语法/词汇/相关性 + 反馈文字 → 维持 DeepSeek 现有链路**（Azure 这块已退役，学术证据也支持 LLM 只做这层）。

采访题（45 秒 unscripted）的发音维度二选一，试点后定：Azure SDK 流式（便宜但多一层工程）vs Language Confidence REST（$100/月套餐制、自带 relevancy、零流式工程）。

**不选**：音频 LLM 出分（论文一致否定）、开源自托管（运维不划算）、讯飞（采访不适用）、SpeechSuper（TOEFL 未上线）。

## 下一步

1. Phase 2（时间戳流利度）按已备 spec 恢复实施——与任何外接 API 不冲突
2. Azure 试点 spike：注册免费层 → 跟读题 REST 接入（reference text + 音频一次 POST）→ 拿 20 段真实/自录录音对比 Azure 音素分 vs LCS 档位 → 出验收报告再决定全量
3. 采访题发音维度：试点结论出来后在 Azure 流式 vs Language Confidence 之间拍板
4. 待验证项（文档矛盾处，不要只信文档）：Azure REST 留空 ReferenceText 跑 unscripted 的真实行为；Vercel 美区→腾讯云大陆端点延迟（若走国内厂商）

## 来源索引

- 商业 API：learn.microsoft.com Azure PA 文档/定价页、xfyun.cn/doc/Ise、cloud.tencent.com SOE 1774/107373、speechsuper.com/pricing、speechace.com/api-plans、api-docs.speechace.com、elsaspeak.com/en/elsa-api、languageconfidence.ai/pricing
- 学术：arXiv 2503.11229 / 2601.16230 / 2509.02915 / 2606.15325 / 2604.19300；github.com/YuanGongND/gopt（PCC 基线已核实）
- 定价：developers.openai.com gpt-audio、ai.google.dev/gemini-api/docs/pricing（32 token/s 系数）、alibabacloud.com model-studio 定价、modal.com/pricing、replicate.com/pricing、huggingface.co Inference Endpoints
