# 单词本复习方法研究报告（TOEFL 备考场景）

> 目的：为本 App「阅读复盘划词收藏 → 单词本复习」这条链路选定调度算法、卡片形态与每日配额，并给出可直接实现的参数。
> 方法：以公开仓库源码 / 官方文档为一手依据，心理学结论标注论文出处。**所有数字按可信度分级标注**，见每节的「可信度」标记。
> 撰写日期：2026-09-13

---

## TL;DR（结论先行）

1. **调度算法选 FSRS-6**（21 参数，Anki 25.07 起的默认调度器）。理由：公开 benchmark 上它在 9,999 个用户、3.5 亿条复习记录上 Log Loss 0.3460，显著优于 FSRS-4.5（0.3625）、HLR/Duolingo（0.4694）和 Ebisu（0.4989）；而 SM-2 连「输出回忆概率」都做不到，无法参与校准评测。
2. **不要自己发明算法，直接用 `ts-fsrs`**（官方 TypeScript 实现）。FSRS-6 全部公式已在本报告第 3 节逐条核实并数值验证过（R(S,S)=0.9 精确成立）。
3. **默认目标留存率 `desired_retention = 0.90`**，而不是社区常说的 0.85。0.85 是「无限期长跑」下的最优点；本产品是 1-3 个月后有考试的**有截止日期**场景，本报告自建模拟显示 0.90 比 0.85 多花约 20% 复习量、换来考试日留存率 +1.3~2.1 个百分点，值得；而 0.95 再多花 47% 只换 +2~3 点，不值。
4. **真正决定记得牢的不是调度，是「提取练习」**。Karpicke & Roediger 2008：同样学完，继续被测试的词一周后回忆 80%，只是反复重看的只有 ~36%。调度算法优化的是那 20-30% 的效率，卡片形态优化的是那 44 个百分点。
5. **卡片必须用收藏时抓到的原句做完形填空（cloze）**，不要做孤立的「词 → 中文」。TOEFL 阅读/听力考的就是「在语境里认出词义」，训练形式要和考试形式对齐。
6. **单卡双向是错的**：英→中（识别）一张卡就够覆盖阅读听力；中→英（产出）只对写作/口语高频词加排，且只对用户标记的小子集。不要给每个词自动排两张卡——复习量翻倍，1-3 个月备考期撑不住。
7. **评分档位用二档（"忘了" / "记得"）**，不要四档。Anki 官方 FAQ 明确说：FSRS 对「主要用 Again 和 Good」的用户比对「四个键都大量用」的用户预测**更准**。四档的 Hard 键是自评噪声的主要来源。
8. **每日新词 15-20 个**。本报告模拟：20 新词/天、DR=0.90、60 天，日均 69 次复习，按每张 10-15 秒算 = 11-17 分钟/天，正好卡住用户 10-20 分钟的预算上限；25+ 会溢出。
9. **当天二次复习要做**（学完 10-20 分钟后再测一次），但**同一个词不要连着背 3 遍**——那是集中练习，会制造「已经会了」的错觉（Kornell 2009：90% 的人分散更有效，但 72% 的人以为集中更有效）。
10. **先跑默认参数，攒够真实日志再谈个性化优化**。FSRS-6 默认参数本身就是在千万级复习数据上拟合出来的，冷启动表现良好；Anki 24.06+ 已取消最低复习数门槛，但对个人优化而言，几百条以下的日志优化出来的参数不如默认值稳。

---


---

## 本项目的落地说明（工程侧补充，2026-09-13）

单词本按本报告的结论实现，代码在 `lib/vocab/`（`srs.js` 调度 / `book.js` 排队与卡型 /
`vocabStore.js` 存储与同步）、`components/vocab/`、`app/vocab-notebook/`。
有两处与报告正文的措辞不同，理由如下：

1. **没有引入 `ts-fsrs`，而是在 `lib/vocab/srs.js` 里实现了 FSRS-6 的公式。**
   报告建议用官方库、不要手抄参数，理由是「抄错一位小数不会报错，只会让用户默默记不住词」。
   这个风险是真的，所以采取的不是「相信自己抄对了」，而是把本报告第三节核实过的
   **具体输出值**钉成回归测试（`__tests__/vocab-srs.test.js` 的「FSRS-6 出厂参数」一组）：
   D₀ 四档、DR=0.9 时的四档首间隔、R(S,S)≡0.9、S=10 的曲线尾部。抄错任何一位都会红。
   这样既不引入运行时依赖（本项目 `public/dict` 已经是自建词库，全站零第三方学习库），
   又把报告担心的那类静默错误变成了会失败的断言。

2. **主卡型按第 4.4 / 6.3 节实现为「原句挖空」，而不是 TL;DR 第 6 条字面上的「英→中 一张卡就够」。**
   TL;DR 与正文这里表述不一致，采信正文：有原句就出挖空卡，挖不出来（收藏时没抓到句子、
   或句子里匹配不到该词）才退回纯词卡；写作/口语来源的词走产出方向（中→英）。
   一个词始终只有一张卡，不双向排卡。

其余均按报告执行：二档评分、不显示下次间隔、单个 15 分钟学习步、新词首间隔压到 1 天、
DR 默认 0.90 且考前 10 天自动进 0.95 冲刺档、每日新词 20 / 复习上限 120、队列打乱且同源不相邻、
进度指标用 ∑R（预计现在记得多少词）而不是复习张数、复习日志从第一天开始收
（`vocab_review_logs`，供日后用真实数据重拟合权重）。

---

## 二、调度算法横评

### 2.1 各算法原理速览

| 算法 | 年份 | 核心原理 | 状态变量 |
|---|---|---|---|
| **Leitner 盒子** | 1972 | 5 个盒子，答对升一格、答错直接退回第 1 格；每格固定间隔（如 1/2/4/7/14 天） | 盒子编号（整数） |
| **SM-2** | 1987 | 每题维护 E-Factor（初始 2.5，下限 1.3），间隔 I(1)=1、I(2)=6、I(n)=I(n-1)×EF；EF 按 0-5 分自评更新 | EF + 重复次数 |
| **Memrise 阶梯** | — | 全局固定阶梯：4h → 12h → 24h → 6d → 12d → 48d → 96d → 6 个月；答错退回第一档 | 阶梯位置 |
| **HLR（Duolingo）** | 2016 | 对「记忆半衰期」做回归：h = 2^(θ·x)，x 是历史特征（正确数、错误数、词本身），用 L2 回归拟合 | 半衰期 h |
| **SM-17** | 2016+ | SuperMemo 的 DSR 三分量模型（难度/稳定度/可提取性）+ 矩阵化经验拟合 | D, S, R |
| **FSRS** | 2022- | 同为 DSR 三分量，但用可微分公式 + 梯度下降在真实日志上端到端拟合权重 | D, S, R |

**SM-2 的具体公式**（可信度：高，来自 SuperMemo 官方存档）：

```
EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))     // q ∈ [0,5]，EF 下限 1.3
I(1) = 1;  I(2) = 6;  I(n) = round(I(n-1) * EF')  for n > 2
q < 3 时重置重复计数，从 I(1) 重新开始
```
来源：<https://super-memory.com/english/ol/sm2.htm>

**关键缺陷**：SM-2 输出的是「间隔」，它**不建模回忆概率**。所以它既不能回答「这个词我现在还记得的概率是多少」，也无法参与以 Log Loss / RMSE 为指标的校准评测——这不是它分低，而是它根本没有可评的输出。它的 EF 还有著名的 "Ease Hell" 问题：反复按 Hard 会把 EF 一路压到 1.3 下限，间隔永远长不起来，而 EF 没有任何回升机制。

### 2.2 实证效果对比（可信度：高，一手数据）

来自 open-spaced-repetition/srs-benchmark 的公开结果，**9,999 个 Anki 用户集合、349,923,850 条用于评测的复习记录**（不含当日重复复习）。数值为均值 ± 99% 置信区间：

