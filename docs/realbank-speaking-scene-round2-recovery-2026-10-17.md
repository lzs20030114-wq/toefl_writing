# 真题复述配图第二轮恢复审计（2026-10-17）

本轮继续从本地其他版本、录屏和网页考试截图补缺。本地录屏、文档和网页结果已整合，仍有149句无可显示图，不能称为全库补齐。以下为本轮合入前恢复与验证记录；发布状态以对应Git提交及部署回执为准。

## 已整合来源

- 招聘会 rp0725 s15–s21：7 张原考试屏逐句高亮帧，网页来源 https://sjds.net/784959.html；账本固定原图 HTTPS 地址、SHA-256、裁框、逐句文本。
- 攀岩 rp0719 s1–s7、摄像 rp0719 s15–s21：两张来源文档内已有的完整静态图。标记 source_class=source_recall_diagram，frame_kind=unhighlighted_scene_shared_by_sentences；每场景仅给其对应七句绑定，不宣称来自 ETS 考试截图、不宣称逐句高亮。
- 鸟屋 rp0719 s23：来源文档鸟屋静态图，对应 saw slowly 句。标记同上。
- 三张静态图均直接从 7.19-国内线下/Speaking.docx 的 word/media/image1.png、image3.png、image4.png 提取，无补画、擦除或生成；只转换 WebP。

- 本地原考试屏补14帧：128a s4/s7（3.8录屏85/165秒）、32b s1–s7（4.5文档原屏）、rf0713 s4/s7（6.6文档拍屏透视矫正）、rp0830 s20（4.5）、rp0822 s19（5.23）、rp0718 s2（4.24口语PDF第1页第3张截图）。透视处理只变换几何，不生成内容；账本保留源四角和整流后裁框。

## 本地来源筛查

扫描全部 44 份文件名含 Speaking/口语的 DOCX，提取 232 张尺寸至少150×100的原嵌图，并建立37份口语PDF文本索引。索引及接触表位于 .codex-tmp/realbank/scene-round2-assets。这个计数是文档和图片来源数量，不是独立可恢复场景数。

- 8.19 图书馆：内嵌图实际与5.11原考试屏书店场景相同，不能因为放在图书馆标题下就映射；保留来源图文不符。
- 7.16/9.02档案馆、6.10在线资源：独立大图仍有源裁边、高亮截断，不放行。
- 6.29水彩、7.8面包、8.08饼干：旧 overrides 标为 vendor_drawn。前两张有独立绘图标题；饼干仅有英文物件标签，缺直接绘制声明，应描述为旧人工判断及原考试图来源未证实，不能把画风等同于已证实重绘。
- crop_repeat_scenes.py 中小于30000 bytes只置 suspect_vendor_drawn，属于筛查启发式，不是证明商家绘制的依据。

## 阶段覆盖

本轮新增36条逐句图绑定，底图无新增；同场景共用静态图计入绑定数，但不计为独立高亮帧。分母固定50组464句。

- 逐句图绑定：296/464。
- 实际有图句：315/464；仍无图：149/464。
- 底图：17/50。

| item ID | 仍无可显示图的句 ID 后缀 |
| --- | --- |
| real_repeat_518_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0610_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0622_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0629_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0708_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0716_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0808_1 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rp0704_1 | s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28, s29, s30, s31, s32, s33, s34, s35 |
| real_repeat_rp0705_1 | s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28 |
| real_repeat_rp0711_1 | s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28 |
| real_repeat_rp0718_1 | s22, s23, s24, s25, s26, s27, s28, s31, s36, s37, s38, s39, s40, s41, s42 |
| real_repeat_rp0725_1 | s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14 |
| real_repeat_rp0819_1 | s8, s9, s10, s11, s12, s13, s14, s16 |
| real_repeat_rp0830_1 | s22, s23, s24, s25, s26, s27, s28 |


## 验证

- 两批36条新增账本 dry/write 成功，再次 dry 为0新增、121条unchanged repairs。全账本本地资产SHA-1、WebP格式及尺寸校验通过。
- 主线程已运行5套测试，共69项通过：scene-repairs、repeat-scene/component、scene-image-carry、speaking-recall、encoding。来源校验覆盖旧PDF/DOCX、新视频时间/网页HTTPS、透视四点、非法协议/时间/缺少来源及幂等。
- 与当前HEAD对比，所有非图字段、旧帧及旧底图保持一致；与第二轮开始前对比，所有非 sentence_frames 字段逐项相等，260个既有帧全部保留。
- 主线程浏览器验收：真实 RepeatTask 招聘会 s15 答题态显示316×293完整图；真实 mapRealRepeatSet / pickSceneFrame / SceneImage 在390px容器中成功加载摄像945×930、温室560×620、服装首句/末句504×621图片，切换URL正确，宽度不溢出。这是390px容器验证，不等于整页移动视口验证。截图：.codex-tmp/realbank/scene-round2-local/browser-clothing.png。

## 文本核对边界

跨源对应以连续句序、相同场景物件和原考试屏题号共同确认，不把回忆转录与题库文本称为逐字完全一致。3.8有 green house 等空格/拼写问题；4.5有 cornor、associates、locations for 等转录差异；6.6有 non-fiction 的连字符差异；5.23入口服务台句的回忆转录开头残缺。题库文本未修改，账本 evidence 已采用更新后的限定表述。原始摘录在 .codex-tmp/realbank/scene-round2-local/text-evidence.json。

## 公开来源检索范围

公开检索记录见 .codex-tmp/realbank/scene-round2-web/search-summary.json。以下只描述本次已核范围，不推断互联网不存在其他来源。

- 可恢复：[招聘会原考试屏](https://sjds.net/784959.html)，七句连续对应，最后一句有 you are 缩写差异。
- ETS练习资料：[full-length 1](https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-1.pdf)为动物园，[full-length 2](https://www.ets.org/pdfs/toefl/toefl-ibt-full-length-practice-test-2.pdf)为校园健身房；[teachers 1](https://www.ets.org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-1.pdf)为迎新活动，[teachers 2](https://www.ets.org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-2.pdf)为图书借还，[teachers 3](https://www.ets.org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-3.pdf)为酒店前台，[teachers 4](https://www.ets.org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-4.pdf)为自然保护区，[teachers 5](https://www.ets.org/pdfs/toefl/toefl-ibt-teachers-resources-practice-test-5.pdf)为健身器材；未得到与剩余缺口相同的完整句序和可用原图配对。
- 只有文本：[环球教育木工/展示/瑜伽](https://beijing.gedu.org/contents/9758/379775.html)、[面包/回收/缝纽扣](https://beijing.gedu.org/contents/9758/379776.html)有连续句对应，但图片为品牌/二维码；[观鸟/缝纽扣](https://sjds.net/716342.html)检查原HTML没有相应场景图；[另一缝纫文本](https://www.landwave.cn/toefl_news/5742)句序不同，未确认可映射。

## 本次发布验证

远端9个提交已快进同步至708596b7。隔离快照 .codex-tmp/scene-round2-ship 仅包含该HEAD与本轮28个文件（23个图片资源、5个其他文件）；验证结果为358套测试、4237项测试全部通过，CI lint、typecheck、Next.js生产构建均通过。以上是代码发布前验证记录，不作为部署成功证明。

完整日志：.codex-tmp/scene-round2-ship-jest.log、.codex-tmp/scene-round2-ship-lint.log、.codex-tmp/scene-round2-ship-typecheck.log、.codex-tmp/scene-round2-ship-build.log。
