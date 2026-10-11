# 日常阅读小问来源核验（2026-10-11）

本轮已恢复原复核扣下的7道日常阅读小问（其中 locker 原ID是AP、当前已归位RDL），另将3道原答案页与题文不符的小问按既有 `key_corrected` 机制恢复，并恢复 rp0822 图片材料三问，共净增13问。最终 RDL 为125篇 / 309问（原296问）。答案更正必须有原两票一致、源图核验与主线程复核，不改旧审计记录。成品沿用稳定ID，合组旧ID由别名兼容。

源根目录：`D:/桌面/【2026改后全科真题】（持续更新中）/`。以下页码均为PDF实际页，不是卷面题号。

| 成品宿主 | 原小问 | 答案 | 来源与核验依据 |
|---|---|---|---|
| real_rdl_127a_1_21 | Q21 | A | 1.27新托福真题A卷/新托福2026真题04.pdf p3；原屏同时写email和notice，正文通知安全演练，体裁词不导致题文不配 |
| real_rdl_418_1_25 | Q26 | C | 4.18新托福真题/4.18 阅读.pdf p4；complimentary refreshments在首段，free唯一对应 |
| real_rdl_310_1_28 | Q30 | C | 3.10新托福真题/3.10 阅读.pdf p6；D恢复为 Suggest that they compromise and speak on a Monday or Wednesday morning；正文可调整时间支持C |
| real_rdl_32b_1_21 | Q22 | C | 3.2新托福真题B卷/3.2 套二 阅读.pdf p2；Pets: None支持C，学生身份不能推出搬家是for school |
| real_rdl_324_1_21 | Q22 | B | 3.24新托福真题/3.24 套一 阅读.pdf p2；更灵活服务学生、职业人士和家庭，B最准确，A扩大使用人数非陈述目标 |
| real_rdl_324_1_23 | Q23 | C | 同卷p3；A原图为 by bringing their own environmentally-friendly bags to stores；Student Housing是左栏账号，被OCR串入右栏选项 |
| real_rdl_323_1_28 | Q30 | D | 3.23新托福真题/3.23 套一 阅读.pdf p9；first-come, first-served直接支持D；会员卡是入场资格，不是柜子分配优先级 |
| real_rdl_22_1_22 | Q21 | A→C | 2.2新托福真题/2026新托福真题08.pdf p2；NOTICE TO RESIDENTS住宅居民停水通知；原审计C/C |
| real_rdl_428_1_21 | Q22 | D→B | 4.28新托福真题/4.28 阅读.pdf p2；RSVP to Janet表明收报名回复；原审计B/B |
| real_rdl_510_1_22 | Q21 | D→C | 5.10新托福真题/5.10  阅读.pdf p1；要求先修ENGL101的本科生；原审计C/C |

310旧残片 `Wednesday morning` 是恢复完整选项的子串，普通字符串replace第二次会重复补前缀，因此仅对 `questions.2.options.D` 使用set；未set整组题目。324的A使用精确replace。回归检验包括真实applyReview重放、二次字节幂等、7道原键不变、3道更正旧键、异票/缺第二票/错module/错stamped拒绝。

## 当前一问、两问组覆盖

恢复3道更正题后、本轮合组前的中间快照有68个一问或两问RDL组（其中1个单问）。逐组关联原structured同来源题干与材料；除下面2处外，未发现structured中存在而全成品未覆盖的额外小问。当时2.10 Japan同材料三题拆为两问和单问组，三题均存在；最终三问已合入 `real_rdl_210_1_25`，旧ID由 alias 兼容，重新组合不计净新增。这是结构化来源覆盖核查，不是68篇新做原图逐字认证；不能据此证明源资料本身无遗漏。

1. **2.1 A M1Q28：源选项缺失，不补造。** 原文件 `2.1新托福真题A卷/2026.2.1新托福真题.pdf` p6。原屏四个圆点依次为 `meaning to`、`shared`、`described`、`finished`；第一项是题干尾部被错排成选项。structured只保留后三项。知道wrapped up表示finished不能恢复缺失的真实干扰项，当前Q29/Q30照常保留。可直接复核[原页](realbank-reading-recovery-evidence/21a-q28-page6.png)。
2. **rf0610 M1Q130：题文信息不足，继续扣留。** 原文件 `6月-排版实验中有问题反馈/6.10/Reading.docx`；议程为“Read an agenda.”之后内嵌图，XML段号59附近，题干Q30在段70、选项71–74。上午Keynote只写 Futures in Global Education及 evolving landscape of international study opportunities；A emerging technologies、B existing participation patterns、C traditional destinations、D current policies都未具体对应。下午1:30的Digital Tools不是上午Dr. Kim的keynote，不能串用。原键B及旧两票A/A保留，但均不当作充分源证据。可直接复核[原议程图](realbank-reading-recovery-evidence/rf0610-agenda.png)。

旧丢题账本的RDL盲审不一致不是全部现缺口：121c Q24的on a shoestring题已由real_rdl_424_1_23 Q24 B覆盖；223 Q21由rf0622 Q123 D覆盖；320 Q27由121b Q27 D覆盖；其余多已归位AP并由同篇题覆盖。不能按旧条数重复添加。

## rp0822：课程材料漏读图片

源文件 `8 月/8.22-国内线下/Reading.docx` 第46段内嵌课程图，后续XML第50–64段是三道题干和选项。原structured三题材料只有 `Questions / Refer to the course description on the previous page.`，没有课程正文，因此旧盲审不能作为完整题文作答证据。

已提取并视觉核验[原课程图](realbank-reading-recovery-evidence/rp0822-course-source.png)、[原文转录](realbank-reading-recovery-evidence/rp0822-course-transcript.txt)、[三题原文](realbank-reading-recovery-evidence/rp0822-questions.json)。源图明确 newly developed、narrative structure / character development / dialogue、group readings，以及完成一门Creative Writing或English的first-year-level课程。三题独立作答为A/C/B；原键亦A/C/B。恢复仅替换缺失material，不改题干选项、原键和旧审计票，新独立票绑定恢复后fullitem哈希，走正式source-repairs严格匹配接口。