| 算法 | 可训练参数 | Log Loss ↓ | RMSE(bins) ↓ | AUC ↑ |
|---|---:|---:|---:|---:|
| RWKV-Instant（神经网络，参考上界） | 2,762,884 | **0.2773** | 0.02502 | **0.8329** |
| GRU | 503 | 0.3328 | 0.0549 | 0.7324 |
| FSRS-7 recency（最新版） | 34 | 0.3370 | 0.0593 | 0.7220 |
| FSRS-rs（FSRS-6 + 近因加权） | 21 | 0.3443 | 0.0635 | 0.7074 |
| **FSRS-6** | **21** | **0.3460** | **0.0653** | **0.7034** |
| FSRS-5 | 19 | 0.3561 | 0.0742 | 0.7010 |
| FSRS-4.5 | 17 | 0.3625 | 0.0764 | 0.6891 |
| DASH | 9 | 0.3682 | 0.0838 | 0.6311 |
| FSRS v4 | 17 | 0.3726 | 0.0838 | 0.6853 |
| **AVG（常数基线）** | 0 | **0.3945** | 0.1034 | 0.4997 |
| ACT-R | 5 | 0.4033 | 0.1074 | 0.5225 |
| **HLR（Duolingo）** | 3 | **0.4694** | 0.1275 | 0.6369 |
| **Ebisu v2** | 0 | **0.4989** | 0.1627 | 0.6051 |

来源：<https://github.com/open-spaced-repetition/srs-benchmark>（2026-09 读取）

**三个必须读懂的点**：

- **HLR 比常数基线还差**（0.4694 vs AVG 0.3945）。Duolingo 那篇 ACL 2016 论文本身没问题（它报告相对自家基线降低 45%+ 误差、日活提升 12%），但它是在 Duolingo 自己的数据分布上调的，迁移到 Anki 式的长间隔闪卡场景就失效了。**不要抄 HLR。**
- **FSRS-6 → FSRS-5 → FSRS-4.5 是单调递减的真实提升**，不是版本号营销：Log Loss 0.3460 / 0.3561 / 0.3625。
- **神经网络确实更强**（RWKV 0.2773），但它要 276 万参数 + 跨用户预训练，对本产品完全不现实。FSRS-6 用 21 个参数拿到 0.3460，是性价比拐点。

**对比 SuperMemo**（可信度：高，一手数据，但样本小）：在 19 个 SuperMemo 用户、687,662 条记录上，FSRS-6 Log Loss 0.367 vs SM-17 的 0.432、SM-16 的 0.417；FSRS-6 对 SM-17 的 superiority 为 83.3%（即 83.3% 的用户集合上 FSRS-6 的 Log Loss 更低）。来源：<https://github.com/open-spaced-repetition/fsrs-vs-sm17>

**关于「FSRS 比 SM-2 少 20-30% 复习量」**（可信度：**低，未核实**）。这个数字在大量二手博客里流传，但我在 Anki 官方手册和 fsrs4anki 官方教程里**没有找到**这个具体百分比。官方教程的原话只是："Even with the default parameters, FSRS is better than the default Anki algorithm (SM-2)"，以及 FSRS 对新卡给出的首间隔比 SM-2 更长、对熟卡则更保守。**工程侧不要把 20-30% 写进产品文案。** 来源：<https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md>

同理，网上流传的「FSRS-6 对 SM-2 有 99.6% superiority」我只在二手博客见到，srs-benchmark 的 superiority 全表是 PNG 图片，无法机读核实，**标为未核实**。

### 2.3 工程复杂度与冷启动

| 算法 | 实现复杂度 | 冷启动（零日志） | 是否需要训练管线 |
|---|---|---|---|
| Leitner | 极低（一个整数） | 完美（无参数） | 否 |
| Memrise 阶梯 | 极低 | 完美 | 否 |
| SM-2 | 低（几十行） | 良好（EF=2.5 起手） | 否 |
| **FSRS-6** | **中（但有成熟库）** | **良好（默认参数已在千万级数据上拟合）** | **可选，非必需** |
| SM-17 | 高，且**非开源** | — | 是 |
| HLR | 中 | 差（必须先有日志才能回归） | 是 |

FSRS 的复杂度问题**已经被库解决了**：`ts-fsrs`（TypeScript，与本项目 Next.js 技术栈直接匹配）、`py-fsrs`、`fsrs-rs` 都是 open-spaced-repetition 官方维护的 MIT 实现。接入成本 ≈ 存 4 个字段（stability、difficulty、due、last_review）+ 调一次 `scheduler.review_card()`。

**冷启动是 FSRS 被低估的优势**：它的默认权重不是随手填的先验，而是在整个 benchmark 数据集上拟合出的群体最优。所以「零日志新用户」拿到的就是「平均 Anki 用户的最优参数」，这比 SM-2 的 EF=2.5（一个 1987 年拍脑袋的常数）强得多。Anki 24.06+ 已取消个人优化的最低复习数门槛；在此之前的版本要求 400~1000 条复习记录才允许优化——这个数量级可以作为我们「何时开启个性化」的参考线。

### 2.4 推荐：FSRS-6

**选它的四个理由**：

1. **预测精度有大样本实证**，且是本场景（间隔数天到数月的闪卡复习）最直接对口的数据分布。
2. **目标留存率是一个可直接暴露给用户的旋钮**。FSRS 把「你想记住多少」和「间隔多长」解耦了：`desired_retention` 调一下，全部间隔跟着变，**不需要重新优化参数**（官方教程明确说明二者独立）。这对备考产品极有价值——"考前两周模式" 可以直接把 DR 从 0.90 拉到 0.95。
3. **难度均值回归天然解决 Ease Hell**，不会出现「某个词被按了几次 Hard 后永远卡在 1 天间隔」的死循环。
4. **现成 TS 库，零算法自研风险。**

**为什么不选 FSRS-7**：它 2026 年才出现（34 参数、8 参数可训练遗忘曲线、面向小数间隔），benchmark 上确实更好（0.3370 vs 0.3460），但生态库成熟度和文档远不如 FSRS-6，且其收益（Log Loss 降 0.009）对一个单词本来说完全感知不到。**建议 FSRS-6，把版本升级列为后续可选项。**

**为什么不选 Leitner/Memrise**：它们唯一的优点是简单，而这个优点已经被 ts-fsrs 抹平了。固定阶梯的根本问题是「同一格里的两个词被一视同仁」——用户在阅读里查到的 `ubiquitous` 和 `photosynthesis`，难度天差地别，却拿同一个间隔。

---

## 三、FSRS 公式与默认参数（附可信度标注）

> **本节可信度声明**：FSRS-6 的全部公式与 21 个默认参数，我是**逐行读 py-fsrs 源码 `fsrs/scheduler.py` 与 fsrs-rs `src/inference_v6.rs` 核实的**，并用 Python 重算验证了 `R(S,S) = 0.9` 精确成立。**标记为【已核实-源码】的内容可以直接照抄。**
> FSRS-4.5 / FSRS-5 的参数向量我核实到两个独立来源（官方 wiki + ts-fsrs 文档引用）一致，但**没有直读源码**，标记为【已核实-文档】。

### 3.1 DSR 模型

三个状态变量：

- **S（Stability，稳定度）**：记忆从 R=100% 衰减到 R=90% 所需的天数。单位是天。
- **D（Difficulty，难度）**：该词对该用户的内禀难度，取值范围 **[1, 10]**（`MIN_DIFFICULTY = 1.0`, `MAX_DIFFICULTY = 10.0`）【已核实-源码】。
- **R（Retrievability，可提取性）**：此刻能想起来的概率。

### 3.2 遗忘曲线

```
R(t, S) = (1 + FACTOR · t / S) ^ DECAY
```

| 版本 | DECAY | FACTOR | 可信度 |
|---|---|---|---|
| FSRS-4.5 / FSRS-5 | **−0.5**（常数） | **19/81 ≈ 0.234568** | 【已核实-源码】`FSRS5_DEFAULT_DECAY = 0.5` |
| FSRS-6 | **−w[20]**，默认 w[20] = **0.1542** → DECAY = **−0.1542** | `FACTOR = 0.9^(1/DECAY) − 1` ≈ **0.980346** | 【已核实-源码】`FSRS6_DEFAULT_DECAY = 0.1542` |

