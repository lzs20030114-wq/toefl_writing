# 把批改报告重做成一节写作课

一份 TOEFL 写作批改报告要真正提分，它的骨架不该是「分数 → 评语 → 错误 → 范文」，而应该是**「先让学生自己判断 → 三句话把目标/现状/下一步说清 → 一道可检测的任务硬闸 → 一个（且只有一个）被深挖到句子的内容短板 → 语言错误按『压分/不压分』和『可治/不可治』两次分流 → 范文当比较任务用 → 以一次真动手的改写结束」**。这个顺序不是审美选择：Butler (1988) 的经典实验显示分数一旦与评语并列呈现，效果就退化到「只给分数」的水平（[Kappan/Guskey 综述](https://kappanonline.org/grades-versus-comments-research-student-feedback-guskey/)）；Graham, Harris & Hebert (2011) 的元分析给出自动化反馈的基线效应量只有 **0.38**，而自我评价是 **0.62**、教师反馈是 **0.87**（[Carnegie 报告](https://media.carnegie.org/filer_public/37/b8/37b87202-7138-4ff9-90c0-cd6c6f2335bf/ccny_report_2011_informing.pdf)）——这意味着 AI 批改要突破天花板，**唯一的现实杠杆是把学生从接收方变成动手方**，而不是把报告写得更长。与此同时，用户口中的「套话」在文献里有精确对应的失败模式（generic/abstract feedback 与 over-praise/sycophancy），在本产品里还叠加了四处代码级的硬编码注入与丢弃：`calibration.js` 给高分文凭空塞英文「拔高建议」、`parse.js` 把英文短板卡整段换成三句万能中文、模型每次都写的三维度理由和 `===ERRORS===` 逐条判定被解析层丢掉、写后练习只抽拼写。本报告据此给出一份八板块的报告蓝图（每块写清给什么、不给什么、为什么、证据多强），对照当前产品列出差距，并把无法由文献回答、必须用自有数据验证的五个假设单独列出。

---

## 证据基础：六份笔记都卡在同一道代理墙外，仓库里反而有一手证据

必须先如实说明证据条件。本轮六份研究笔记的作者在同一个网络环境里工作，**出口代理拦截了几乎所有一手来源域名**——ets.org 全家族、toefl-ibt.jp、journals.sagepub.com、onlinelibrary.wiley.com、files.eric.ed.gov、researchgate.net、frontiersin.org、zhihu.com、magoosh.com 等等一律返回 `EGRESS_BLOCKED`。因此绝大多数论文结论是**搜索引擎摘要交叉验证**的产物，而不是对原文 PDF 的逐字核对；笔记作者已经在每条后面标注了证据等级和「未核实一手来源」，本报告全部沿用，并在引用数字时把这个标注一并带上。凡笔记里没有给出可点击来源的数字（例如 Wisniewski/Zierer/Hattie 2020 的反馈平均效应量、「不回应同学 → 封顶 3 分」这条行业说法的出处），本报告**一律不引用具体数值**。

反过来，有两类证据是一手的、且就在仓库里，权重应当高于任何二手摘要。第一类是 `data/writingScoring/etsGoldenSamples.json`：三篇 ETS 官方带分样文，附官方评分员评语与校准结论。其中 5 分的 airplane 文含 `airpline`、`partiullary` 拼写滑误、句号后不空格、`brazilian` 未大写、`a important`、`any place of the world` 等约十处表面错误，官方评语明确写着 *these kinds of errors are to be expected from a competent writer under timed conditions*，照样给满分；4 分的 lightbulb 文评语则是 *had have to / it is produce / don't need to storage* 这类基本动词形态与词类误用**反复出现**，*distracting for the reader even though the intended meaning is still usually clear*，因此封在 4 分。第二类是 `lib/ai/prompts/academicWriting.js` 与 `emailWriting.js` 开头的 0.5 分段标准——这是本产品当前对 ETS rubric 的编码，可以当作「现状」的权威引用（例如它已经写明「官方规则：引用或回应其他学生的观点是可选的加分方式……禁止因『没有回应他人观点』而压分」）。

这两份一手材料直接决定了蓝图里两个最关键的设计判断：**满分不等于零错误**（所以报告必须把「压分的错」和「不压分的错」分开显示），以及**官方评语的写法是「指着某一步论证说它停在哪」**（灯泡文评语原话：只说了比蜡烛好，没说为什么是 200 年来最重要）——这是整份蓝图里内容层反馈的模板，也是目前产品最缺的东西。

---

## 「套话」在文献里有名字：generic feedback 叠加 sycophancy，再叠加四处代码注入

用户说「像套话、不深入」，这不是一个模糊的体感，它可以被文献精确定位。一项对 ChatGPT 反馈 ELL 写作连贯性的评测发现，模型生成的问题陈述与正面强化**泛化、抽象**，具体性和清晰度都低，并且**未能识别核心问题，反而针对表层错误给反馈**（[arXiv 2310.06505](https://arxiv.org/pdf/2310.06505)）【单项评测研究】。一项跨学期的 AI 写作反馈追踪研究记录了更贴近本产品的用户曲线：学生最初因为「给了具体建议」而认可 AI 反馈，**但随时间推移对「建议笼统」「表扬过软」越来越挑剔**，不少学生直接说 AI 反馈「因为想保持中立所以显得含糊」（[arXiv 2607.16115](https://arxiv.org/html/2607.16115)）【单项质性研究】。而 LLM 的 sycophancy 倾向在写作场景下就表现为过度慷慨的表扬，这种 over-praise 被定义为「正面鼓励与实际表现不符，通过制造错误的自我印象阻碍学习」（[综述检索结果](https://www.sciencedirect.com/science/article/pii/S1096751625000612)）【中·二手摘录】。

更关键的是 Ranalli (2018) 对 82 名 ESL 学生使用 ETS Criterion 16 周的研究：Criterion 的反馈准确率因错误类型差异极大，**部分类型低于 50%**，而数据分析显示**反馈的「具体程度（explicitness）」是学生能否成功改对的决定性因素**——「Consider revising this sentence」这类只提出模糊补救方案的反馈，比具体反馈难被转化为成功修改（[ERIC 全文](https://files.eric.ed.gov/fulltext/EJ1323912.pdf)）【单项研究·本领域高被引】。这条是整份报告里最可操作的一条：**套话的反义词不是更长，而是更具体**。中文语境的证据指向同一处——人民网调查指出 AI 作文批改的评分标准不透明、「模板化空话反而容易得高分」、学生「童真化表达」常被误判（[人民网《AI批改作文，什么评分标准？》](http://society.people.com.cn/n1/2026/0708/c428181-40756035.html)）【主流媒体报道】；另有报道记录一名四年级学生读完 AI 生成评语后「感觉很失落，觉得老师根本不在乎他」，以及学生摸清打分套路后批量产出「流水线范文」（[网易新闻](https://c.m.163.com/news/a/J7T2TIJT0516PMLP.html)）【媒体报道】。

但本产品的套话感有一半不是模型写的，是代码写的。截至本轮核查（仓库 HEAD 实测）：`lib/ai/calibration.js:93-127` 的 `addBlueRefinements`/`ensureAnnotationsByScore` 在分数 ≥4.5 且没有蓝标时**凭空注入硬编码英文**「Can be refined for smoother flow and more precise expression.」并落在原文第一句够 10 字符的位置，与句子内容无关；`lib/ai/parse.js:213-220` 在短板卡任一字段不含中文时，把整段替换成固定三句（「语言与任务表达可提升 / 该问题会直接影响任务完成度和语言准确性…… / 先按逐句批注改写，再重写一版完整答案……」）；`parse.js:91` 的 `parseDimensionScore` 正则只抓数字，**模型每次都写的三维度一句话理由被丢弃**，而 `rubric` 对象在 `components/` 下零引用；`===ERRORS===` 段（模型对「哪些错妨碍理解 / 哪些是系统性失控」的逐条判定，正是用户最想看的「深」）留在 `sections.ERRORS` 里，前端从不读取；`lib/postWritingPractice.js` 头注写明「Post-writing spelling drill extraction」——**写后练习只抽拼写**。这意味着一件很难受的事：最容易被感知为套话的那几段文字，模型其实已经生成了更好的版本，是链路把它扔了或换掉了。

这也解释了为什么「加长报告」不是解法。Scherer, Graham & Busse (2026) 专门区分表层与深层结果的元分析发现，算法反馈对两者在后测上都**只有小效应**，**表层效应在维持测上消失**，对新写作任务的迁移效应也很小（[ScienceDirect](https://www.sciencedirect.com/science/article/pii/S107529352600022X)）【元分析·二手摘录】；Fleckenstein 等 (2023) 对 20 项 AWE 研究、2,800 名学生的多层元分析给出 **Hedges' g = 0.55**（约 7 个百分位点），同时建议自动反馈必须与其他支持形式结合（[Frontiers](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2023.1162454/full)）【元分析·二手摘录】。把这些和 Graham/Harris/Hebert 的 0.38 放在一起，结论很清楚：**AI 报告本身的信息量不是瓶颈，学生是否动手才是**。

---

## 官方满分样文一个同学都没提：把「必须回应同学」降级为加分路径

两份笔记在这里直接冲突，需要裁决。`toefl_rubric_expert_practice.md` 引了一条机构转述的规则——「Responses that don't reference the other students' points typically score 3 or below, even with excellent grammar」——并把它标为可信度较高，还建议做成报告里的硬性红线检测项。但笔记本身也注明：这条**未能定位到具体原始页面**，只是一批 WebSearch 摘要里的句子，没有可点击来源。

一手证据指向相反方向。`data/writingScoring/etsGoldenSamples.json` 里的 `ets-disc-5-airplane` 是 ETS 官方视频公布的满分样文，全文从头到尾**没有提到 Paul 或 Claire 任何一个字**，官方评语是 *relevant and clearly expressed with good elaboration*，给 5.0。另一篇满分样文 `ets-disc-5-vaccine` 同样没有点名回应任何同学。ETS 官方对该题型的说明也只讲评分员关注 *relevant and clearly developed ideas / variety in the use of language / correct use of language*，以及 *ideas that contribute to the discussion*（[ETS Writing for an Academic Discussion Task Transcript](https://www.ets.org/toefl/transcript/writing-for-an-academic-discussion-task.html)，页面本身被代理拦截，经摘要转述）【官方来源·二手转述】，官方措辞是考生 *may* 引用他人帖子。本产品的 prompt 也已经按这个口径编码：「官方规则：引用或回应其他学生的观点是『可选的加分方式』……**禁止因『没有回应他人观点』而压分**」（`lib/ai/prompts/academicWriting.js`）。

**裁决：以官方一手证据为准。「必须回应同学」是备考行业的流传说法，不是 ETS 规则，不得做成硬性扣分项或红线检测。** 这对报告设计有三个具体含义。第一，Discussion 的任务硬闸应该检测的是「立场是否明确 / 是否有实质展开 / 是否是自己的贡献而非复述教授和同学」这三件事（产品 `===SIGNALS===` 里的 `stance_clear`/`has_example`/`engages_discussion` 已经在生成，正好对应），而不是「是否点名了同学」。第二，「点名让步再反驳」仍然值得保留，但位置在**加分路径提示**里——机构指南里那几条具体动作（先承认对方最强的一点再反驳、把两位同学都带进讨论）对追求 5 分的用户是有效的写法建议（[Magoosh 系列指南](https://magoosh.com/toefl/toefl-academic-discussion/)，摘要转述）【机构二手·未核原文】，但它是「怎么让讨论感更真」的技巧，不是「不这么写就扣分」的规则。第三，也是最紧急的：`academicWriting.js` 的 PATTERNS 闭集里**至今仍保留「未回应他人观点」这个标签**，而同一份 prompt 的上方明令不得因此压分——这个自相矛盾会诱导模型把一个不扣分的事项报成本篇的主要短板，正是「答非所问」式套话的一个现成来源，应当直接删掉。

同源的教训还有一条：机构材料反复说「2026 新 rubric 对模板化识别更强，不建议重度依赖背诵模板」【机构二手·未核原文】。而本产品的 prompt 里写着「短板行动卡……**包含可直接使用的句型/词汇/模板**」——这是在点名要模板。如果这条属实，报告正在教用户一种会被 rubric 惩罚的写法；即便不属实，「给模板」也和 Ranalli 的结论冲突：可套用的句型天然是通用的，而通用就是套话。

---

## 报告蓝图：八个板块，从自评开始、以一次改写结束

下面按**呈现顺序**给出蓝图。每个板块先讲设计理由与证据，板块末尾统一汇总成表。贯穿全篇的三条总原则先说清楚：**①每条反馈必须能回指考生自己写的某一句**（这是人工批改与 AI 批改在用户认知里的分水岭，Test Resources 这类人工服务的核心卖点就是 line-by-line corrections，[toeflresources.com](https://www.toeflresources.com/writing-section/toefl-essay-evaluation-and-scoring/)【机构页·二手摘要】）；**②一次只深挖一个教学点，其余降级为清单**（Graham & Perin 2007 的 Writing Next 元分析里效应量最高的干预全是聚焦单一可迁移技能：策略教学 **0.82**、总结 **0.82**、同伴协助 **0.75**、产品目标设定 **0.70**，而宽泛的过程写作法只有 **0.32**，[Carnegie 完整报告](https://media.carnegie.org/filer_public/3c/f5/3cf58727-34f4-4140-a014-723a00ac56f7/ccny_report_2007_writing.pdf)）【元分析】；**③报告的终点是一个动作，不是一段文字**（Carless & Boud 2018 反馈素养四要素的最后一条就是 taking action——「除非评语真正被采纳，否则反馈的价值微乎其微」，[Assessment & Evaluation in Higher Education](https://www.tandfonline.com/doi/full/10.1080/02602938.2018.1463354)）【理论框架】。

### 板块 0 · 开场自评（15 秒，可跳过，在分数揭晓之前）

**给**：一个极轻量的选择题——「你觉得这篇最可能被扣分的地方是？A 论证展开不够 / B 语言错误 / C 任务要求没答全 / D 说不好」，外加一个可选的分数预测。提交后立刻进入报告，**并在总评里回写一句「你自己猜的是 A，AI 判的是 C，差在这里」**。**不给**：长问卷、强制填写、任何阻塞式表单。

**为什么**：Nicol 的内部反馈理论认为学习价值来自学生把自己的作品与参照物做**有意识比较并把结果显式表达出来**，「显式化」是关键（[THE Campus](https://www.timeshighereducation.com/campus/guide-learning-activating-students-inner-feedback)）【理论框架/专家意见】；Andrade & Valtcheva (2009) 的标准参照自评综述显示对照明确标准自评并据此修改能提升写作表现（[SUNY Albany 存档](https://scholarsarchive.library.albany.edu/cgi/viewcontent.cgi?article=1012&context=etap_fac_scholar)）【综述】。量级上的理由更硬：自评反馈效应量 0.62 vs 自动化反馈 0.38（同上 Carnegie 2011）【元分析】——**在 AI 报告前面挂一个自评，等于把一个更高效应量的干预免费嫁接到一个更低效应量的干预上**。还有一条值得注意：用 exemplar 做对照的学生产出更多「高阶、过程导向」的自我评语，用抽象评分标准做对照的产出更多任务相关评语，而**高阶过程性评语与最终成绩正相关**（[tandfonline](https://doi.org/10.1080/02602938.2026.2644513)）【单项研究】，所以自评提示词应当往「我的论证在哪一步停了」而不是「我少写了 20 词」引导。

**证据强度**：中（机制有元分析与理论支持；「批改前自评」这一具体动作本身没有直接对照实验，笔记明确标为间接推论）。

### 板块 1 · 分数区：给分数，但不让它当视觉主角

**给**：0–5 分与 6 分制换算、band 名，**以及三个维度分（任务完成 / 组织连贯 / 语言使用）各配一句本篇专属理由**（模型已经在写，例如「任务完成 5：三个目标均完成且有细节」「语言使用 3.5：局部小错较多但均不影响理解」）；再给一句「上一档需要什么」。**不给**：与其他用户的排名/百分位；不给一个占满首屏、字号最大的孤零零数字；不给任何「整体不错」类评价。

**为什么**：Butler (1988) 把 132 名五六年级学生随机分入「自我评价式数字分数」「任务评价式个别化评语」「两者都给」三种条件，结果是只给评语组表现最好、只给分数组没有提升，而**「分数+评语」组和「只给分数」组效果相似，同样抑制了兴趣与表现**（[BJEP 摘要](https://bpspsychub.onlinelibrary.wiley.com/doi/abs/10.1111/j.2044-8279.1988.tb00874.x)；条件设计与结果转述见 [Kappan/Guskey](https://kappanonline.org/grades-versus-comments-research-student-feedback-guskey/)）【经典单项实验·二手转述，原文未核】。Kluger & DeNisi (1996) 对 607 个效应量、23,663 个观测的元分析给出平均 **d = 0.41**，但**超过三分之一的反馈干预反而降低了绩效**，机制是注意力被从任务层引向「自我」层（[Psychological Bulletin 119(2)](https://cris.huji.ac.il/en/publications/the-effects-of-feedback-interventions-on-performance-a-historical/)）【元分析】。备考用户对分数有刚需，不能不给；但排名式、ego-involving 的呈现正是 Butler 实验里效果最差的那一条件。三维度分之所以必须补上，还有一个额外理由：人民网对国内 AI 批改产品的调查显示「评分标准不透明」已经是媒体重点追问、教育部专门发文划线的敏感议题（同上人民网报道）【主流媒体报道】，让用户看见「分数由哪三块构成、每块为什么是这个分」既是体验也是合规方向。

**证据强度**：中高（Butler 被多来源一致转述，但原文未核；Kluger & DeNisi 为元分析）。

### 板块 2 · 总评：三句话，回答三个问题

**给**：固定三句。第一句 Feed Up——用本题型分档语言说明目标档位的标准是什么（「5 分要求每个目标都有细节展开，不是提到就行」）；第二句 Feed Back——**引用本篇一句原文**，说明现在停在哪（「你写到 *One light bulb could use for several years* 就结束了，这是『它更好』，不是『它为什么最重要』」）；第三句 Feed Forward——下一步最该动的那一件事。**不给**：任何自我层评价（「整体不错」「继续加油」）；不给表扬-批评-表扬的三明治；不给「一句话」的长度上限。

**为什么**：Hattie & Timperley (2007) 的框架要求反馈同时回答 Where am I going / How am I going / Where to next，并把反馈分为任务、过程、自我调节、自我四层，其中**指向「自我」的泛泛表扬效果最差**，因为信息量太低、太易被自我概念稀释（[ScienceDirect 回顾文](https://www.sciencedirect.com/science/article/abs/pii/S0959475222001396)；层级模型转述见 [Family Medicine 2025](https://journals.stfm.org/familymedicine/2025/july-august/lee-0441/)）【理论框架·被广泛验证，原文未核】。这个框架是目前**唯一有实证支持且被两项独立 LLM 研究复用**的报告骨架：Meyer et al. (2024) 用 feed up/back/forward 三要素定制提示词生成的 ChatGPT 反馈，让德国高中生在**本篇修订上显著优于对照组**（但未迁移到新任务）（[ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0361476X26000214)）【单项实验·交叉一致】；Dai et al. (2023) 用同一框架评估发现 GPT-3.5 反馈可读性优于讲师但「有效性」仍逊，而**搭配「如何解读建议」的显式指导时能提升学生修订质量**（[ResearchGate](https://www.researchgate.net/publication/370228288_Can_Large_Language_Models_Provide_Feedback_to_Students_A_Case_Study_on_ChatGPT)）【单项研究】。三明治结构则证据混合且总体偏弱：有 2020 年实验支持它（[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0023969020301429)），也有贝叶斯分析发现「表扬夹心」对纠错信息的有效性**没有任何提升**，即时与两周后测均为零效应（[phys.org 报道](https://phys.org/news/2025-08-compliment-sandwich-longer-effective.html)）【证据矛盾·中低】——不宜作为结构依据。

**证据强度**：中高（框架本身理论强度高且被两项独立 LLM 实证复用；「一句话改三句」这个具体长度没有直接证据，属工程判断）。

### 板块 3 · 任务硬闸：可检测的规则做成清单，不要写成评语

**给**：Email 侧——三个 communicative goals 的逐条 OK/PARTIAL/MISSING 判定 + 每条的佐证原句 + 缺的那条**该补什么内容**（不是补什么句型）。Discussion 侧——三盏灯：立场是否明确 / 是否有实质展开（解释、例证、细节任一即可）/ 是否是自己的贡献而非复述。**不给**：不给「是否回应同学」这盏灯（见上一节裁决）；不给用文字段落描述本可以用清单表达的判定。

**为什么**：这是全报告可解释性最高的一块，也是本产品现有报告里**唯一有引文锚定、信息密度最高的板块**（Email 的 `===GOALS===`）。Email 任务的天花板不是思想深度而是完整度与得体度，多个机构来源一致指出漏掉一个要点就够不到高分档（[fluentprep 指南](https://www.fluentprep.online/blog/master-toefl-write-an-email)）【机构二手·未核原文，ETS 官方 Email rubric 逐字原文本轮未能取得】。Discussion 的三盏灯则直接对应产品 prompt 已经在输出的 `===SIGNALS===` 三个布尔值，以及官方对该题型的三项关注点。更普遍的设计理由是 rubric 锚定与条目级透明：多篇 2025–2026 会议论文提出让 LLM 按 rubric 逐项判定、给出理由、并对不同质量层级给出可执行修改，以提升反馈透明度和可操作性（[ACM DL: iRULER](https://dl.acm.org/doi/pdf/10.1145/3772318.3790539)、[Rubric-Grounded Framework](https://dl.acm.org/doi/10.1145/3806980.3807007)）【会议论文·新，缺大规模课堂验证】。

**证据强度**：Email 三点清单——中（机构来源一致但官方 rubric 未核）；Discussion 三盏灯——中高（对应官方关注点 + 产品已编码）；「可检测规则做成清单而非评语」——中（rubric 锚定属新近共识，实证检验有限）。

### 板块 4 · 本次唯一深挖点：内容层短板，指到句子、指到缺失的那一层

这是整份报告的主菜，也是当前产品最缺、最值得投入的一块。

**给**：一个短板，四段结构——(1) **命名**：用可迁移的策略名，不是本篇的具体改法（「理由展开停在『更好』，没到『为什么最重要』」优于「第 3 句要改」）；(2) **证据**：引用本篇原句，标出论证链在哪一句停止（找主张 → 逐条理由 → 每条理由用的是解释/例证/细节哪一种 → 在哪一句停下 → 缺哪一层）；(3) **补法**：说明该补什么**内容**（补一个机制、补一个具体场景、补「为什么这一点比其他选项更重要」这一层），并给一个针对本篇的示范改写；(4) **迁移**：一句「下次写作前先问自己……」。其余诊断降级为不展开的清单。**不给**：可直接套用的句型/词汇模板；「论证不充分」这类停在问题命名层的诊断；同时深挖论证、结构、语言三件事。

**为什么**：最有力的证据是官方评语本身的写法。ETS 给 4 分灯泡文的评语不是「论证不充分」，而是**「对比结构有效，但论证可更强——只说了比蜡烛好，没说为何是 200 年来最重要」**（`data/writingScoring/etsGoldenSamples.json`）【一手·官方评分员评语】。这就是「指到缺失的那一层」的范本，也正是 3.5–4.5 分用户最想知道的「为什么不是 5」的答案形态。方法论上，Ranalli 的 explicitness 结论要求反馈必须具体到可执行（同上 ERIC EJ1323912）【单项研究·高被引】；Wiggins (2012) 的七条原则里「可执行（actionable）」与「用户友好（不被信息量淹没）」两条同时约束了深度与数量（[Seven Keys to Effective Feedback](https://csaa.wested.org/resource/seven-keys-to-effective-feedback/)）【实践指南/意见】。「只深挖一个」的量化依据来自 Writing Next 的效应量排序（同上 Carnegie 2007）【元分析】与写作工作坊的 minilesson 结构——Calkins 体系每节课只教一个策略并当场示范、当场试做（[Heinemann](https://www.heinemann.com/blog/what-is-a-minilesson-and-why-is-it-mini)、[unitsofstudy.com](https://www.unitsofstudy.com/framework)）【教学法实践·K-12，无成人应试适配研究】。而「命名要可迁移」来自 Hattie & Timperley 的层级推进逻辑：反馈理想情况下应从任务层推进到过程层再到自我调节层，后两者才利于图式建构与迁移（同上 Family Medicine 2025）【理论框架】，也对应 minilesson 的 Link 环节——把当天教的策略明确定位为「今后可选用的众多工具之一」（[Two Writing Teachers](https://twowritingteachers.org/2014/08/28/minilessons-its-all-about-the-link/)）【教学法实践】。

**证据强度**：高（一手官方评语示范 + 元分析级的聚焦依据 + 高被引的 explicitness 研究三线汇聚）。唯一的证据空白是「最多几条」没有任何研究给出数字（见最后一节）。

### 板块 5 · 语言层：先按「压分/不压分」分流，再按「可治/不可治」决定讲法

**给**：两个分区。**分区 A「真正拉低分数的错」**——即模型 `===ERRORS===` 里的 ② 类（系统性语法失控或妨碍理解），逐条列出原句 + 为什么它妨碍理解或暴露语法控制缺口。**分区 B「不压分的限时小错」**——① 类（拼写滑误、标点、大小写、冠词介词滑误、代词指代），**默认折叠，只给计数和一句话**，并明确写出「官方 5 分样文也含约十处这类错误」。在每条批注的讲法上再分流：红色可治错误（时态、主谓一致、冠词、单复数）给「直接改正 + 一句规则」；橙色不可治错误（搭配、介词固定用法、用词）**直接给地道说法 + 一个可迁移的同类范例，不硬讲规则**。**不给**：按错误总数暗示水平；把拼写摆在显著位置；对不可治错误编造一条「规则」。

**为什么**：分区依据是一手的——官方 5 分 airplane 样文含约十处表面错误仍满分，官方 4 分 lightbulb 样文因基本动词形态与词类误用反复出现而封顶（同上 `etsGoldenSamples.json`）【一手·官方样文与评语】。本产品的 prompt 已经把这套两步法编码得相当细致（「判错误分两类，分界不是语法类别而是是否体现系统性失控/是否妨碍理解」，`lib/ai/prompts/academicWriting.js`），模型也每次都在输出 `===ERRORS===` 的判定推理——**只是前端从不显示**。这一块几乎是白捡的深度。讲法分流依据 Ferris 的 treatable/untreatable 框架：可治错误有规则可查，给学习者自我修正的抓手；不可治错误（介词误用、用词、搭配）没有系统规则，标一个「WC」学生猜不出该怎么改（[ERIC ED545655](https://files.eric.ed.gov/fulltext/ED545655.pdf)）【理论框架·领域共识】。Sheen (2007) 发现直接反馈叠加元语言解释的效果在语言分析能力较高的学习者身上尤其显著（[TESOL Quarterly 41](https://onlinelibrary.wiley.com/doi/abs/10.1002/j.1545-7249.2007.tb00059.x)）【单项实验】，而 Bitchener & Knoch 系列比较各种直接反馈亚型时**没有哪一种显著更优**（[ResearchGate 摘要](https://www.researchgate.net/publication/5597009)）【多项实验】——所以规则说明要短，够用即可，不必长篇。中国学习者样本也支持这个组合：多数偏好直接反馈，对元语言解释量化态度不确定但质性访谈认为「有趣、好记、能激发动机」（[Asian-Pacific Journal of Second and Foreign Language Education 2016](https://link.springer.com/article/10.1186/s40862-016-0010-y)）【单项研究·中国样本】。

关于「要不要全标」这个长期争论，证据支持分层而非取舍：Ellis et al. (2008) 的聚焦反馈组（只纠冠词一类）准确率显著高于全面反馈组（[ERIC EJ804984](https://eric.ed.gov/?id=EJ804984)）【单项实验】，但 Van Beuningen et al. (2012) 的 n=268 大样本研究显示**全面纠错同样带来显著准确性提升，且迁移到新写作任务**（[Language Learning 62(1)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-9922.2011.00674.x)）【单项研究·大样本】，一篇讨论该争论的综述直接判定「没有明确胜者」（[Humanities and Social Sciences Communications](https://www.nature.com/articles/s41599-025-05126-x)）【综述转引】。所以逐句全量标注保留，但必须和「本次该优先改的」在视觉上分层。Kang & Han (2015) 的元分析给出 WCF 总体效应量 **Hedges' g = 0.68**，并显示低/中低水平学习者获益最大（g = 0.982）、中级水平获益最小（g = 0.364）（[TESL-EJ 综述转引](https://tesl-ej.org/wordpress/issues/volume24/ej95/ej95a3/)）【元分析·**数字未核实一手来源**】——如果这个分层属实，它还暗示中间档用户正是最需要内容层而非语言层反馈的人群，与本产品「3.5–4.5 分用户最爱抱怨」的推断吻合。

**证据强度**：分区 A/B——高（ETS 官方样文一手）；可治/不可治讲法分流——中高（Ferris 框架为领域共识，但缺少直接量化两种讲法效应量差异的对照实验）；全量保留——中（两项高质量单项研究互相抵消，争论无定论）。

### 板块 6 · 范文：做成比较任务，不做成展示品

**给**：三个固定对比维度（立场与贡献 / 展开方式 / 语言），每个维度并排「你的第 X 句 / 范文对应处理 / 差在哪一层」，并用一句引导语把注意力钉在本次深挖点对应的结构或论证差异上；明确标注「这只是众多可行写法之一」；优先呈现**比用户当前水平高约半档**的版本，而不是永远的顶格满分文。**不给**：整篇范文让用户自己读；「Official Band 5.0 Sample」这种名不副实的标签；纯词汇层面的对比点。

**为什么**：model text 作为 L2 写作反馈的标准范式是三阶段 composing → comparing → rewriting，其有效机制是让学习者**注意到自己产出与目标语言之间的落差（noticing the gap）**，需要主动识别、归纳并重构；仅阅读不比较不重写，noticing 效果会打折；该效果一周后仍可维持；而且有一个对本产品致命的发现——**学习者在比较阶段主要注意到的是词汇层面差异，对语法、内容、篇章组织层面的差异注意较少**，除非给「引导式注意（guided noticing）」任务（[PubMed 37457062](https://pubmed.ncbi.nlm.nih.gov/37457062/)、[系统综述](https://www.researchgate.net/publication/385250104_Model_texts_as_a_feedback_instrument_in_second_language_writing_A_systematic_review)）【系统综述+单项研究】。这就是为什么「贴一篇范文」在体感上等于没给：**学生会自动滑向换词，错过你真正想教的论证结构**。Schwartz & Bransford (1998) 的三个课堂实验进一步说明比较的价值：先分析对照案例再听讲的大学生，一周后能把概念**迁移到新问题**，优于「先讲后练」或「只给单一案例」（[Stanford PDF](http://aaalab.stanford.edu/assets/papers/earlier/A_time_for_telling.pdf)）【多项课堂实验】。To & Carless (2016) 的两轮行动研究则发现，单纯分享范文只能澄清评估期望，**是同伴讨论与教师中介式反馈才促成策略的正向迁移**（[ERIC EJ1109468](https://eric.ed.gov/?id=EJ1109468)）【行动研究/质性】；Handley & Williams (2011) 的带标注范文使用率达 **73%**，标题本身就是警告——*From Copying to Learning*（[ERIC EJ908660](https://eric.ed.gov/?id=EJ908660)）【单项研究】。

「不要永远给顶格范文」有独立依据：学生通常不会被同伴的杰出作品激励，接触真正卓越的作品并当作参照点时容易觉得「我做不到」，动机下降；当技能对学习者是全新的时候最容易被打击，此时一个「典型」样例甚至一个弱样例在教学效果上可能与顶尖范文相当却不伤信心，常见误区正是「几乎只用顶尖范文」（[Inquiry By Design](https://www.inquirybydesign.com/using-student-exemplars-a-caution)）【专家意见·无量化】。对一天写多篇的高频用户，这个风险是累积的。同时 Sweller 的 worked-example effect 与 Kyun, Kalyuga & Sweller (2013) 在英语论说文写作这类高元素交互性任务上的验证说明，新手阶段应多给**分步讲解式的样例**而非成品（[worked-example effect 综述](https://en.wikipedia.org/wiki/Worked-example_effect)、[相关综述](https://www.tandfonline.com/doi/full/10.1080/01443410.2023.2273762)）【经典理论+单项实验，效应量未取得】；expertise reversal effect 则提示随用户水平上升讲解密度应当下调——这给出了一个按历史表现动态调整范文呈现方式的产品方向。

**证据强度**：中高（model-text 三阶段与 noticing 机制由系统综述支持，「词汇层偏移」这一发现对设计有直接约束；「范文过好」一条仅为专家意见，且应试场景无直接研究）。

### 板块 7 · 下一步：一次真动手的仿改 + 三条自查 + 一个策略名

**给**：一道针对本次深挖点的仿改任务（「把你的第 3 句展开成两句：补一个机制或一个具体场景，说明为什么这一点比其他选项更重要」——题面用本篇原句，不是新题）；三条自查清单让学生判断自己改对没有；一句可迁移的策略名，并在下一次写作前复现这句提示。**不给**：拼写填空；「下次继续加油」；需要重写整篇的重任务。

**为什么**：这是全报告效应量最可能被撬动的地方。Lalande (1982) 发现接受间接反馈、需要自己用错误代码判断并改正的组，写作准确率提升**显著优于教师直接改正组**（[Modern Language Journal](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-4781.1982.tb06973.x)）【经典单项研究·二手转述结论方向】；Ferris & Roberts (2001) 对 72 名 ESL 学生的实验显示两个有反馈组的自我修改都显著优于无反馈组，而**有代码组与无代码组无显著差异**——说明「分类标签」本身不是决定因素，学生有没有动手处理才是（[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S106037430100039X)、[ERIC EJ632782](https://eric.ed.gov/?id=EJ632782)）【单项实验】；Ekanayaka & Ellis (2020) 发现要求学习者修订确实为 WCF 带来额外增益，**但这种加成在第三个难度更高的任务上消失**（[System 94](https://www.sciencedirect.com/science/article/abs/pii/S0346251X20307016)）【单项研究】——意味着一次改写不能一劳永逸，需要跨篇复现。

最能直接否定当前「拼写填空」设计的是论证性写作修订的研究：收到针对性反馈的作文组 Evidence 分数从第一稿 **M=2.33** 提升到第二稿 **M=2.64（p=0.02）**，而且**「增加证据/推理」类修订与分数提升相关，「删除」或「修改措辞」类修订与分数提升无明显相关**（[arXiv 2107.06990](https://arxiv.org/pdf/2107.06990)、[eRevise](https://arxiv.org/pdf/1908.01992)）【单项研究】。拼写填空按定义属于表面文字修订那一类。Writing Next 的效应量排序也指向同一处：策略教学 0.82，而泛化的「多写多改」只有 0.32（同上 Carnegie 2007）【元分析】。产品侧可参照的形态有 Cambridge Write & Improve——明确不给标准答案，只标出需要注意的区域和原因，鼓励学生自己修订并提交新版本，配历史进度图（[Write & Improve Help Center](https://help.writeandimprove.com/en/articles/1104369-how-does-write-improve-work)）【官方文档·二手摘要】；以及 Khanmigo 的「引导式带学生走一遍修订流程」而非一次性甩出完整报告（[Khanmigo Writing Coach](https://www.khanmigo.ai/writingcoach)）【官方页·二手摘要】。

**证据强度**：中高（三项独立研究方向一致，且 eRevise 给出了「哪类修订才有效」的直接证据）；「下一步任务的最佳形态」本身仍缺直接验证（见最后一节）。

### 板块 8 · 跨篇：策略清单与错误规律的轻量复现

**给**：把历次深挖点攒成一份用户自己的「策略清单」，在下一次写作的**作答前**显示一条；错误规律里的离散语言点（搭配、句型、固定错误模式）可以进复习队列。**不给**：把间隔重复包装成「练完这些就能写好文章」的承诺；跨篇的长篇学习路径规划。

**为什么**：Calkins minilesson 的 Link 环节正是把单点教学转化为可迁移策略库的步骤（同上 Two Writing Teachers）【教学法实践】。但必须克制：提取练习与间隔重复对**知识保持**证据非常扎实（[Nature Reviews Psychology](https://www.nature.com/articles/s44159-022-00089-1)）【综述·高】，而笔记在多轮检索后**未能找到任何证明它迁移到篇章级写作能力的研究**——写作是在新语境里重新组织语言完成交流目的，与「记住一个答案再提取」不同构。所以错题本/FSRS 类机制应当定位在离散语言点巩固，不能等同于写作能力提升。

**证据强度**：低（合理推断，无直接验证；且存在明确的证据空白）。

### 蓝图汇总

| # | 板块 | 给什么 | 不给什么 | 主要证据 | 强度 |
|---|---|---|---|---|---|
| 0 | 开场自评 | 一个 15 秒单选 + 可选分数预测；报告里回写「你猜的 vs AI 判的」 | 长问卷、强制、阻塞 | 自评 0.62 vs 自动化 0.38（Carnegie 2011）；Nicol 内部反馈 | 中 |
| 1 | 分数区 | 总分 + band + **三维度分及各一句本篇理由** + 「上一档差什么」 | 排名/百分位；孤立大数字；「整体不错」 | Butler 1988；Kluger & DeNisi d=0.41、1/3 反效果 | 中高 |
| 2 | 总评 | 三句：目标标准 / 引原句说停在哪 / 下一步一件事 | 自我层表扬；三明治结构；一句话上限 | Hattie & Timperley；Meyer 2024、Dai 2023 复用验证 | 中高 |
| 3 | 任务硬闸 | Email 三点 OK/PARTIAL/MISSING + 原句 + 补什么内容；Discussion 立场/展开/贡献三盏灯 | 「是否回应同学」这盏灯；把清单写成散文 | ETS 官方样文与任务说明；产品 SIGNALS 已产出；rubric 锚定文献 | 中～中高 |
| 4 | 唯一深挖点 | 策略名 + 原句证据 + 缺哪一层 + 本篇示范改写 + 一句迁移提示 | 可套句型/模板；停在「论证不充分」；同时深挖三件事 | ETS 4 分评语一手示范；Writing Next 0.82；Ranalli explicitness | 高 |
| 5 | 语言层 | 「压分的错」展开 / 「不压分的小错」折叠计数；可治给规则、不可治给地道说法+范例 | 按错误数量暗示水平；给不可治错误编规则 | ETS 5 分样文含约十处滑误仍满分；Ferris treatable/untreatable；Sheen 2007 | 高～中高 |
| 6 | 范文 | 三维度并排对照 + 引导语钉住结构差异 + 「众多写法之一」+ 高半档而非顶格 | 整篇展示；假的 Official 标签；纯换词对比 | model-text 三阶段与 noticing；学习者只注意词汇层；Schwartz & Bransford 迁移 | 中高 |
| 7 | 下一步 | 一道本篇原句的仿改 + 三条自查 + 策略名 | 拼写填空；空泛鼓励；整篇重写 | Lalande 1982；Ferris & Roberts 2001；eRevise 2.33→2.64 p=0.02 | 中高 |
| 8 | 跨篇 | 个人策略清单；离散语言点进复习队列 | 把间隔重复包装成写作能力提升 | Calkins Link；间隔重复对知识保持有效但写作迁移无证据 | 低 |

---

## 当前产品与蓝图的差距：多数不是模型问题，是链路问题

下表按修复成本排序。**「代码」类差距不需要改 prompt、不触碰评分路径，模型已经生成了所需内容**；「prompt」类需要重跑评分闸门（`docs/eval-spec/writing-scoring.md` 规定改 `academicWriting.js`/`parse.js`/`calibration.js` 均需跑 scoring-gate）。

| 蓝图要求 | 当前状态（HEAD 实测） | 差距性质 | 位置 |
|---|---|---|---|
| 分数不当视觉主角、三维度分可见 | 分数在报告头部首屏；三维度分数被解析但前端零引用，**一句话理由被正则直接丢弃** | 代码（白拿的深度） | `lib/ai/parse.js:91-109`；`components/writing/WritingFeedbackPanel.js` 头部 |
| 「压分的错 / 不压分的小错」分区显示 | 模型每次输出 `===ERRORS===` 的逐条判定，**前端从不读取**；用户只看到不分主次的红橙蓝 | 代码（白拿的深度） | `lib/ai/parse.js` sections.ERRORS；`components/` 零引用 |
| 高分报告宁可少而真 | `ensureAnnotationsByScore` 在 ≥4.5 分且无蓝标时**注入硬编码英文**「Can be refined for smoother flow…」，落点与句意无关 | 代码（**正在生产套话**） | `lib/ai/calibration.js:93-127, 389` |
| 短板卡必须是本篇专属 | 任一字段不含中文即整段替换为固定三句万能文案 | 代码（**正在生产套话**） | `lib/ai/parse.js:213-220` |
| 范文标签诚实 | UI 硬编码 `Official Band 5.0 Sample`，实为 DeepSeek 每次现写；`data/academicWriting/sample_answers.json` 的 60 篇范文评分链路完全没用 | 代码（信任风险） | `components/writing/WritingFeedbackPanel.js:299`、`components/ProgressView.js:789` |
| 写后练习做仿改 | `lib/postWritingPractice.js` 只从报告抽拼写做填空，而 prompt 明说拼写不压分 | 代码 + 产品 | `lib/postWritingPractice.js` |
| 不把「未回应同学」当短板 | prompt 正文已明令不得因此压分，但 **PATTERNS 闭集里仍保留「未回应他人观点」标签** | prompt（自相矛盾） | `lib/ai/prompts/academicWriting.js` PATTERNS 列表 |
| 短板卡给内容不给模板 | prompt 原文「短板行动卡必须……包含可直接使用的句型/词汇/模板」 | prompt | 两份 prompt 的「输出要求」段 |
| 内容层短板可以进 ACTION | 「ANNOTATION 是唯一事实来源」+「ACTION 每条必须能在 ANNOTATION 找到对应原句」，而三色定义全是语言层——**「论证停在哪一句」无色可标，因而被规则挡在 ACTION 之外** | prompt（结构性） | 两份 prompt 的「板块一致性强约束」段 |
| 总评三句 | prompt 限定「总评：[一句话，直接点出最核心的问题]」 | prompt | 两份 prompt 的 `===SCORE===` 格式段 |
| prompt 里要有「怎么诊断论证」的方法 | 判分规则占 prompt 约 74%，反馈指令约 9%，**零行论证诊断方法**；`MAX_SYSTEM_CHARS=12000`，讨论 prompt 已用 10,887 字符，只剩约 1,100 | prompt（需先腾空间） | `lib/ai/prompts/*.js`；`app/api/ai/route.js` |
| 报告以一次动手结束 | 无自评、无仿改、无自查清单；报告是只读诊断书 | 产品（新增） | — |
| 范文做成比较任务 | `===COMPARISON===` 无固定对比维度、无引导语，差异栏容易写成「范文更具体」 | prompt + 产品 | 两份 prompt 的 COMPARISON 段 |
| 反馈质量有度量 | 六条验收线与 scoring-gate **全部只量分数**，报告文本从未被度量、未留样 | 流程（无闸门） | `docs/eval-spec/writing-scoring.md`、`scripts/scoring-gate.mjs` |

一个判断：**上半张表（代码类）加起来能拿走绝大部分「套话」体感，且不触碰评分路径。** 模型已经写出了三维度理由、`===ERRORS===` 的严重度判定、以及多份采样的完整诊断，链路把它们丢了；把这些渲染出来，再删掉两处注入，报告的信息密度会立刻上一个台阶，而风险接近零。下半张表（prompt 类）才是真正把报告变成一节课的部分，但它需要先在 prompt 里腾出空间，并且必须与评分闸门一起回归。

还有一个与差距表平行的风险项值得单独记一笔：Stanford 2026 年的研究把约 600 篇中学生作文每篇提交给模型 13 次、每次附加不同的人口统计学描述，发现**AI 对同一篇作文的反馈语气会随所标注的学生身份系统性变化**（被标为黑人学生的作文获得更多表扬，被标为白人学生的获得更尖锐批评），多家机构报道并被 OECD.AI 事件库登记（[EdWeek](https://www.edweek.org/technology/ai-changes-its-feedback-on-students-writing-when-it-knows-their-race-gender/2026/06)、[OECD.AI](https://oecd.ai/en/incidents/2026-04-27-b490)）【多家媒体交叉·原论文未读】。如果未来要按蓝图做「个体化」（把用户历史错题规律喂进 prompt），需要先做一次「匿名 vs 携带历史」的语气漂移对照测试。

---

## 还没有证据的地方：五个必须用自有数据回答的问题

文献能给的到此为止。以下五项是笔记里被明确标为空白、或与本产品场景存在情境断裂的问题，只能用自有数据回答。它们也构成蓝图上线后的验证计划。

**第一，「一次给几条」没有任何研究能给出数字。** 笔记在多轮检索后明确未找到任何研究给出「每篇 N 词的文章标 M 处错误」这类可套用的上限；现有的「量」的证据全部在**错误类型数**层面（聚焦 1–2 类 vs 全部类别），而不是标注处数。把「聚焦反馈更好」翻译成「每篇只标 3 处」是过度引申。产品若需要阈值，必须用自家 A/B 或后续错误复发率数据确定，**不能对外宣称有研究依据**。

**第二，谁在抱怨套话，需要数据坐实。** 前一轮的代码级诊断推断受害最重的是 4.5–5 分用户（红橙标注本来就少，剩下的是一句话总评 + 注入的英文蓝标 + 现写范文）。这可以直接度量：取 `sessions` 表最近 300 条 discussion/email、按分段各抽 ~30 份，统计注入蓝标率（`message` 等于那句英文的占比）、兜底短板率（`title` 含「语言与任务表达可提升」）、总评去重率、ACTION 标题去重率、PATTERNS 十标签的集中度、行动里出现「句型/模板/可以使用」的占比、范文截断率。再把 `user_feedback` 里含「套话/不深入/没用/敷衍」的 user_code 对回他们那几份报告的分段与指标。**这一步是所有后续改动的基线，成本极低，应当先做。**

**第三，自评环节是否真的有增益，必须自测。** 笔记明确指出：没有找到直接对照实验证明「批改前预测/自评」这一具体动作相对「批改后自评」或「不自评」的因果增益；检索到的都是自评准确度或自评对照物类型的研究。A/B 设计：有自评 vs 无自评，因变量是下一篇同题型的同类短板复发率（而非满意度自评——中国学习者研究里出现过「量化态度不确定但质性正面」的分裂，说明量表低估了元语言解释的实际价值）。

**第四，「批改 → 单一目标微练习 → 下一篇」这个闭环形态没有任何已发表验证。** 笔记如实标注：这是刻意练习理论与 minilesson Link 环节推导出的方向，不是被验证过的产品模式。建议小范围 A/B：仿改任务 vs 现有拼写填空，因变量同样是下一篇的同类短板复发率与完成率。eRevise 的证据（只有实质性增补类修订与提分相关）给了这个假设一个先验，但那是课堂论证写作，不是 TOEFL 限时短文。

**第五，整条证据链在 TOEFL 场景上都存在情境断裂。** 笔记反复标注同一个空白：没有找到针对 TOEFL 学术讨论帖/邮件这类限时短文体裁的 AWE/LLM 反馈效果研究；没有找到针对中国 TOEFL 考生的书面 WCF 偏好研究；没有找到应试写作场景下「范文过好打击信心」的实证；写作工作坊的 minilesson 结构证据基础是 K-12 课堂，没有成人应试适配研究；认知负荷证据全部来自传统人工批改情境。同时 ETS 官方 Email rubric 的逐字原文本轮**未能取得**，Discussion rubric 的各档措辞也只有「疑似逐字」的二手拼合。两件事因此变得重要：**在一个不受代理限制的环境里把 ETS 官方 rubric PDF 和官方带评语样文（尤其 Email）补齐**，以及**把自家真实报告 + 用户行为数据当作这块领域唯一对口的证据来源来经营**——目前没有任何论文能替产品回答「中国 TOEFL 考生读到什么样的批改会真的动手改」。

最后一个必须诚实对待的前提：WCF 整体是否有效至今没有盖棺定论。Truscott (2007) 的元分析报告纠错对准确性的总体效应量为 **-0.155**（很小的负效应）（[JSLW](https://www.sciencedirect.com/science/article/abs/pii/S1060374307000355)）【元分析·论战一方本人所做】，他本人在 2021 年的访谈中**仍未被后续实证说服**（[Asian-Pacific Journal 2021](https://link.springer.com/article/10.1186/s40862-021-00110-9)）【访谈】。学界较诚实的共识是「聚焦 + 直接 + 针对可治错误 + 配合修订」这一组合有较强证据支持，而不是「AI 批改一定让你进步」。产品文案应当照此措辞。

---

## 结论

这轮研究改变了一个判断：**「像套话」不是模型能力问题，而是信息被三道关卡逐层削薄的结果**——prompt 用「ANNOTATION 是唯一事实来源 + 必须给模板」把短板卡锁死在语言表层，解析层把三维度理由与错误严重度判定直接丢弃，校准层再往高分报告里注入一句与内容无关的英文。模型其实每次都在写出比用户看到的更深的东西。这意味着第一批改动应该是减法和渲染，不是让模型写更多字。

更深一层的结论是，报告的终点必须从文字挪到动作。自动化反馈的基线效应量 0.38、自我评价 0.62、教师反馈 0.87 这组数字画出了 AI 批改的天花板和唯一的翻越路径：在报告前面挂一个 15 秒自评，在报告后面挂一道针对本次教学点的仿改，等于把两个更高效应量的干预免费接到一个较低效应量的干预两端。而 ETS 官方评语——「只说了比蜡烛好，没说为什么是 200 年来最重要」——已经把内容层反馈该长什么样示范完了：指着论证链停下的那一句，说出缺的是哪一层。产品目前离这个示范的距离，不在模型，在那几行代码和那几句 prompt 约束里。
