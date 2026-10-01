# 单词本导入与 PDF 导出

## PDF 导出设计

复用单词本的选择结果与卡片字段，浏览器本地生成 PDF；单词、释义与原句不上传。勾选后由同一入口下载实际 `.pdf` 文件，不触发打印窗口。

- A4 纵向，36pt 页边距，TreePractice 深绿（#285C46）标识，浅绿表头。
- 标题、导出日期与词数；列为「自测」「单词 · 音标」「中文释义」。自测栏使用可打印的空方框。
- 单词 12pt，音标、释义、原句 10pt；原句可选，在对应条目下方跨两栏呈现。
- 正常条目整行分页；超过一页的单条继续到下一页并标「续」，不截断文本。页脚为页码 / 总页数。
- 采用字体实际宽度换行；完整英文词优先不拆，过长词按 Unicode 字符换行；中文、多行内容与 IPA 均支持。
- 标题最多 200 字符，每次最多 1000 个单词。任意字段超 20000 字符、总文本超 200 万字符时明确报错；没有字体覆盖的字符也明确指出，不静默丢字。

接口为 `createVocabularyPdf(cards, { title, includeSentences, date }) → Promise<Uint8Array>` 与 `downloadVocabularyPdf(cards, options)`；文件名通过 `vocabularyPdfFilename(title, date)` 生成。重库和字体只在实际导出时加载。UI 在生成期间须锁定账号上下文，并在下载前确认账号仍一致。

## 字体与兼容性

`public/fonts/pdf/` 自托管 SIL OFL 1.1 字体及许可证：