**明确回答问题中的疑问**：

- FSRS-4.5/5 的 FACTOR 就是 **19/81**（我数值验算过：`0.9^(1/-0.5) - 1 = 1/0.81 - 1 = 19/81`，精确相等）。
- **FSRS-6 起 decay 变成了可学习参数** w[20]，不再是常数 −0.5。FSRS-5 **还没有**这个改动（FSRS-5 是 19 参数，decay 仍固定 −0.5；它相对 4.5 的改动是引入了当日复习 w[17]、w[18]）。这正是 benchmark README 的说法："FSRS-6 has an optimizable parameter that controls the flatness of the forgetting curve"。
- FACTOR 的定义保证了 **R(S, S) = 0.9 恒成立**——即「稳定度 S 天后，回忆概率恰好 90%」，这是 S 的定义本身。两个版本我都数值验证了，精确等于 0.9。

**decay 变化带来的实际差异**（S = 10 天，本报告实算）：

| 间隔 t | FSRS-6 的 R | FSRS-4.5 的 R |
|---|---|---|
| 10 天 | 0.900 | 0.900 |
| 40 天 | 0.782 | 0.718 |
| 100 天 | 0.693 | 0.547 |
| 365 天 | 0.574 | 0.323 |

FSRS-6 的曲线**尾部厚得多**——长间隔下它认为你比 FSRS-4.5 估计的记得牢。这对 1-3 个月备考场景影响有限（我们的间隔很少超过 60 天），但会让「考前回看两个月前的词」这类场景的排期更宽松。

### 3.3 初始状态（首次学习）

**初始稳定度**【已核实-源码】：
```
S₀(G) = w[G − 1]        // G = 1(Again), 2(Hard), 3(Good), 4(Easy)
```
FSRS-6 默认值：S₀(Again) = **0.212** 天，S₀(Hard) = **1.2931**，S₀(Good) = **2.3065**，S₀(Easy) = **8.2956**。

**初始难度**——**注意这里 FSRS-5/6 和 FSRS-4.5 不是同一个公式**：

```
FSRS-4.5:    D₀(G) = w[4] − (G − 3) · w[5]                【已核实-文档】
FSRS-5/6:    D₀(G) = w[4] − e^(w[5] · (G − 1)) + 1         【已核实-源码】
```

FSRS-6 默认参数下实算（`clamp` 到 [1,10] 之前/之后）：

| 评分 G | D₀ 原始值 | clamp 后 |
|---|---:|---:|
| 1 Again | 6.4133 | 6.4133 |
| 2 Hard | 5.1122 | 5.1122 |
| 3 Good | 2.1181 | 2.1181 |
| 4 Easy | −4.7716 | **1.0** |

（Easy 的原始值为负是正常的，源码在均值回归里故意使用**未 clamp** 的 D₀(4)。）

### 3.4 难度更新（含线性阻尼与均值回归）【已核实-源码】

```
Δ D      = − w[6] · (G − 3)
阻尼后    = D + (10 − D) · ΔD / 9              // linear damping：D 越大，同样评分推动越小
均值回归  = w[7] · D₀(4)_unclamped + (1 − w[7]) · 阻尼后
D'       = clamp(均值回归, 1, 10)
```

FSRS-6 默认 w[7] = **0.001**，即均值回归非常弱（每次只把 D 往 D₀(4)≈−4.77 方向拉千分之一）。线性阻尼项 `(10 − D)/9` 是 FSRS-5 引入、FSRS-6 保留的，它保证 D 接近 10 时几乎推不动，这才是防止 Ease Hell 的主力机制。

### 3.5 稳定度更新【已核实-源码】

**记得（G ∈ {Hard, Good, Easy}）**：
```
S' = S · ( 1 + e^(w[8]) · (11 − D) · S^(−w[9]) · (e^((1 − R) · w[10]) − 1) · hard_penalty · easy_bonus )

其中  hard_penalty = w[15]  当 G = Hard，否则 1
      easy_bonus   = w[16]  当 G = Easy，否则 1
```
三个直觉：难度 D 越大增益越小（`11 − D`）；**当前 S 越大增益越小**（`S^(−w[9])`，递减回报）；**复习时 R 越低增益越大**（`e^((1−R)·w[10]) − 1`）——**这就是「期望难度」在公式里的样子**，见第 4 节。

**忘了（G = Again）**：
```
S'_forget = min(
    w[11] · D^(−w[12]) · ((S + 1)^w[13] − 1) · e^((1 − R) · w[14]),
    S / e^(w[17] · w[18])
)
```
FSRS-6 新增的 `min(...)` 第二项是保护：遗忘后的稳定度不会比「当日复习」路径算出来的还高。

**当日二次复习（same-day）**：
```
FSRS-5:  S' = S · e^( w[17] · (G − 3 + w[18]) )
FSRS-6:  S' = S · e^( w[17] · (G − 3 + w[18]) ) · S^(−w[19])      【已核实-源码】
         且当 G ∈ {Hard, Good, Easy} 时，增益因子 clamp 到 ≥ 1.0
```
FSRS-6 多出的 `S^(−w[19])` 让当日重复的收益随 S 增大而收敛——**这在算法层面就否定了「同一个词连刷 5 遍」**。

### 3.6 由目标留存率反解间隔【已核实-源码】

```
I = (S / FACTOR) · ( DR^(1 / DECAY) − 1 )
I = clamp(round(I), 1, maximum_interval)        // py-fsrs 默认 maximum_interval = 36500
```

FSRS-6 默认参数下，**首次复习间隔**实算（天）：

| desired_retention | Again | Hard | Good | Easy |
|---|---:|---:|---:|---:|
| 0.95 | 0.1 | 0.5 | 0.9 | 3.3 |
| **0.90** | **0.2** | **1.3** | **2.3** | **8.3** |
| 0.85 | 0.4 | 2.5 | 4.4 | 15.8 |
| 0.80 | 0.7 | 4.3 | 7.6 | 27.5 |

（不足 1 天的会被 clamp 到 1 天，或由 learning steps 接管。）

### 3.7 默认权重向量

**FSRS-6（21 个）**——【已核实-源码，py-fsrs `DEFAULT_PARAMETERS` 与 fsrs-rs `FSRS6_DEFAULT_PARAMETERS` 完全一致，可直接照抄】：

```
[0.212,  1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
 1.8722, 0.1666, 0.796,  1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]
```

**FSRS-5（19 个）**——【已核实-文档，两个独立来源一致，未直读源码】：
```
[0.40255, 1.18385, 3.173,  15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
 1.54575, 0.1192,  1.01925, 1.9395,  0.11,   0.29605, 2.2698, 0.2315,
 2.9898,  0.51655, 0.6621]
```

**FSRS-4.5（17 个）**——【已核实-文档，两个独立来源一致，未直读源码】：
```
[0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
 1.6474, 0.1367, 1.0461, 2.1072,  0.0793, 0.3246, 1.587,  0.2272,
 2.8755]
```

**FSRS-7（34 个）**——【已核实-源码，srs-benchmark README 原文】，列出供参考，**不建议本期采用**：
```
0.041, 2.4175, 4.1283, 11.9709, 5.6385, 0.4468, 3.262, 2.3054, 0.1688,
1.3325, 0.3524, 0.0049, 0.7503, 0.0896, 0.6625, 1.15, 0.882, 0.3072,
3.5875, 0.303, 0.0107, 0.2279, 2.6413, 0.5594, 1.15, 2.5, 1.0, 0.0723,
0.1634, 0.5, 0.9555, 0.2245, 0.6232, 0.1362, 0.3862
```

