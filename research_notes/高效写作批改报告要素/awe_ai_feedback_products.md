# AWE 与 LLM 写作反馈：研究证据 + 主流产品反馈报告结构拆解

> 研究时点：2026-09。所有 WebFetch 直接抓取原文的尝试在本次会话中被网络出口代理全部拦截（`hechingerreport.org`／`frontiersin.org`／`ets.org`／`writeandimprove.com`／`grammarly.com`／`ncbi.nlm.nih.gov`／`eric.ed.gov`／`scholarspace.manoa.hawaii.edu` 均返回 `EGRESS_BLOCKED`，代理状态显示 `connect_rejected: gateway 403`）。因此下列事实来自 WebSearch 工具返回的检索结果与其对原文的摘录/复述，**未能逐字核对原始论文全文**；凡属此类，已在证据强度中注明「二手摘录，未查原文」。能交叉验证（同一结论在≥2次独立检索中一致出现）的条目证据强度相应上调。

---

## Part A：AWE 与 LLM 写作反馈的实证研究

### KQ-A1：学生用 AWE/LLM 反馈后，写作分数到底提高了没有？提高在哪个维度？

#### Takeaway
证据总体呈「有正向但中等、且维度不均衡」的模式：多篇元分析显示 AWE/LLM 反馈对写作有中等效应量，但效应主要体现在**表层（语法/机械）指标**上，对**深层（论证/内容/组织）指标**的提升较小且更依赖是否搭配教师指导；多数对照 ChatGPT 与教师反馈质量的研究发现"整体差距不大，但教师在准确性、优先级判断上仍占优"。