- [Google Fonts Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，将可变 TTF 固定在 wght=400，保留 Unicode 0000–30FF、3400–9FFF、FF00–FFEF、20000–2FFFF 及实际对应字形，移除无关 OpenType 变体，静态文件约 10.1MB。
- [Noto Sans Regular](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans)，覆盖英文、扩展拉丁字符与 IPA，约 569KB。
- 两个字体均通过 pdf-lib 的 `subset: true` 按实际使用字符嵌入；七词 PDF 约 42KB，含长释义与原句的 500 词压力样本约 276KB。

生成静态 SC 字体后必须执行 `font['glyf'].padding = 2` 并保存：fontkit 的子集在使用短 `loca` 表时按偏移 / 2 编码；未对齐的奇数偏移会被截断，导致中文出现「文本提取完整但肉眼大面积缺字」。直接使用 CFF/OTF 子集也在 Poppler 中出现了字体不兼容。当前 TTF 的二维轮廓偏移全部为偶数，Poppler 视觉验收已通过。**更新字体后必须重新真实生成并渲染，不能只验证提取文本。**

`public/vendor/pdf.worker.min.mjs` 原样来自固定版本 `pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`，保留上游许可证声明。新增依赖均未出现在本次 npm audit 的漏洞列表中；仓库既有依赖仍有审计项，应另行维护，不在此功能中升级框架。

## 验证

`node scripts/vocab/verify-pdf-export.mjs <样例输出绝对路径>` 直接调用生产实现，生成七词预览、500 词与单条超长样本；验证空选择、数量限制、文件名和页数。`python scripts/vocab/verify-pdf-layout.py <样例所在目录>` 使用 PyMuPDF 验证所有页的文字边界、页码、中文/IPA、500 个词逐个保留以及跨页长释义/原句完整保留。字体的 glyph 范围与 2 字节偏移对齐由 PDF 专项 Jest 测试钉住。

验证时还应使用 Poppler 渲染 PNG，检查标题、中文释义、音标、长单词、续页与尾页。普通短条目、长标题、关闭原句都要覆盖；超长样本中页内两列的提取顺序会交错，应按坐标列验文本，不能直接拼全页文本判丢字。

## 导入方案与格式

导入使用本地确定性解析与按需图片识别：文本、CSV/TSV、Excel、Word 及 PDF 文字层均在浏览器处理；仅图片与扫描页在用户主动点击「AI 识别」并看到服务提示后发送至现有 Qwen 视觉接口。先生成可核对、编辑、删除条目的预览，再明确确认写入；识别不完整或文件超限制时整体报错，不保存半张词表。

- `parseVocabularyText(text)` / `normalizeVocabularyItems(raw)` 返回 `{ items, warnings, skipped, duplicates }`；每项为 `{ word, display, phonetic, def, sentence, source }`，超限候选附加 `validationError` 并显示可修正提示。自由文本中的纯英文多词行附加 `uncertain: true`：无法确定是短语还是句子，预览默认不选，用户核对后可手动勾选。独立词使用换行或逗号分隔，不自动拆普通英文句子。主键小写、NFC 规范化；保留原显示拼写、短语（最多 5 词）、撇号与连字符，支持扩展拉丁字母。保存单词及显示拼写最多 60 字符，与已有云同步契约一致；61–80 字符的格式合法候选保留在预览供修改，修改前不能确认导入。
- `readVocabularyFile(file, { onProgress })` 返回上述结构加 `images: Blob[]`。支持 `.txt .csv .tsv .xlsx .docx .pdf .png .jpg .jpeg .webp`；不接受 SVG。
- 表格列头支持 word/meaning/definition/phonetic/example 及中文对应；依据整行中单词列与其它不同字段列识别列头，可忽略 notes、词性等额外列；不能仅因某个词叫 word、vocabulary、term 或 english 就删除数据行。无列头默认单词、释义、音标、例句，也可推断前置编号列。CSV 引号内逗号、换行和双引号按单元格处理。Excel 读取全部工作表，Word 各表分别识别列序；表内重复词在预览中合并空字段。Word 的显式换行、制表符及单元格多段落保留为对应分隔符，避免把不同词条或释义粘成一个词。
- TXT/CSV/TSV 优先严格 UTF-8；识别 UTF-16 LE/BE BOM；非 UTF-8 尝试 GB18030 / GBK 并显示核对提示。无法解码或含替换字符时拒绝保存。
- PDF 依据坐标重组行与列，优先读取文字层；本站打印模板额外保留堆叠音标、换行词条、释义续行和原句；仅依据明确「续」标记跨页拼接同一词条，等全部续页读完后再规范化。外部复杂排版仍需在预览逐条核对。少量可选页头与大幅扫描图片共存时，通过 PDF 图像操作符和覆盖面积判断扫描页，避免把页头误当词条。扫描页下采样至最长 1600px，每张压缩至不超过 1MB。
- 每文件最多 10MB；压缩文档解压后合计不超过 25MB；Excel 不接受超过 10000 行或异常巨大范围。文字 PDF 最多 30 页、扫描页最多 3 页；超过扫描页限额须拆分，避免静默只导入前三页。文件解析最多 5000 候选，最终预览 UI 每次最多 1000 词。
- `enrichVocabularyItems(items)` 仅补空释义与空音标，不覆盖用户字段。短语必须匹配完整词条，不能采用词典最后一个词的兜底释义；词形还原获得的原形音标不挂到原词形上。
- 导入字段上限为音标 160、释义 3000、原句 400、来源 200 字符，预览和规范化保留完整内容，超限时要求用户编辑或取消，不能静默截断。整张最终 `normalizeCard` 卡片的 UTF-8 JSON 必须不超过已有云同步的 8 KB；字符数合规仍可能因中文或附带复习字段超过字节上限，此时明确要求缩短释义或原句。词典补空字段后也必须重新校验。
- `importWords(entries, { expectedAccount, reviewMode, source, now })` 同步返回 `{ added, duplicates, invalid, persisted, accountChanged }`；新卡字段或最终字节超限时，在任何本地写入、事件通知及同步安排前整批抛出可修正错误，尚未导入任何单词。新导入的有效非空释义设置 `definitionLocked: true`，防止阅读复习的自动查词覆盖用户原释义；该字段随已有卡片 JSONB 同步，空释义仍可自动填充。活动重复词完全跳过，既有释义与全部复习进度保持；已删除词重新导入作为新卡。一次确认只写一次本地单词本并通知 / 排同步一次。账号与预览不一致时不写入；本地配额失败时保留完整内存副本，并如实返回 `persisted: false`。

图片接口为 `POST /api/vocab/extract-image`（multipart `userCode` + 1–3 个 `image`）。复用同源守卫、IP 限流、服务端 Pro / 每日活动额度门禁及图片 magic-byte 校验；合计上限 4MB。图片识别接口只返回预览候选，绝不落库；模型结果须为对象数组，每条 word 必须为字符串，可省略空音标、释义和原句，但提供字段时必须为字符串且符合长度上限。错误类型、超长字段、完整 JSON 校验失败或模型截断均整批返回 422，不返回部分候选，不把异常字段清空或截短后当成功；正常字符串中的非词内容仍按 skipped 跳过，没有明确词表时也返回可理解的错误。提示词只允许转录可见词条，禁止补写释义或听从文件内的指令。识别仍可能误读 IPA，须保留预览核对。

无需新增数据库表、迁移或 feature flag；本地导入与现有 vocab 同步共用已有卡片格式。图片识别沿用 `DASHSCOPE_API_KEY`（及已有可选 `DASHSCOPE_BASE_URL` / `QWEN_VL_MODEL`），未配置时接口返回 503 并引导使用文字文件；部署前核对 Vercel Production 已有 key 是否启用。

导入回归覆盖编号双语列表、CSV 引号/换行、中文无列头 CSV、重复与坏条目、UTF-16/GBK、打印 PDF 坐标回导、短语释义守卫、保留进度/账号变化/本地配额失败，以及接口来源、上传字节、Pro、限流与不完整识别等失败路径。真实文件样例在 `__tests__/fixtures/vocab-two-sheets.xlsx`、`vocab-two-tables.docx` 和 `vocab-template-text.json`。