> ⚠️ **给工程侧的警告**：不要手抄这些向量。直接 `npm i ts-fsrs` 用库里的 `default_w`，抄错一个小数点的代价是所有间隔静默错掉，而且**不会报错、不会崩溃**，只会让用户记不住词——这是最难被发现的一类 bug。本报告列出数字是为了让你能**校验**库里的值，不是为了让你复制。

---

## 四、除调度之外，什么真正决定记得牢

> 这一节才是报告的重点。调度算法把复习**排在**对的时间，但每次复习**发生了什么**，对最终留存的影响比排期大一个数量级。

### 4.1 主动回忆 vs 被动重读：效应量约 g = 0.50，极端情况差 44 个百分点

**Rowland (2014)** 的元分析涵盖 **159 个效应量**，提取练习 vs 重读的总体效应 **g = 0.50，95% CI [0.42, 0.58]**；且效应在「材料更复杂」「提取更费力」「给了反馈」时更大。
来源：Rowland, C. A. (2014). *The effect of testing versus restudy on retention: A meta-analytic review of the testing effect.* Psychological Bulletin. <https://pubmed.ncbi.nlm.nih.gov/25150680/>

**Karpicke & Roediger (2008)** 是最直接对口单词本的实验：受试学 **40 组斯瓦希里语-英语词对**，学会之后分四种处理。一周后最终测试：**继续被测试的条件回忆约 80%，学会后就不再测试（只重学）的条件只有 36% 和 33%**。论文结论：「学会之后继续重学，对延迟回忆没有效果；继续重测，有巨大的正效应。」
来源：Karpicke, J. D., & Roediger, H. L. (2008). *The Critical Importance of Retrieval for Learning.* Science, 319, 966-968. <http://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Karpicke-Roediger-2008_Sci.pdf>

**对本产品的含义**：单词本的默认交互**必须是「先答后看」**。任何一个「翻着看一遍列表」的入口，都是在把 80% 变成 36%。「浏览模式」可以有，但绝不能是默认，也绝不能计入打卡/进度。

### 4.2 期望难度：提取越费力，记得越牢

Bjork 的**新失用理论（New Theory of Disuse）**把记忆拆成两个独立量：**storage strength（储存强度）** 和 **retrieval strength（提取强度）**。关键的反直觉结论是：**成功提取的那一刻，提取强度越低，储存强度的增益越大**。提取太容易，几乎什么也没发生。
来源：Bjork, R. A. (1994). *Memory and metamemory considerations in the training of human beings.* 以及 Bjork & Bjork 的 "Introducing Desirable Difficulties into Practice and Instruction"。<https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-introducing-desirable-difficulties-into-practice-and-instruction-bjork-and-bjork.pdf>

**这条原理已经内置在 FSRS 里了**：稳定度增益公式里的 `(e^((1−R)·w[10]) − 1)` 项，R 越低（越接近忘掉）增益越大。所以**降低目标留存率 = 主动制造期望难度**。这也解释了为什么 0.85 在无限期场景下比 0.95 更「高效」——不是因为忘掉本身有价值，而是因为每次险些忘掉的成功提取，单次收益更大。

**但「期望」二字有边界**：难度必须是学习者**能克服的**。留存率压到 0.70 以下时，大量复习变成「答错 → 重学」，收益被重学成本吃光——这正是官方文档说「不要设到推荐值以下，否则你会做**更多**的功、记住**更少**的东西」的原因。

### 4.3 语境化记忆：原句是本产品最大的差异化资产

我们在收藏时抓到了 **`sentence`（原文整句）**，这是绝大多数单词本 App 没有的字段。文献支持在语境中复习，但有一个**关键限定条件**：

**den Broek et al. (2018)**：「语境提升理解，但提取提升留存」（Context Enhances Comprehension but Retrieval Enhances Retention）。<https://onlinelibrary.wiley.com/doi/10.1111/lang.12285>

**den Broek et al. (2022)** 更精确：单句练习**在这个句子创造了提取机会时**比**让学习者从上下文推测词义时**更有效。带提取的语境句提升了词形、词义的后续回忆，**以及在新语境中理解该词的能力**（即迁移）。
来源：*Vocabulary Learning During Reading: Benefits of Contextual Inferences Versus Retrieval Opportunities.* Cognitive Science. <https://pmc.ncbi.nlm.nih.gov/articles/PMC9285746/>

**对本产品的含义，这是本报告最重要的设计结论之一**：
- ✅ **对的做法**：把原句里的目标词挖空 → 用户填/回忆 → 显示答案。语境 + 提取，两个机制叠加。
- ❌ **错的做法**：把原句整句显示出来当"例句参考"，让用户看着句子推词义。这是「语境推测」，留存率反而不如干净的提取。
- **迁移价值**：带提取的语境练习提升「在新语境中理解该词」的能力——这恰好就是 TOEFL 阅读的考法（词汇题问的永远是"该词在本文中最接近以下哪个意思"）。

**注意一个反向证据**：也有研究发现「给的信息越少、语境越有限，词形识别的留存反而越好」。所以**句子要短、要聚焦**。如果收藏到的原句超过 ~30 词，应该截断到目标词周围的从句，而不是整段甩给用户。

### 4.4 卡片方向：英→中 vs 中→英 vs 完形填空

**证据**：
- **Webb (2005, 2009)**：学习方向显著影响所获知识的**类型**。**产出式学习**（中→英）在词形的接受性与产出性知识、以及词义/句法/语法功能的产出性知识上收益更大；**接受性学习**（英→中）在**词义的接受性知识**上收益更大。Webb 的结论是：**如果只能选一种，产出式学习可能更有效**（因为它的收益覆盖面更广）。
  来源：Webb, S. (2005). *Receptive and productive vocabulary learning: The effects of reading and writing on word knowledge.* SSLA, 27, 33-52. <https://eric.ed.gov/?id=EJ777295>；Webb, S. (2009). *The Effects of Receptive and Productive Learning of Word Pairs on Vocabulary Knowledge.* RELC Journal. <https://journals.sagepub.com/doi/10.1177/0033688209343854>
- 但是：**产出式方向更难、更慢**。研究一致发现受试在接受性任务（L2→L1）上的表现好于产出性任务（L1→L2）。

**迁移适切加工（transfer-appropriate processing）原则**——训练形式应匹配测试形式：

| TOEFL 科目 | 实际认知任务 | 对应卡片方向 |
|---|---|---|
| **阅读** | 看到英文词，在语境中取回词义 | **英→中 / 语境完形填空**（接受性） |
| **听力** | 听到英文词，取回词义 | 接受性（+ 音频） |
| **写作** | 想表达某个意思，取回英文词并正确用出来 | **中→英**（产出性） |
| **口语** | 同上，且要快 | 产出性 |

**结论与取舍**：
1. **主卡：语境完形填空（原句挖空）**。这是本产品的默认卡型。它同时具备语境、提取、与阅读/听力考法对齐三个优点。
2. **不要给每个词自动排两张卡。** 这是很多单词本 App 的默认行为，代价是复习量直接翻倍。在 1-3 个月、每天 10-20 分钟的预算下，翻倍意味着新词量必须砍半——用 Webb 报告的那点边际知识广度，换掉一半的词汇覆盖，对 TOEFL 是**亏的**（阅读需要 8,000-9,000 词族达到 98% 覆盖，词汇量的广度约束远比单词深度约束紧）。
   来源：Nation, I.S.P. (2006). *How Large a Vocabulary Is Needed For Reading and Listening?* <https://www.lextutor.ca/cover/papers/nation_2006.pdf>
3. **产出卡按需开启**：只对用户显式标记为「要用在写作/口语里」的词（或来自写作/口语科目的收藏，我们有 `source` 字段）额外排一张中→英卡。默认关闭。

### 4.5 交错 vs 分块：这里有一个必须纠正的常见误解

**Brunmair & Richter (2019)** 的元分析（59 项研究、158 个样本、238 个效应量）：交错的**总体**效应 **g = 0.42**，看起来很支持交错。**但分材料类型看，词表材料（word-only lists）的交错效应是 g = −0.39——即分块反而更好。**
来源：Brunmair, M., & Richter, T. (2019). *Similarity matters: A meta-analysis of interleaved learning and its moderators.* Psychological Bulletin. <https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf>