#### Cited Findings
- Stevenson & Phakiti (2014, *Assessing Writing* 19: 51–65)：对自动化书面反馈（AWF）课堂研究的综述发现"modest evidence"支持 AWF 对写作有正向效果；区分组内(within-group)与组间(between-group)研究后，组内研究显示 AWE 反馈能提高写作分数、减少错误数，但组间研究结果混杂（不稳定）。证据强度：中（二手摘录，且检索结果里该综述的"审阅文章数"与另一篇同名度很高的 2022/2023 元分析摘要发生了混杂，具体覆盖了多少篇原始研究未能独立核实）— [ResearchGate 摘要聚合](https://www.researchgate.net/publication/365495802_The_Effectiveness_of_Automated_Writing_Evaluation_on_Writing_Quality_A_Meta-Analysis)；[Semantic Scholar 原文页](https://www.semanticscholar.org/paper/The-effects-of-computer-generated-feedback-on-the-Stevenson-Phakiti/efd3ee13f3ef43995f8f477d8129c3527f405f92)
- Fleckenstein, Liebenow & Meyer (2023, *Frontiers in Artificial Intelligence*)：对 20 项 AWE 研究、2,800 名高中/大学生的多层元分析，**总体效应量 Hedges' g = 0.55（中等效应，约相当于标准化测试上 7 个百分位点的提升）**；对多语言学习者（multilingual learners）效应更大；作者建议"自动反馈应与教师反馈、个性化学习机会等其他支持形式结合使用，才能确保有效性"。证据强度：中高（两次独立检索结果一致给出 g=0.55 与 7 百分位点这组具体数字，但未能直接打开原文核对） — [Frontiers 全文](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2023.1162454/full)；[PMC 版](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10351274/)
- Scherer, Graham & Busse (2026, *Assessing Writing*)，"Can algorithm-based feedback help students to write better? A meta-analysis exploring surface- and deep-level outcomes"：发现算法反馈对**表层与深层结果在后测(posttest)上均只有小效应**；L2 学习者获益更明显；表层效应在**维持测(maintenance)上消失**（即短期见效、长期不巩固）；不同工具间无显著差异；对新写作任务的迁移效应很小。这是目前检索到的**最新、专门区分表层/深层效果**的元分析，结论比早期"AWE 只对语法有效"的说法更细：连深层效果也只是"小"而非"零"，但持久性和迁移性都弱。证据强度：中（二手摘录） — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S107529352600022X)
- 2026 年一项元分析（*Language Learning & Technology* 系刊物/汇编未确认具体期刊，来自 tandfonline 检索）"Effects of AI feedback on students' English writing performance in higher education: a meta-analysis"：汇总 43 项研究、234 个效应量，发现 AI 反馈对写作表现有**显著、中等的总体影响**。证据强度：低-中（仅检索摘要，未核实全文与具体 g 值） — [Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/2331186X.2026.2665494)
- Steiss et al. (2024, *Learning and Instruction* Vol. 91)，"Comparing the quality of human and ChatGPT feedback of students' writing"：从五个维度评分反馈质量——(a) 是否基于评分标准(criteria-based)、(b) 是否给出清晰的改进方向、(c) 准确性、(d) 是否优先指出核心问题、(e) 语气是否支持性。**人工反馈在 5 项中的 4 项（准确性、优先级、方向清晰度、支持性语气）质量更高**；但在"标准对齐度(criterion alignment)"上 ChatGPT 表现相当；若综合考虑整体质量与省时优势，两者差距"modest（不大）"。证据强度：中高（多来源交叉一致） — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0959475224000215)；[OSF 预印本](https://osf.io/preprints/edarxiv/ty3em_v1)
- Escalante, Pack & Barrett (2023, *International Journal of Educational Technology in Higher Education*)，"AI-generated feedback on writing: insights into efficacy and ENL student preference"：研究1（48名大学 ENL 学生，6周准实验，实验组用 GPT-4 反馈 vs 对照组用人工导师反馈）——**两组学习效果无显著差异**；研究2（另43名学生同时接受 ChatGPT 和导师反馈）——**偏好接近对半分**，AI 与人工反馈各有明显优势领域。结论：AI 反馈可以在不损害学习效果的前提下纳入 ENL 作文评估，但建议混合使用。证据强度：中高 — [Springer](https://link.springer.com/article/10.1186/s41239-023-00425-2)
- Guo & Wang (2024)：5名中国 EFL 教师为50名本科生议论文打分并给反馈，同一批文章也用 ChatGPT-3.5 评分/反馈。**ChatGPT 产出的反馈总量显著多于教师**；教师反馈更集中在内容与语言问题，**ChatGPT 在内容、组织、语言三方面给出更均衡的关注**（即 ChatGPT 并非只管语法，反而在"组织"维度上比人类教师给得更多）。证据强度：中（二手摘录） — 综合检索页未给出独立可点击原文链接，来源汇总于相关综述检索结果
- 一项智利大学研究（44名19–21岁学生，随机分两组，4次写作各接受 ChatGPT 或受训人工教师的纠错反馈）：**两种反馈来源都能显著提升写作，且 ChatGPT 在所评估的全部标准上总体表现更优**。证据强度：低中（仅二手摘要，作者与期刊细节未独立核实） — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0346251X25002155)
- Meyer et al. (2024)：德国高中 EFL 学生议论文写作，实验组获得按 Hattie & Timperley (2007) 反馈模型（feed up / feed back / feed forward 三要素）定制提示词生成的 ChatGPT 反馈，对照组得到与任务无关的"伪反馈"。**获得反馈组在本篇文章的修订上显著优于对照组；但没有显著迁移到新写作任务**；同时 LLM 反馈提升了学生对未来写作任务的预期愉悦感和正面情绪。证据强度：中高（多检索交叉一致） — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0361476X26000214)
- Dai et al. (2023)：研究生数据科学项目计划书，用 GPT-3.5 生成反馈。**GPT-3.5 反馈的可读性、详尽程度、流畅连贯性优于人工讲师**；但按 Hattie & Timperley (2007) 有效反馈成分框架评估，**GPT-3.5 反馈的"有效性"仍逊于讲师反馈**；当搭配"如何解读建议"的显式指导时，ChatGPT 反馈能提升学生的修订质量。证据强度：中高 — [ResearchGate](https://www.researchgate.net/publication/370228288_Can_Large_Language_Models_Provide_Feedback_to_Students_A_Case_Study_on_ChatGPT)
- Link, Mehrzad & Rahimi (2022, *Computer Assisted Language Learning* 35(4): 605–634)，"Impact of automated writing evaluation on teacher feedback, student revision, and writing improvement"：仅确认到标题/期刊/卷期信息，具体量化结论未能在本次检索中取得。证据强度：低（仅引用信息，无实质发现）
- 一篇 2026 年"十年综述"型元综合（*Educational Technology Research and Development*）："AWE 对表层写作（语法、拼写）有效，但在提升高阶写作层面（如论证）上存在局限"——直接支持"AWE 只管语法"的批评。证据强度：中（二手摘录） — [Springer](https://link.springer.com/article/10.1007/s11423-026-10601-6)

#### Inferences
- 把多篇元分析放在一起看，效应量的量级大致收敛在"中等、偏小"（g≈0.3–0.55），且**效应在表层指标上更稳、更大，深层指标上更小且不持久（Scherer et al. 2026 的 maintenance 测试中甚至消失）**——这对"只给语法反馈就够"的产品设计假设是直接反证：光靠 AWE 表层反馈拿不到深层写作能力的持续提升。
- 学生分数提升与"是否搭配人工/结构化指导"强相关（Fleckenstein 2023、Dai et al. 2023、Escalante et al. 2023 都强调"混合使用"），提示我们的 DeepSeek 报告若想真正提分，应设计成"引导学生自己动手修订"而非单向给结论。

#### Gaps
- 未找到专门针对 **TOEFL 学术讨论帖/邮件题**（而非通用议论文）体裁的 AWE/LLM 反馈效果研究；现有证据多来自英文母语中学生或大学 EFL 议论文场景，向 TOEFL 场景外推需谨慎。
- Stevenson & Phakiti (2014) 原文具体纳入研究数量、效应量细节，因原始 PDF 无法抓取，未能核实（检索摘要疑似与另一篇同主题元分析混淆）。
- 未找到专门量化"AI 反馈 vs 教师反馈"在 **TOEFL 写作评分标准（Task Response/Development, Organization, Language Use）三个分维度**上各自提升幅度的研究。

---

### KQ-A2：学生更愿意接受/更会去用哪类反馈？AWE"只管语法"的证据是什么？

#### Takeaway
证据显示学生对**语言层面反馈的满意度高于内容层面反馈**，但这更多是"信任度/可用性"问题而非能力上限——研究同时证明**反馈的具体程度(explicitness)是决定学生能否成功利用反馈的最强因素**：具体、可操作的反馈显著优于笼统建议。

#### Cited Findings
- Ranalli (2018, *Computer Assisted Language Learning*)：82名 ESL 学生使用 ETS Criterion 16 周。Criterion 反馈准确率因错误类型差异很大，**部分错误类型的准确率低于 50%**。数据分析显示：**反馈的"具体程度(explicitness)"是学生能否成功改错的关键因素**——笼统反馈（如"Consider revising this sentence"这类只提出模糊补救方案的反馈）比具体反馈更难被学生转化为成功修改。证据强度：中高（多检索交叉，且是本领域高被引研究） — [ERIC 全文](https://files.eric.ed.gov/fulltext/EJ1323912.pdf)；[Tandfonline](https://www.tandfonline.com/doi/full/10.1080/09588221.2018.1428994)
- "学生使用 AI 反馈工具报告在语言层面反馈上满意度更高，但对内容相关反馈评价较不积极，说明反馈聚焦的精准度对学生参与度/信任度影响很大" — 证据强度：中（二手摘录，具体研究未标注作者/期刊） — 来自综合检索结果
- Warschauer & Grimes：MY Access! 在南加州8所初中使用3年的案例研究。**多数教师和学生都认为自动评分不可靠**，但仍然推荐使用该软件；使用率随时间上升，**教师留给写作/修订的时间增加后，学生修订作文的比例从第一年的12%升到第三年的53%**——说明"工具本身不完美"和"仍被广泛采用、有用"可以并存（Fallible but Useful）。证据强度：中高 — [多来源交叉](https://ejournals.bc.edu/index.php/jtla/article/view/1625)
- Zhang & Hyland (2018, *Assessing Writing* 36: 90–102)："学生对教师反馈与 AWE 反馈的参与度(engagement)受学习者特质与反馈呈现方式共同影响"；同作者2022年跟进研究（33名学生）发现，**将 AWE+同伴+教师三种反馈系统整合使用**能更有效促进学生行为、情感、认知三个维度的参与。证据强度：中高 — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1075293518300199)
- 2026 十年综述型元综合："AWE 对表层写作（语法、拼写）有效，在提升高阶写作层面（论证）上存在局限"，这是"AWE 只管语法"批评最直接的当代学术表述。证据强度：中 — 同上 [Springer](https://link.springer.com/article/10.1007/s11423-026-10601-6)
- Guo & Wang (2024) 的对照发现（见 KQ-A1）：**教师反馈更聚焦内容+语言，而 ChatGPT 在内容/组织/语言上给出更均衡的关注**——这实际上部分反驳了"LLM 只会挑语法"的刻板印象：至少新一代 LLM（相对早期规则式 AWE）在内容/组织维度上不弱于教师。证据强度：中

#### Inferences
- "AWE 只管语法"这个批评**更准确地说适用于早期基于统计特征/规则的 AWE 引擎（Criterion、MY Access!）**，而不完全适用于新一代 LLM（ChatGPT/GPT-4）——后者在内容和组织维度上能生成有实质内容的反馈，问题从"根本不管内容"转移为"内容反馈质量/具体度不如语言层面反馈"。
- Ranalli 的"具体度决定可用性"结论对我们 App 有直接指导意义：现有的"10个固定标签"+"最多2张短板行动卡"若停留在标签层面（如"逻辑衔接不足"）而不落到"这句话具体怎么改"，学生大概率无法真正利用。

#### Gaps
- 未找到专门针对 TOEFL 场景、比较"语法纠错反馈"与"内容/结构建议反馈"学生使用率的定量研究（如点击率、修订采纳率）。
- "语言反馈满意度高于内容反馈"这条发现来源标注不完整（未能定位到确切作者/论文），建议报告作者标注为"证据强度较低，待核实"。

---

### KQ-A3：LLM 反馈的已知问题，以及研究界/产品界提出的解决办法

#### Takeaway
已确认的失败模式包括：泛化/抽象、过度积极（甚至"讨好式"praise inflation）、抓不住核心问题、幻觉、以及 2026 年新发现的"**按学生人口统计学特征（种族/性别）系统性改变反馈语气**"的偏见问题。解决方向集中在：rubric-anchored prompting、引用原文定位、限定反馈数量与"平衡表扬-批评"的显式约束、feedforward(Hattie & Timperley)结构化提示。

#### Cited Findings — 失败模式
- "ChatGPT 生成的问题陈述和正面强化(positive reinforcement)被发现**泛化、抽象**，难以判断反馈精确度，具体性和清晰度都低；ChatGPT **未能识别核心问题**，反而针对表层错误给反馈，而不是文章的核心问题" — 出自对 ChatGPT 反馈 ELL 写作者连贯性/衔接性的评测研究。证据强度：中 — [arXiv 2310.06505](https://arxiv.org/pdf/2310.06505)
- 一项学期跨度的 AI 写作反馈追踪研究发现：**学生最初认为 AI 反馈有用（因为给出了具体建议），但随时间推移，对"建议笼统"和"表扬过软"等问题越来越挑剔**；很多学生认为 AI 反馈"因为要保持中立/安全而显得含糊(vague because it wants to be neutral)"，且没能对齐具体课程/该篇文章的期待。证据强度：中高（读取到具体引文，来源明确） — [arXiv 2607.16115](https://arxiv.org/html/2607.16115)
- "Over-praise（过度表扬）"被定义为：反馈给出的正面鼓励与实际表现不符，会通过制造对自身表现的错误印象而阻碍学习；LLM 反馈存在"sycophancy（讨好式）"倾向——即倾向于生成过分顺从、迎合的回应，在写作场景下就表现为**过度慷慨的表扬**。证据强度：中 — [相关综述性检索结果](https://www.sciencedirect.com/science/article/pii/S1096751625000612)
- 学生对 AI 生成反馈的心理偏见研究："学生可能默认 AI 生成的反馈准确性不如教师反馈，进而对其产生不信任感"。证据强度：中 — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13235111/)
- **2026年重要新发现（Stanford，"Marked Pedagogies: Examining Linguistic Biases in Personalized Automated Writing Feedback"）**：研究者对约600篇中学生作文，每篇提交给 AI 模型13次、每次附加不同的人口统计学描述（种族、性别、学习动机、学习能力标签），发现 **AI 对同一篇作文给出的反馈语气会随所标注的学生身份系统性变化**——被标注为黑人学生的作文获得更多表扬，被标注为白人学生的作文获得更尖锐、更严格的批评。作者 Mei Tan 认为，这是模型从海量人类语言训练数据中学到的人类偏见的映射（"They are picking up on the biases that humans exhibit"）。该发现2026年上半年发布，6月被 Education Week、Hechinger Report、KQED、OECD.AI事件库等多家机构广泛报道，属于交叉验证充分、证据强度较高的新发现。证据强度：中高（多家独立媒体+OECD.AI 事件登记交叉确认，但原始论文本身未直接读取） — [EdWeek](https://www.edweek.org/technology/ai-changes-its-feedback-on-students-writing-when-it-knows-their-race-gender/2026/06)；[OECD.AI 事件库](https://oecd.ai/en/incidents/2026-04-27-b490)；[Hechinger Report](https://hechingerreport.org/proof-points-ai-bias-feedback/)
- 幻觉问题：搜索结果确认"幻觉"是 LLM 应用的通用已知问题（生成自信但无事实依据的内容），但**未找到专门量化 LLM 写作反馈场景下幻觉发生率的研究**（多为医学/文献综述领域的幻觉率研究，如 JMIR 对 ChatGPT/Bard 系统综述幻觉率的比较），需标注为 Gap。证据强度：低（未找到写作反馈场景专属数据）

#### Cited Findings — 已提出的解决办法
- **Rubric-anchored / rubric-grounded prompting**：多篇2025–2026会议论文（如 CHI 2026 的 *iRULER: Intelligible Rubric-Based User-Defined LLM Evaluation for Revision*、*A Rubric-Grounded LLM Feedback Framework for Academic Writing*）提出：让 LLM 按用户自定义评分细则(rubric)逐项打分、给出理由(justification)、并对不同质量层级给出可执行的修改建议(actionable revisions)，以提升反馈的透明度和可操作性；一项相关研究提出**五维度评分反馈质量的细则**：正确性(correctness)、不直接给答案(non-revealing)、引导性(suggestiveness，引导学生自己找到答案而非代劳)、诊断性(diagnostic value，能指出误解根源)、积极度(positivity，保持鼓励但不过度)。证据强度：中（多篇会议论文交叉印证同一设计方向，但均较新、尚缺乏大规模课堂验证） — [ACM DL: iRULER](https://dl.acm.org/doi/pdf/10.1145/3772318.3790539)；[ACM DL: Rubric-Grounded Framework](https://dl.acm.org/doi/10.1145/3806980.3807007)
- **结构化输出+提示词调整降低幻觉**：2024年研究显示"提示词调整、任务澄清、结构化输出格式能降低幻觉率、提升相关性"，说明有效整合不只取决于模型版本，也取决于自适应的人工监督和提示词设计；"当团队采用结构化反馈循环，输出会随时间变得更可靠"。证据强度：低中（较泛泛的综述性结论，未指向单一可核实的原始研究）
- **Feedforward 结构（Hattie & Timperley, 2007）**：Meyer et al. (2024) 与 Dai et al. (2023) 都采用该框架构造提示词——反馈应同时包含 "feed up"（目标是什么）、"feed back"（现在做得怎样）、"feed forward"（下一步怎么做）三要素；Meyer et al. 的实证结果显示，按此结构提示生成的反馈**确实带来了显著的修订改善**（虽然未迁移到新任务）。证据强度：中高（两项独立实证研究都采用并验证了该框架的有效性）
- **显式约束"表扬与批评的平衡"**：2025年相关研究发现，"AI 在平衡表扬与批评方面比人类反馈更一致，而人类反馈有时会偏向批评而不先肯定优点"；同时指出**优秀设计的正面评论应指出具体成就而非泛泛认可，并且应刻意让建设性建议数量略多于表扬**；在跨专业评审者调研中，"平衡度(balance)"被评为反馈质量各维度里评分最高的一项。证据强度：中（二手摘录，具体论文来源不完全明确，但与 Hattie & Timperley 传统主张一致，可信度较高）
- **限定反馈数量 / 引用原文句子定位**：检索到的"criterion-level transparency"设计原则强调"每条反馈锚定到具体的评分标准条目/具体句子，帮助学习者理解为什么被扣分"——这与我们 App 现有的"逐句红橙蓝批注"设计方向一致，是被学术界认可的有效模式。证据强度：中（原则性共识，非单一实证研究的直接检验）

#### Inferences
- 把"过度表扬"和"泛化建议"两个失败模式放在一起看，二者其实同源：都是 LLM 在缺乏明确评分锚点（rubric/原句定位）时，倾向于生成"安全、不会说错、但也不具体"的通用话术。因此**rubric-anchored + 引用原句 + 结构化 feed up/back/forward** 这三件事，是目前证据支持度最高、且互相独立可以叠加的解决方案组合。
- 种族/性别偏见的发现虽然是新研究（2026），但提示我们：如果 DeepSeek 报告的 prompt 中包含任何可能泄露学生身份/背景的信息（如用户此前的错误历史、自我介绍），需要警惕反馈语气/严格度是否会因此系统性漂移——这是一个此前在我们的架构讨论中未被考虑过的风险点。

#### Gaps
- 未找到专门测量"LLM 写作反馈幻觉率"的量化研究（例如"LLM 声称原文有某个语法错误但实际没有"这类具体错误率）。
- 未找到"限定反馈数量"（如我们 App 的"最多2张短板卡"设计）本身作为独立变量的对照实验证据——目前只能从"具体性/可操作性"相关研究间接推断"少而精"优于"多而泛"，但没有直接验证"卡片数量"这个变量本身。

---

## Part B：主流产品写作反馈报告结构拆解

> 以下每个产品标注信息来源类型：官方文档/帮助中心 = 官方一手；学术评测/综述论文 = 第三方评测；产品自身博客 = 官方一手但有营销倾向，需交叉判断。因 WebFetch 被拦截，全部内容来自 WebSearch 对页面的检索摘要，**均未能打开原始网页逐字核对排版/截图**，建议报告使用者标注"二手转述，如需精确截图需人工访问"。

### 产品1：Cambridge English — Write & Improve

- **信息来源**：官方帮助中心文章（Cambridge Write & Improve Help Center），经 WebSearch 摘录，未直接抓取全文。
- **报告板块**：① 分句反馈——对**单词/句子层面**的问题（拼写、语法、用词选择）给出"间接、半纠正式(indirect, semi-corrective)"提示，以及对每句话的**质性评价**，让学习者意识到哪里需要注意；② **CEFR 等级评估**——给出一个总结性的、估计的 CEFR 等级（如 B1/B2），可与全球其他学习者的写作对标；③ **进度图(progress graph)**——将本次写作与自己历史提交对比，展示随时间的进步曲线；④ 激励性反馈(motivational feedback)。
- **是否给"标准答案"**：明确**不给**。官方理念强调"没有唯一正确答案"，系统只标出需要注意的区域和原因，鼓励学生自己修订、自己判断是否采纳，是"学习者中心、过程写作法(process-writing)"的设计哲学，刻意不直接代劳。
- **是否与分数挂钩**：是，落到一个 CEFR 等级（非具体百分制分数）。
- **是否给下一步任务**：给"再次提交修订版"的路径 + 历史进度对比图，属于弱形式的"下一步"（重写而非推荐新题）。
- 来源：[Write & Improve Help Center](https://help.writeandimprove.com/en/articles/1104369-how-does-write-improve-work)；[CEFR等级说明](https://help.writeandimprove.com/en/articles/4412702-what-do-the-levels-mean-and-what-is-the-cefr)

### 产品2：ETS Criterion / e-rater 评分引擎

- **信息来源**：ETS 官方页面（About/How e-rater Works）+ 一篇发表于 *Language Learning & Technology* 的 Criterion 评测综述论文，均经 WebSearch 摘录。
- **报告板块（按 e-rater 的五大 trait 分类）**：Grammar（语法）、Usage（用法）、Mechanics（标点/拼写等机制性问题）、Style（文体，如识别"不良文体特征"）、以及 **Organization & Development（组织与展开）**——系统会自动识别文章中对应 Background、Thesis、Main Ideas、Supporting Ideas、Conclusion 这几个话语结构类别的句子，评估文章的论证展开是否完整。
- **呈现方式**：落入某个错误类别/类型的词或词组会被**高亮**，学生可按类别筛选查看。
- **是否与分数挂钩**：是——e-rater 同时是**打分引擎**（可给出整体作文分）和**诊断反馈引擎**（Critique 应用给出错误定位与解释），二者共用同一套特征体系（词汇/词法复杂度、语法-用法-机制错误比例、文体评论比例、组织与展开得分）。
- **是否给下一步任务**：未在检索到的资料中发现有"下一题推荐"机制；反馈聚焦于"本篇文章哪里有问题"，而非跨篇的学习路径规划。
- **局限（第三方评测提及）**：L2 课堂研究反复发现 Criterion 反馈准确率**因错误类型不同差异很大，部分类型准确率低于50%**（见 KQ-A2 Ranalli 2018）。
- 来源：[ETS How e-rater Works](https://www.ets.org/erater/how.html)；[ETS About e-rater](https://www.ets.org/erater/about.html)；[LLT Criterion 评测综述](https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/5fbfc389-0090-4f20-8807-e372974b5bf5/content)

### 产品3：ETS TOEFL TestReady（含 TOEFL Practice Online 后继产品）

- **信息来源**：ETS 官方产品页（欧洲站点），WebSearch 摘录。
- **报告板块**：写作部分给出针对**语法、用法、机制(mechanics)**等维度的具体反馈；产品定位为"由编写/制作 TOEFL iBT 正式考试的同一团队开发全部反馈、建议、个性化洞见和技巧"，强调评分/反馈与官方考试同源。
- **形式**：区分 **Section Tests**（完成一整个 Section 后给分数+洞见）与 **Section Practice**（按题型/子技能颗粒度给反馈+洞见，并配"范例答案(example responses)"）。
- **时效**：完整测试的分数/反馈在**24小时内**提供；单题/单部分练习则为**即时**反馈。
- **是否与分数挂钩**：是，直接给出分数与表现洞见（performance feedback）。
- **是否给下一步任务**：产品页提到"TestReady 中表现越好，越有可能在正式 TOEFL iBT 中取得更高分"，暗示其作为**分级练习路径**的定位，但具体"下一步推荐哪种题"的机制细节未在检索资料中找到。
- 来源：[ETS TOEFL TestReady](https://www.eu.ets.org/toefl/test-takers/ibt/prepare/toefl-testready.html)；[ETS 新闻稿](https://www.ets.org/news/press-releases/introducing-toefl-testready-new-era-test-preparation.html)

### 产品4：Grammarly / GrammarlyGO

- **信息来源**：Grammarly 官方博客（Tone Detector 相关文章）+ 学术论文对 Grammarly 的评测，WebSearch 摘录。
- **报告板块（四维度）**：**Correctness**（语法/拼写等正确性，全体用户免费可见）、**Clarity**（是否有冗长/不清晰句子，含被动语态使用）、**Engagement**（用词是否有变化、是否生动有趣）、**Delivery**（正式度、礼貌度、用法惯例、友好度是否得体）。四维度之外还有独立的 **Tone Detector**：通过分析用词、措辞、标点甚至大小写，将整体语气判定为如 friendly/confident/formal/optimistic/neutral 等类别。
- **分层可见性**：Correctness 和 Clarity 建议对所有用户开放；**Engagement 和 Delivery 建议仅对 Premium 付费用户开放**——这是一个值得注意的产品化设计：把"更高阶"的写作建议（语气/吸引力）作为付费墙背后的差异化卖点。
- **是否与分数挂钩**：Grammarly 有一个整体"写作分数(Writing Score)"，但检索结果未详细说明其与四维度的具体加权关系。
- **是否给下一步任务**：以**逐条可点击接受/忽略的行内建议**为主要交互形式，不是"课程式"的下一步任务推荐，更接近"实时校对+语气分析"而非"学习路径"产品。
- 来源：[Grammarly Tone Detector 博客](https://www.grammarly.com/blog/product/tone-detector/)；[Grammarly Tone 产品页](https://www.grammarly.com/tone)

### 产品5：批改网 Pigai（中国）

- **信息来源**：批改网官方"关于我们/入门教程"页面，WebSearch 摘录（中文原文直接保留）。
- **核心机制**：把学生作文当作一个"学习者语料"，与给定的标准语料库做对比分析，通过**192个维度**转换为句评、总评和分数，号称能在 **1.2 秒内**完成一篇作文的评分与批改反馈。
- **报告板块**：① 分数；② 总评；③ **按句纠错/点评**（逐句给出问题与建议）。产品官方理念明确表态"作文分数重要，但具体的反馈和建议更重要，因为后者使得学生知道如何去修改"——即官方自己也认为"只给分不给具体反馈"是不够的。
- **是否与分数挂钩**：是，分数、总评、句评三者同时给出。
- **是否给下一步任务**：检索到的资料未明确提及"下一步推荐题目/学习路径"机制，产品定位更偏"批改工具"而非"学习路径规划"产品。
- **规模**：官方称已有**超过5000所学校**使用该服务，用户量级"两千万人"（首页标语）。
- **第三方视角**：一篇学术系统综述将 **Grammarly、Pigai、Criterion 三者并列比较**，讨论生成式 AI 时代下三者的未来方向，可作为交叉参照。
- 来源：[批改网入门教程](https://www.pigai.org/about/help.html)；[批改网首页](https://www.pigai.org/)；[Grammarly/Pigai/Criterion 系统综述](https://link.springer.com/article/10.1007/s10639-023-12402-3)

### 产品6：Duolingo English Test (DET) 写作部分

- **信息来源**：Duolingo 官方博客与官方评分说明页，WebSearch 摘录。
- **报告板块**：DET 总分为 **10–160 分（5分为一档）**；写作作为**四个独立子分(independent subscore)**之一（Speaking / Writing / Reading / Listening）单独报告，此外还有四个**整合子分**（Literacy / Conversation / Comprehension / Production），写作任务的表现会计入相关整合子分。
- **形式**：写作任务之一"Writing Sample"要求考生写一篇结构化的议论文/说明文来评估其构建论证与展开内容的能力。
- **是否与分数挂钩**：是——所有反馈最终都汇总/服务于分数报告(Score Report)，DET 官方定位是"用 AI 训练模型以类似人类理解语言能力的方式来评估"，但产品面向的是**招生决策**场景，反馈的详细程度和形成性程度不如 Write & Improve / Criterion 这类练习型产品。
- **是否给下一步任务**："可以用 Score Report 上的反馈来识别需要努力的技能领域"，但这是较笼统的表述，未检索到具体的"下一步练习推荐"机制细节。
- 来源：[DET 评分说明博客](https://blog.englishtest.duolingo.com/how-is-the-duolingo-english-test-scored/)；[DET Scores 官方页](https://englishtest.duolingo.com/scores)

### 产品7：Turnitin Revision Assistant（现整合入 Turnitin Feedback Studio 线）

- **信息来源**：Turnitin 官方新闻稿/产品页 + 第三方教育媒体评测，WebSearch 摘录。
- **报告板块（四个固定维度）**：**Language**（语言）、**Focus**（聚焦度/切题度）、**Organization**（组织）、**Evidence**（论据/证据使用）。每个维度给一个 **1–4 分的"信号强度"评分（signal check，形似手机信号格）**，而非传统的百分制打分。
- **形式特色**：反馈是**行内(in-line)**、随学生打字**实时**给出的；还有一个 **timeline 视图**，展示一篇作文在写作过程中各维度分数随时间的变化轨迹（体现"过程写作"理念，而不仅是终稿快照）。
- **配套机制**：**Spotlight**（快速、形成性的写作表现快照，用于教师做题型/体裁对齐的作业布置）和 **Expansion Pack**（提供不同体裁的分级提示——informative/argumentative/analysis/narrative——对齐写作课程标准）两种作业类型，让教师能用"actionable data（可执行数据）"区分教学。
- **是否与分数挂钩**：是，四个 1–4 分的信号分。
- **是否给下一步任务**：有——Expansion Pack 机制相当于按体裁/难度提供下一步的写作任务序列，是本次拆解中"下一步任务"机制最明确的产品之一。
- **规模**：官方称自2016年推出以来，已服务超过**100个学区、20万名学生**。
- 来源：[Turnitin 新闻稿](https://www.turnitin.com/press/turnitin-revision-assistant-introduces-new-content-and-assignment-types-to-support-formative-writing-instruction)；[Turnitin 产品页](https://www.turnitin.com/products/revision-assistant/)；[Class Tech Tips 评测](https://classtechtips.com/2016/06/10/revision-assistant-student-writing-feedback/)

### 产品8：Writing9（IELTS 场景 AI 反馈工具）

- **信息来源**：产品官网及第三方评测/聚合站点，WebSearch 摘录（该类产品官方文档较薄，多为营销页面，证据强度整体偏低）。
- **报告板块**：语法错误标注、句子结构检查、更优用词建议、**基于官方 IELTS 评分标准预测的 band score**；反馈覆盖 **grammar / coherence / task response / lexical resource** 四个 IELTS 官方评分维度；提供**范文对比(sample answers)**；给出"**冲 Band 7+ 的结构建议**"。
- **是否与分数挂钩**：是，核心卖点就是 band score 预测。
- **是否给下一步任务**：有"保存并追踪作文进度(save and track your essay progress)"的功能，属弱形式的学习路径。
- **交付速度**：宣称"数秒内"给出反馈，作为相对人工导师"数天等待"的核心卖点。
- 来源：[Writing9 评测聚合](https://ieltsonlinecourses.net/writing9-review/)；同类竞品对照见 [Cathoven IELTS Writing Checker](https://www.cathoven.com/ielts/writing/)

### 产品9：Khanmigo（Khan Academy Writing Coach）与 Brisk Teaching

- **信息来源**：官方产品页 + 第三方教育科技评测站点，WebSearch 摘录。
- **Khanmigo / Khan Academy Writing Coach**：学生提交草稿后，AI **引导式地带学生走一遍修订流程**（而非一次性甩出完整报告），反馈聚焦**结构与组织、论点是否有充分支持、整体语气与文体**；同时教师端可用 Khanmigo **草拟基于评分细则(rubric-based)的反馈**，教师再做个性化调整后发给学生——即"AI 打草稿、教师把关"的半自动化模式。模型基于 OpenAI GPT，但经 Khan Academy 微调和"精心控制(carefully controlled)"。
- **Brisk Teaching**：浏览器扩展（Chrome/Edge），直接嵌入 Google Docs 等教师日常工具；核心写作反馈格式是 **"3 glows + 3 grows + 3 wonderings"**（3个优点 + 3个可改进点 + 3个引发学生思考的提问）——这是一个具体、可复用的"表扬-建议-提问"三段式反馈模板，与前文"平衡表扬与批评"的设计原则高度吻合。第三方评测指出，Brisk 的反馈**深度弱于专门的评分类工具**，不能批量处理整班提交，也给不出 Turnitin 那种"逐维度打分"级别的细致反馈；其差异化功能是 **"Inspect Writing"**——回放学生写作过程（检测是否直接粘贴等）。
- **是否与分数挂钩**：Khanmigo 弱挂钩（更偏对话式引导，非独立打分产品）；Brisk 不给正式分数。
- **是否给下一步任务**：Khanmigo 有——以"引导修订流程"本身即为下一步；Brisk 的"3 wonderings"提问式反馈也是一种轻量"下一步"形式（留问题给学生自己解决，而非直接给答案）。
- 来源：[Khanmigo Writing Coach 官方页](https://www.khanmigo.ai/writingcoach)；[EdWeek 报道](https://www.edweek.org/technology/khan-academy-plans-to-shake-up-writing-instruction-with-ai-tool/2023/11)；[AVID Brisk 评测](https://avidopenaccess.org/resource/brisk-teaching-an-ai-teaching-assistant-and-writing-feedback-tool/)；[Brisk 官网](https://www.briskteaching.com/)

---

### KQ-B补充：AI 写作反馈报告设计原则/框架是否已有系统化提法？

#### Takeaway
是的，学术界近两年已收敛出几条被反复验证/引用的设计原则：**rubric 锚定（含"不直接给答案"这条子原则）、feed up/back/forward 三段结构、平衡表扬与批评（且批评条数可略多于表扬但语气要具体化）、反馈锚定到具体句子/评分条目以保证透明度**。这些原则彼此不冲突，可以叠加实现。

#### Cited Findings
- 一项相关设计细则总结提出 **5 项评价维度**：correctness（正确性/相关性）、non-revealing（不直接揭示答案）、suggestiveness（引导性，引导学生自己找到答案）、diagnostic value（能诊断出误解根源）、positivity（保持鼓励但不过度）——用来评价/约束 LLM 生成的反馈质量。证据强度：中 — [PMC: A rubric to assess generative AI-based feedback](https://pmc.ncbi.nlm.nih.gov/articles/PMC13520698/)
- Hattie & Timperley (2007) 的三层反馈模型（Feed Up 目标是什么 / Feed Back 现在如何 / Feed Forward 下一步怎么做）被 Meyer et al. (2024) 和 Dai et al. (2023) 两项独立 LLM 反馈实证研究采用为 prompt 设计基础，且都观测到正向效果（见 KQ-A1/A3），是目前**唯一有实证支持、且被两项独立研究复用**的结构化框架。证据强度：中高
- "参与者认为'平衡度(balance)'——即正面表扬与批评的恰当比例——是反馈质量各维度中评分最高的一项；好的正面评论应指出具体成就而非泛泛认可，且刻意让建设性建议的数量略多于表扬" — 证据强度：中（二手摘录，来源论文具体作者不明确） — 综合检索结果
- "Rubric 对齐反馈提供条目级别的透明度(criterion-level transparency)，每条评论锚定到具体的评分条目，帮助学习者理解为什么被扣分" — 与我们 App 现有"逐句红橙蓝批注"设计方向直接吻合，属于被广泛认可但较少被单独实证检验的设计常识。证据强度：低中

#### Inferences
- 这四条原则（rubric 锚定/不代劳、feed-up-back-forward 结构、表扬批评显式配平、条目级透明锚定）几乎可以直接映射到一份"重新设计的批改报告"的板块骨架上：目标对齐(Feed Up，对应本篇 vs 该分数段的差距) → 现状诊断(Feed Back，对应现有的错误规律标签+批注，但需锚定到具体句子和具体 rubric 条目) → 下一步行动(Feed Forward，比现有"最多2张短板行动卡"更进一步的是要给出**针对本篇具体内容的、可执行的下一步动作**，而不是通用建议模板)。

#### Gaps
- 未找到专门针对 **TOEFL 独立/综合写作评分标准（ETS 官方 rubric：Development, Organization, Language Use 等）** 的 rubric-anchored prompting 案例研究；现有 rubric-anchored 研究多在通用议论文/编程作业场景，直接照搬到 TOEFL 语境的有效性未经验证。

---

## 对本产品的设计启示

1. **"只给语法反馈"的批评在证据上站得住，但更精确的表述是"深层反馈效果小且不持久，不是没有"**（Scherer et al. 2026）——现有报告已经有逐句批注和错误标签，说明不缺"发现问题"的能力，缺的可能是"帮学生把发现的问题转化为可执行修改动作"的最后一步（Ranalli 2018 的"具体度决定可用性"是最直接的证据）。

2. **"像套话"这个用户反馈，几乎可以在文献里精确定位到对应的失败模式**：generic/abstract feedback（arXiv 2310.06505）+ over-praise/sycophancy（多篇 2025-2026 研究）。解法不是"多写字"，而是**强制反馈锚定到本篇文章的具体句子和具体 TOEFL 评分维度**——这与我们现有的"逐句红橙蓝批注"架构方向一致，问题可能出在"总评"和"行动卡"这两个更抽象的板块上，它们更容易滑向通用话术，应该优先重新设计成"引用原句 + 具体量化对比（比如'你这句话比 Band 4 范文少了一个让步从句，加一个就能让论证显得更完整'这种级别的具体度）"。

3. **feed up / feed back / feed forward 三段结构是目前证据支持度最高、且可直接落地的报告骨架**（两项独立研究复用并验证）。可以考虑把现有报告重组为：① 这次任务对应的分数段目标是什么（Feed Up）② 本篇在错误标签+逐句批注层面现在是什么水平（Feed Back，保留现有优势）③ 针对本篇具体内容、可立即执行的1-2个下一步动作（Feed Forward，比现有"最多2张短板行动卡"更进一步地绑定到本篇原句）。

4. **显式配平表扬与批评，且表扬要具体化**：不要用"整体写得不错"这类泛泛表扬，应参照 Brisk 的"3 glows"模式——每条表扬都指向本篇的具体句子/具体做法（例如具体引用学生某句话，说明它好在哪、对应哪个 TOEFL rubric 维度）。

5. **付费分层的产品化参考**：Grammarly 把"更高阶"的 Engagement/Delivery 建议放在付费墙后，Turnitin 用"下一步任务序列(Expansion Pack)"做差异化——如果后续要区分免费/Pro 版报告深度，可以参考"表层语法反馈免费、深层内容/组织反馈+下一步定制任务归 Pro"的分层逻辑，且这与本 App 现有的 free/pro tier 设计天然契合。

6. **风险提示（本次研究的新发现，此前未被讨论过）**：Stanford 2026 年研究发现 LLM 会根据被赋予的学生身份特征系统性改变反馈的表扬/批评比例。如果我们的 prompt 中传入了任何用户历史信息、自我介绍或人口统计学线索，需要评估是否存在类似的系统性漂移风险——建议作为一个独立的技术风险项，或许值得做一次"匿名 vs 携带用户历史"的反馈语气 A/B 对比测试。

7. **"下一步任务"这个板块目前证据最充分的形式，是 Turnitin 的"按体裁/难度分级任务序列"和 Cambridge Write & Improve 的"直接重写本篇+历史进度图对比"**——两者代表两种不同哲学：前者是"横向"推荐新题，后者是"纵向"逼学生把这篇改到更好再走。现有报告已有"AI 现写范文对比"，更接近后者哲学；如果要加强"下一步"，优先级应该是先做"引导学生重写这一篇"的闭环（如逐条标出"改了这一处，本篇预计能提高到哪个分数段"），而不是急于做题目推荐系统。