作者给出的边界条件：**交错的收益来自「帮助区分高度相似的类别」**。当类别本身已经容易区分时，分块更优。绘画风格分类 g = 0.67（类别难辨，交错有用），词表 g = −0.39（每个词就是自己，没有需要辨析的类别）。

**对本产品的含义（重要）**：
- ❌ **不要把「交错练习」当作卖点写进单词本**。「随机打乱不同主题的单词」这件事，元分析证据**不支持**它能提升词汇留存。
- ✅ 但仍然应该**打乱复习队列顺序**，理由不是交错效应，而是：(a) 防止用户靠「相邻位置」而非词本身来回忆（顺序线索作弊）；(b) 防止同源词连续出现互相提示。这是**消除干扰**，不是「交错」。
- ✅ 真正有价值的交错发生在**科目层面**：阅读词、听力词、写作词混排，因为它们对应不同的提取情境。但这个收益是情境多样性，不是类别辨析。

### 4.6 分散、睡眠与当日二次复习

**分散 > 集中，这是全领域最稳的结论之一**：
- **Cepeda et al. (2006)** 元分析：184 篇文章、317 个实验、839 个效应量评估。核心结论是 **ISI（学习间隔）与保持间隔联合决定留存，且最优 ISI 随保持间隔增长而增长**。
  来源：Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). *Distributed practice in verbal recall tasks: A review and quantitative synthesis.* Psychological Bulletin, 132, 354-380. <https://augmentingcognition.com/assets/Cepeda2006.pdf>
- **Cepeda et al. (2008)** 给出可用的经验比例：**最优间隔约为测试延迟的 20%（延迟为几周时），延迟为一年时降到约 5%**。
  来源：Cepeda et al. (2008), Psychological Science. <https://laplab.ucsd.edu/articles/Cepeda%20et%20al%202008_psychsci.pdf>
  → **对我们的直接推论**：备考 60 天的用户，一个词的理想复习间隔量级是 **~12 天**。这与 FSRS 在 DR=0.90 下的实际排期（第 3-4 次复习落在 10-50 天）吻合，说明默认参数没有跑偏。
- **Kornell (2009)**：用 **GRE 词汇**做的闪卡实验，**90% 的受试分散学习效果更好，但第一轮学完后 72% 的人认为集中更有效**。这个「效果与主观感受背离」是产品设计上必须防的坑。
  来源：Kornell, N. (2009). *Optimising learning using flashcards: Spacing is more effective than cramming.* Applied Cognitive Psychology, 23, 1297-1317. <https://sites.williams.edu/nk2/files/2011/08/Kornell.2009b.pdf>

**睡眠巩固**：
- **Gais et al. (2006)**：学完后立刻睡觉（相对于等量清醒时间），12-24 小时后的词汇回忆有稳定化效应。
- **Mazza et al. (2016)**：**在两次学习之间插入睡眠，不仅把所需练习量减半，还带来显著更好的长期留存**（1 周与 6 个月后仍存在）。原文结论：「学完就睡是好策略，但在两次学习之间睡觉是更好的策略。」
  来源：Mazza, S., et al. (2016). *Relearn Faster and Retain Longer: Along With Practice, Sleep Makes Perfect.* Psychological Science. <https://www.hendrix.edu/uploadedFiles/Academics/Faculty_Resources/2016_FFC/Learn%20then%20sleep.pdf>
  → **产品含义**：「今天学的新词，明天一定要再见一次」这条规则有直接实证支持，比任何调度公式都硬。FSRS 在 DR=0.90 下给 Good 的首间隔是 2.3 天，**建议对新词的第一个间隔强制 clamp 到 1 天**（让它跨过一次睡眠），这是有据可依的偏离默认值。

**当日二次复习（same-day）**：FSRS-5 起把当日复习纳入建模，FSRS-6 改进了公式（见 3.5）。Anki 官方对 learning steps 的指导是【已核实-文档】：
- 所有 learning step 必须**当天能做完**，单个 step 取 `10m / 15m / 20m / 30m` 都合理；
- **不推荐多个短 step**（如 "5m 10m 15m 30m"）；
- 超过 12-14 小时的 step 不推荐。
来源：<https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md>

**扩展间隔 vs 等间隔**：**Karpicke & Roediger (2007)** 发现扩展式间隔在**即时**测试上更好，但在**延迟**（2 天后）测试上**反转**，等间隔更优。作者认为关键在于**第一次提取的位置必须足够费力**（有延迟，而非紧接着呈现）。
来源：Karpicke, J. D., & Roediger, H. L. (2007). *Expanding retrieval practice promotes short-term retention, but equally spaced retrieval enhances long-term retention.* JEP:LMC. <https://learninglab.psych.purdue.edu/downloads/2007/2007_Karpicke_Roediger_JEPLMC.pdf>
→ **含义**：不要为了让用户「感觉良好」而把第一次复习安排在学完 1 分钟后。第一次提取要隔开（10-20 分钟以上），这条和 4.2 的期望难度是同一件事。

### 4.7 目标留存率设多少：0.85 是长跑答案，0.90 是备考答案

**文献侧（可信度：高）**：
- 允许范围 **0.70-0.97**（Anki 23.10.1+ 扩到 0.70-0.99）；官方推荐 **80-95% 合理，90% 对多数人没问题**。
- FSRS 官方 wiki 的结论是：**最优留存率约 85%**。它最小化的目标在 Anki 24.04 后改成了 **workload / knowledge**（学习分钟数 ÷ 所有卡片回忆概率之和），而不是「在固定时间里记最多」。
- 曲线是 U 形的：留存率降到 **约 70% 以下**时，重学成本反超，工作量重新上升。
- 官方明确警告：**设到推荐值以下会让你做更多功、记更少东西**；设到 0.97 以上会让工作量暴涨，且「每次复习的边际贡献极小，实质上把间隔重复退化成了集中重复」。
来源：<https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention> 与 tutorial.md

**但 85% 这个答案有一个隐含前提：无限期、无截止日。** 它优化的是「长期单位工作量的知识产出」。我们的用户 60 天后要考试，他要优化的是**考试当天的留存总量**，超出考试日的长期效率对他毫无价值。

**本报告自建模拟**（⚠️ **可信度：中，这是我自己写的模拟，不是文献结论**。模型：FSRS-6 默认参数，假设用户评分完全校准（实际回忆概率 = FSRS 预测的 R），只用 Again/Good 二档，每天固定新词量）：

**场景 A：固定 20 新词/天，跑到考试日**

| 备考天数 | DR | 总词数 | 总复习次数 | 考试日期望记住 | 考试日留存率 | 次/词 |
|---:|---:|---:|---:|---:|---:|---:|
| 30 | 0.85 | 600 | 1,335 | 549 | 91.4% | 2.23 |
| 30 | **0.90** | 600 | **1,733** | **572** | **95.3%** | 2.89 |
| 30 | 0.95 | 600 | 2,340 | 581 | 96.9% | 3.90 |
| 60 | 0.85 | 1,200 | 3,434 | 1,114 | 92.8% | 2.86 |
| 60 | **0.90** | 1,200 | **4,111** | **1,129** | **94.1%** | 3.43 |
| 60 | 0.95 | 1,200 | 6,058 | 1,169 | 97.4% | 5.05 |
| 90 | 0.85 | 1,800 | 5,940 | 1,677 | 93.2% | 3.30 |
| 90 | **0.90** | 1,800 | **7,217** | **1,715** | **95.3%** | 4.01 |
| 90 | 0.95 | 1,800 | 10,329 | 1,754 | 97.4% | 5.74 |

**读法**：0.85 → 0.90，复习量 +20~22%，考试日留存 **+1.3~3.9 个百分点**；0.90 → 0.95，复习量再 **+43~47%**，只换 **+1.6~3.3 个百分点**。**边际收益在 0.90 之后急剧递减，在 0.90 之前相对划算。**

→ **推荐默认 DR = 0.90**，并提供「考前冲刺模式」把 DR 临时拉到 0.95（考前 7-10 天开启，用更多复习量换考试日的确定性）。注意 FSRS 的一个好性质：**改 DR 不需要重新优化参数**，二者独立【已核实-文档】。

### 4.8 每日新词量与复习量上限

**本报告自建模拟**（⚠️ 同上，可信度：中）。DR = 0.90，60 天备考：

| 新词/天 | 总词数 | 总复习 | 日均复习 | 峰值/天 | @10 秒/张 | @15 秒/张 | 考试日留存 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 600 | 2,039 | 34 | 47 | 5.7 分 | 8.5 分 | 94.1% |
| **15** | **900** | **3,075** | **51** | **74** | **8.5 分** | **12.8 分** | 94.2% |
| **20** | **1,200** | **4,111** | **69** | **99** | **11.4 分** | **17.1 分** | 94.1% |
| 25 | 1,500 | 5,099 | 85 | 121 | 14.2 分 | 21.2 分 | 94.2% |
| 30 | 1,800 | 6,161 | 103 | 150 | 17.1 分 | 25.7 分 | 94.2% |

**结论**：用户给的预算是 10-20 分钟/天。语境完形填空卡比纯词卡慢，按 10-15 秒/张估：
- **默认 20 新词/天**（11-17 分钟），正好用满预算；
- **保守档 15/天**（8.5-13 分钟），适合还要做阅读听力练习的用户；
- **25 以上会溢出预算**，不应作为默认。

注意**留存率几乎不随新词量变化**（都在 94% 左右）——因为 DR 控制的是留存率，新词量控制的是**总量**。所以新词量的唯一约束是**时间预算**，不是效果。

另外注意**峰值/天**列：20 新词/天时峰值 99 次，是日均的 1.44 倍。**必须有每日复习上限（review cap）**，否则用户会在某些天被 100+ 张卡劝退。建议 cap 设在日均的 1.5 倍左右并把超出部分顺延。

### 4.9 评分档位：二档 vs 四档

**这一条有官方直接证据，可信度：高。**

Anki FSRS 官方教程 FAQ（A8）原文：**"According to our research, FSRS is a little more accurate for people who mostly use 'Again' and 'Good' than for people who use all 4 buttons a lot."**（据我们的研究，FSRS 对主要使用 Again 和 Good 的用户，比对大量使用全部四个键的用户**更准确**。）

更关键的是官方反复强调的**唯一致命错误**：
> "FSRS can adapt to almost any habit, except for one habit: pressing 'Hard' instead of 'Again' when you forget the information... If you press 'Hard' when you have failed to recall the information, the intervals will be unreasonably high (for all the ratings)."

以及：**"Internally, FSRS treats Again as 'fail' and Hard/Good/Easy as 'pass'."** ——**在模型内部，四档本来就先被折叠成了二档**；Hard/Easy 只是在 pass 分支里乘一个 `hard_penalty = w[15]` / `easy_bonus = w[16]` 的修正系数。

来源：<https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md>

**分析**：四档的信息增益（两个乘性系数）**小于**它引入的自评噪声。Hard 是一个语义歧义的按钮——它同时可以表示「我想起来了但很吃力」（正确用法）和「我没想起来」（错误用法）和「我不想这么快再见到它」（更错的用法）。官方还专门警告：评分应只基于「回忆有多容易」，**不能基于「你希望隔多久再见到它」**，并指出很多用户因为看到 Easy 的间隔太长而回避 Easy，形成负向循环。

**对本产品的决定性论据**：Anki 用户是自选的、受过训练的高动机人群，尚且普遍误用 Hard；我们的用户是**从阅读复盘顺手点收藏**进来的普通考生，不会读任何按钮说明。**给他们四个键，就是在给 FSRS 喂噪声。**

→ **用二档：「忘了」(Again = 1) / 「记得」(Good = 3)。** 内部仍然可以映射到 FSRS 的 4 档 Rating 枚举，只是永不发出 Hard 和 Easy。这也让按钮更大、点击更快，直接降低每张卡的秒数（见 4.8 的时间预算）。

**可选的折中**（若后续想要更细粒度）：用**反应时间**代替自评做隐式分档——答对且用时 < 3 秒判为 Easy，答对但 > 8 秒判为 Hard。这比让用户自评更客观。但这属于后续优化，**首版用二档**。

---

## 五、反面清单：这些常见做法没用或有害

| # | 做法 | 为什么错 | 证据 |
|---|---|---|---|
| 1 | **只看不测**（翻列表、看"今日单词"卡片流） | 学会之后只重学，一周后回忆 36%；继续测试是 80% | Karpicke & Roediger 2008 |
| 2 | **同一个词连刷 3-5 遍直到"背下来"** | 集中重复制造流畅性错觉；FSRS-6 的当日复习公式 `S^(−w[19])` 本身就让连刷收益快速收敛到 0 | Kornell 2009（90% 分散更好，72% 的人以为集中更好）；FSRS-6 源码 |
| 3 | **考前一次性突击刷完整个单词本** | 违反分散原则；最优间隔应约为保持间隔的 20%，突击等于 ISI≈0 | Cepeda 2006 / 2008 |
| 4 | **把所有收藏词都当新词，每次从头过一遍** | 已经稳定的词占满了时间预算，挤掉真正需要复习的词；FSRS 的全部价值就在于区分这两类 | 本质上等于放弃调度 |
| 5 | **把目标留存率设到 0.95 以上** | 工作量暴涨，边际贡献极小，"实质上把间隔重复退化成集中重复" | Anki 官方 tutorial 原文警告 |
| 6 | **把目标留存率压到 0.70 以下求省时间** | U 形曲线另一侧：重学成本反超，做更多功记更少东西 | Anki 官方 optimal-retention wiki |
| 7 | **遗忘时点"Hard"而不是"Again"** | 官方点名的**唯一**会破坏 FSRS 的习惯，会让**所有**评分的间隔都不合理地变长 | Anki 官方 tutorial |
| 8 | **给每个词自动排「英→中」+「中→英」两张卡** | 复习量翻倍；在固定时间预算下等于词汇覆盖砍半，而 TOEFL 阅读的瓶颈是广度（需 8,000-9,000 词族达 98% 覆盖） | Nation 2006；本报告 4.8 时间预算模拟 |
| 9 | **把"交错不同主题的单词"当卖点** | 元分析显示词表材料的交错效应是 **g = −0.39**（分块更好），交错的收益只在需要辨析相似类别时出现 | Brunmair & Richter 2019 |
| 10 | **让用户看着完整原句去"推测"词义** | 语境推测提升理解、但不提升留存；提升留存的是**提取**。同样一个句子，挖空和不挖空是两种完全不同的学习活动 | den Broek 2018 / 2022 |
| 11 | **多个短 learning steps（如 5m 10m 15m 30m）** | 官方明确不推荐；长于 12-14 小时的 step 也不推荐；会干扰 FSRS 排期，还可能让 Hard 间隔超过 Good 间隔 | Anki 官方 tutorial |
| 12 | **用日志刚攒到几十条就做个性化参数优化** | 小样本拟合出的参数不如默认值稳（默认值是在千万级复习数据上拟合的）。Anki 早期版本要求 400-1000 条才允许优化 | Anki 官方 tutorial |
| 13 | **抄 Duolingo 的 HLR** | 在 Anki 式长间隔场景下 Log Loss 0.4694，**比"永远输出用户平均留存率"的常数基线（0.3945）还差** | srs-benchmark |
| 14 | **把"复习了多少张卡"做成核心成就指标** | 会激励用户把 DR 调高/多刷，与"用最少时间记最多词"的真实目标相反 | 由 4.7 的 workload/knowledge 目标函数推出 |

---

## 六、落地方案清单

### 6.1 算法选型

- [ ] 引入 **`ts-fsrs`**（官方 TS 实现，MIT）。**不要自己实现 FSRS**。
- [ ] 版本用 **FSRS-6**（21 参数），权重用库内置 `default_w`。
- [ ] 存储字段（加到单词本表）：`stability` (float)、`difficulty` (float)、`due` (timestamptz)、`last_review` (timestamptz)、`state` (enum: new/learning/review/relearning)、`reps` (int)、`lapses` (int)、`step` (int)。
- [ ] **同时保留一张 `vocab_review_logs` 表**（word_id, rating, state, elapsed_days, scheduled_days, review_at）。**这张表从第一天就要写**——它是后续一切个性化优化的唯一原料，事后补不回来。

### 6.2 参数默认值

| 参数 | 默认值 | 依据 |
|---|---|---|
| `desired_retention` | **0.90** | 本报告 4.7 模拟；官方推荐区间 0.80-0.95 |
| 考前冲刺模式 DR | **0.95** | 考前 7-10 天开启，用户可关 |
| `maximum_interval` | **90 天**（而非库默认 36500） | 备考期最长 3 个月，超过考试日的间隔无意义 |
| learning steps | **单个 `15m`** | 官方推荐单个 10m/15m/20m/30m，不用多步 |
| relearning steps | **单个 `10m`** | 同上 |
| 新词首个间隔 | **强制 clamp 到 1 天**（覆盖 FSRS 给的 2.3 天） | 4.6 睡眠巩固；Mazza 2016 |
| 每日新词上限 | **20**（可调 10/15/20/25） | 4.8 时间预算模拟 |
| 每日复习上限 | **日均的 1.5 倍**，超出顺延 | 4.8 峰值/日均 = 1.44 |
| 评分档位 | **二档**：忘了(1) / 记得(3) | 4.9，Anki 官方 FAQ A8 |

### 6.3 卡片类型设计

**主卡型：语境完形填空（默认，每个收藏词 1 张）**

```
正面：  The discovery was ______ in reshaping our understanding
        of early human migration.
        [音标] /ˈpɪvətl/        ← 音标可给，但不给首字母
        （来源：阅读 · 2026-03-12）

        [ 想不起来 ]   [ 想起来了 → 翻面 ]

背面：  pivotal  /ˈpɪvətl/   adj. 关键的，核心的
        The discovery was **pivotal** in reshaping our understanding
        of early human migration.
        [tag: toefl]   [来源: 阅读]

        [ 忘了 ]  [ 记得 ]
```

实现要点：
- 挖空用 `sentence` 字段做**大小写不敏感 + 词形变体匹配**（收藏的是 `pivotal`，句中可能是 `Pivotal`；动词类要处理 -s/-ed/-ing）。**匹配失败时必须优雅降级**为纯词卡，不能渲染出一个没挖空的句子。
- 句子超过 ~30 词时截断到目标词所在从句（4.3 的「信息越少留存越好」证据）。
- `sentence` 缺失时（比如从别处导入的词）自动退化为纯词卡「英 → 中」。

**可选卡型 2：产出卡（中→英），默认关闭**
- 仅对 `source` 为写作/口语的收藏，或用户显式标记「要会用」的词生成。
- 正面给中文释义 + 挖空句（英文句子但目标词位置留空），要求用户**拼写**出来。
- 依据：Webb 2005/2009，产出式学习覆盖面更广，但成本高，所以限定子集。

**可选卡型 3：听力卡**，仅对 `source = 听力` 的词，正面播 TTS 音频。项目已有 edge-tts 免费链路，边际成本近零。

### 6.4 UI 上必须做到的几件事

1. **默认入口就是测试，不是浏览。** 单词本首页的主按钮是「开始复习（N）」。列表浏览是次级入口，且**不计入打卡/连续天数**。（4.1）
2. **先答后看，不可跳过。** 翻面前不显示答案；「想不起来」也要点一次才翻面——这一步的意义是**让用户真的尝试了提取**，而不是眼睛扫过去。
3. **只有两个评分键，且要大。** 「忘了」/「记得」。**永远不要出现 Hard/Easy。**（4.9）
4. **不显示下次间隔。** Anki 官方警告过：用户看到间隔就会用「我想多久再看到它」而不是「我记得多牢」来评分。（4.9）
5. **同一个词在同一 session 内最多出现 2 次**（第一次答错 → 隔 15 分钟或隔 ≥10 张卡后重来一次）。**禁止立即重复。**（反面清单 #2，4.6）
6. **复习队列打乱顺序**，且保证同源词（同一篇文章收藏的词）不相邻。（4.5）
7. **每日配额可见且有上限**，复习量超 cap 时明确告诉用户「今天剩下的已顺延到明天」，而不是无限堆积。（4.8）
8. **进度指标用「预计当前记得的词数」（∑R），不用「已复习卡片数」。** 前者是 workload/knowledge 里的 knowledge，后者是 workload。做错这一点会激励用户做无用功。（反面清单 #14）
9. **考试日期设置 + 冲刺模式**。用户填考试日期后：(a) `maximum_interval` 自动设为距考试天数；(b) 考前 7-10 天自动提示切到 DR=0.95；(c) 考前最后 3 天不再放新词，只清复习队列。
10. **每张卡显示来源**（哪一篇阅读/听力、什么时候收藏的）。这不只是信息展示——情境线索本身是有效的提取线索，且能让用户回到原文复盘。

### 6.5 后续用真实日志可以做的优化（按 ROI 排序）

1. **【最高 ROI】校准监控**：定期计算全站的 **RMSE(bins)** 和实际留存率 vs `desired_retention` 的偏差。如果实际留存率系统性低于 0.90，说明默认参数在我们这批中国考生 + 语境完形卡上偏乐观，需要整体调参。这个指标比任何 A/B 都直接。
2. **群体参数再拟合**：攒到足够日志（量级参考：Anki 要求个人 400-1000 条；群体拟合可以更早，因为是跨用户汇总）后，用 `fsrs-optimizer` 在**我们自己的日志**上重新拟合一套 21 参数作为**新的全局默认值**。这比给每个用户单独优化更稳，也更容易上线。
3. **按卡型分组参数**：语境完形卡和纯词卡的难度分布不同，值得各拟合一套参数（Anki 的 preset 就是这个思路）。
4. **个人化参数**：对复习日志 ≥ 400-1000 条的重度用户，单独优化。收益有限，优先级低于 1-3。
5. **反应时间做隐式分档**：用 `duration_ms` 把答对拆成 Hard/Good/Easy，绕开自评噪声。需要先验证反应时间与后续留存的相关性。
6. **「最小推荐留存率」计算器**：Anki 有 "Compute minimum recommended retention"，基于用户自己的答题耗时做模拟。我们有 `duration_ms` 就能做同样的事，给每个用户算个性化 DR 下限。
7. **升级到 FSRS-7**：等 ts-fsrs 支持成熟后再说。收益（Log Loss 0.3460 → 0.3370）对单词本场景基本不可感知，**不是优先项**。

---

## 七、参考文献

### 算法一手来源（源码 / 官方文档）

1. **FSRS 算法说明（官方 wiki）** — <https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm>（原 `fsrs4anki` wiki 已迁移至此）
2. **py-fsrs 源码** — <https://github.com/open-spaced-repetition/py-fsrs>，关键文件 `fsrs/scheduler.py`（`DEFAULT_PARAMETERS`、`FSRS_DEFAULT_DECAY = 0.1542`、`_next_interval`、`_next_stability`、`_next_difficulty`、`_short_term_stability`）
3. **fsrs-rs 源码** — <https://github.com/open-spaced-repetition/fsrs-rs>，`src/inference_v6.rs`（`FSRS5_DEFAULT_DECAY = 0.5`、`FSRS6_DEFAULT_DECAY = 0.1542`、`FSRS6_DEFAULT_PARAMETERS`）
4. **ts-fsrs（推荐的实现库）** — <https://github.com/open-spaced-repetition/ts-fsrs>
5. **SRS Benchmark（9,999 用户 / 3.5 亿条复习）** — <https://github.com/open-spaced-repetition/srs-benchmark>
6. **FSRS vs SM-17** — <https://github.com/open-spaced-repetition/fsrs-vs-sm17>
7. **fsrs4anki 官方教程（含 Anki 手册级指导）** — <https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md>
8. **最优留存率（官方 wiki）** — <https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention>
9. **SM-2 原始算法（SuperMemo 官方存档）** — <https://super-memory.com/english/ol/sm2.htm>
10. **Half-Life Regression（Duolingo）** — Settles, B., & Meeder, B. (2016). *A Trainable Spaced Repetition Model for Language Learning.* ACL 2016, 1848-1858. <https://research.duolingo.com/papers/settles.acl16.pdf> / 代码 <https://github.com/duolingo/halflife-regression>
11. **Memrise 间隔阶梯** — <https://memrise-users.fandom.com/wiki/Memrise_Spaced_Repetition_Intervals>（社区 wiki，非官方文档，**可信度中**）

### 记忆与学习科学

12. **Rowland, C. A. (2014).** *The effect of testing versus restudy on retention: A meta-analytic review of the testing effect.* Psychological Bulletin, 140(6), 1432-1463. — 提取练习 g = 0.50 [0.42, 0.58]，159 个效应量。<https://pubmed.ncbi.nlm.nih.gov/25150680/>
13. **Karpicke, J. D., & Roediger, H. L. (2008).** *The Critical Importance of Retrieval for Learning.* Science, 319, 966-968. — 40 组斯瓦希里语词对；持续测试 80% vs 仅重学 36%/33%。<http://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Karpicke-Roediger-2008_Sci.pdf>
14. **Karpicke, J. D., & Roediger, H. L. (2007).** *Expanding retrieval practice promotes short-term retention, but equally spaced retrieval enhances long-term retention.* JEP: LMC, 33(4), 704-719. <https://learninglab.psych.purdue.edu/downloads/2007/2007_Karpicke_Roediger_JEPLMC.pdf>
15. **Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006).** *Distributed practice in verbal recall tasks: A review and quantitative synthesis.* Psychological Bulletin, 132(3), 354-380. — 184 篇文章 / 317 实验 / 839 效应量。<https://augmentingcognition.com/assets/Cepeda2006.pdf>
16. **Cepeda, N. J., et al. (2008).** *Spacing effects in learning: A temporal ridgeline of optimal retention.* Psychological Science. — 最优间隔 ≈ 测试延迟的 20%（数周延迟）/ 5%（一年延迟）。<https://laplab.ucsd.edu/articles/Cepeda%20et%20al%202008_psychsci.pdf>
17. **Kornell, N. (2009).** *Optimising learning using flashcards: Spacing is more effective than cramming.* Applied Cognitive Psychology, 23(9), 1297-1317. — GRE 词汇；90% 分散更优，72% 的人主观判断相反。<https://sites.williams.edu/nk2/files/2011/08/Kornell.2009b.pdf>
18. **Bjork, R. A., & Bjork, E. L.** *Introducing Desirable Difficulties into Practice and Instruction.* — 储存强度 / 提取强度，新失用理论。<https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-introducing-desirable-difficulties-into-practice-and-instruction-bjork-and-bjork.pdf>
19. **Brunmair, M., & Richter, T. (2019).** *Similarity matters: A meta-analysis of interleaved learning and its moderators.* Psychological Bulletin. — 总体 g = 0.42；**词表材料 g = −0.39**（分块更好）；59 研究 / 158 样本 / 238 效应量。<https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf>
20. **van den Broek, G., et al. (2018).** *Contextual Richness and Word Learning: Context Enhances Comprehension but Retrieval Enhances Retention.* Language Learning. <https://onlinelibrary.wiley.com/doi/10.1111/lang.12285>
21. **van den Broek, G., et al. (2022).** *Vocabulary Learning During Reading: Benefits of Contextual Inferences Versus Retrieval Opportunities.* Cognitive Science. <https://pmc.ncbi.nlm.nih.gov/articles/PMC9285746/>
22. **Webb, S. (2005).** *Receptive and productive vocabulary learning: The effects of reading and writing on word knowledge.* Studies in Second Language Acquisition, 27(1), 33-52. <https://eric.ed.gov/?id=EJ777295>
23. **Webb, S. (2009).** *The Effects of Receptive and Productive Learning of Word Pairs on Vocabulary Knowledge.* RELC Journal. <https://journals.sagepub.com/doi/10.1177/0033688209343854>
24. **Mazza, S., et al. (2016).** *Relearn Faster and Retain Longer: Along With Practice, Sleep Makes Perfect.* Psychological Science, 27(10), 1321-1330. — 学习间插入睡眠使所需练习量减半，长期留存显著更好。<https://www.hendrix.edu/uploadedFiles/Academics/Faculty_Resources/2016_FFC/Learn%20then%20sleep.pdf>
25. **Gais, S., et al. (2006).** — 学后即睡对词汇巩固的稳定化效应。**（可信度：中，经二手综述转引，未读原文）**
26. **Nation, I. S. P. (2006).** *How Large a Vocabulary Is Needed For Reading and Listening?* Canadian Modern Language Review, 63(1), 59-82. — 阅读需 8,000-9,000 词族达 98% 覆盖，听力 6,000-7,000。<https://www.lextutor.ca/cover/papers/nation_2006.pdf>

---

## 附录：可信度总表

| 内容 | 可信度 | 说明 |
|---|---|---|
| FSRS-6 全部公式 | **高** | 逐行读 py-fsrs `fsrs/scheduler.py` 源码 |
| FSRS-6 的 21 个默认参数 | **高** | py-fsrs + fsrs-rs 两处源码一致 |
| FSRS-6 DECAY = −0.1542、FACTOR ≈ 0.980346 | **高** | 源码常量 + 本报告数值验算（R(S,S)=0.9 精确成立） |
| FSRS-4.5/5 DECAY = −0.5、FACTOR = 19/81 | **高** | fsrs-rs 常量 `FSRS5_DEFAULT_DECAY = 0.5` + 数值验算 |
| FSRS-5 的 19 个参数、FSRS-4.5 的 17 个参数 | **中高** | 官方 wiki + ts-fsrs 文档两个来源一致，**未直读源码** |
| FSRS-4.5 的 D₀ 公式为线性形式 | **中** | 来自官方 wiki 摘要，未直读 4.5 源码。FSRS-5/6 的指数形式**已核实源码** |
| srs-benchmark 各算法 Log Loss / RMSE / AUC | **高** | 直接读 README 原表 |
| 「FSRS 比 SM-2 少 20-30% 复习量」 | **低 / 未核实** | 仅见于二手博客，官方文档中**未找到**此数字。**不要写进产品文案** |
| 「FSRS-6 对 SM-2 有 99.6% superiority」 | **低 / 未核实** | superiority 全表是 PNG 图，无法机读核实 |
| 最优留存率 ≈ 85%（长期场景） | **高** | FSRS 官方 wiki 原文 |
| 允许范围 0.70-0.97 / 0.70-0.99，推荐 0.90 | **高** | Anki 官方 tutorial 原文 |
| 「FSRS 对只用 Again/Good 的用户更准」 | **高** | Anki 官方 tutorial FAQ A8 原文 |
| 本报告的两组模拟表（4.7 / 4.8） | **中** | **自建模拟，非文献结论。** 假设：FSRS-6 默认参数、用户评分完全校准、仅 Again/Good 二档、每日固定新词量。用于横向比较趋势可靠，绝对数值不可当预测用 |
| Memrise 具体阶梯 4h→12h→24h→6d→12d→48d→96d→6mo | **中** | 社区 wiki，非 Memrise 官方文档 |
| Gais et al. (2006) 的具体结论 | **中** | 经二手综述转引，未读原文 |
| 其余心理学论文的效应量与数字 | **中高** | 均来自论文标题/摘要或权威转引，**未逐篇通读全文 PDF** |
