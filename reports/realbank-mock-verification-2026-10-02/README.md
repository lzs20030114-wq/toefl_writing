# 真题四科模考验收（2026-10-02）

本次用真实 Next.js 页面和 `AdaptiveExamShell`、原有题目组件完成浏览器验收。使用本地开发服务器 `127.0.0.1:3001` 和 Edge 浏览器。测试题面是固定的完整试卷快照，通过 `/api/real-mock-exam` 的浏览器桩返回；其余 `/api/*` 和所有外部域请求均被浏览器桩截断，不会写真实 Supabase、调用 AI 或播放远程音频。因此结果验证前端与客户端契约，不证明真实云端并发预留、远程音频可用或 ETS 官方等值。

可复跑命令（先启动 `npm run dev -- -p 3001`）：

```powershell
npx jest __tests__/real-mock-adaptive.test.js --runInBand
npx playwright test e2e/real-mock-adaptive.spec.js --config=.codex-tmp/real-mock-playwright.config.cjs
npx eslint components/mockExam/AdaptiveExamShell.js lib/mockExam/adaptiveCheckpoint.js lib/realMockExam/adaptiveScore.js app/reading-exam/page.js app/listening-exam/page.js e2e/real-mock-adaptive.spec.js
```

结果：纯函数与断点 7/7；真实页面浏览器 8/8；续考状态保存节流后，刷新相关浏览器用例复跑 3/3；ESLint 0 error（共用壳仍有现存警告）。

浏览器覆盖：云端组卷失败阻止开考；阅读题面在 `seen` 确认前隐藏、失败后可重试；阅读从 M1 超时进入 lower M2 再到35题计分结果，未到题不写 seen；听力从新卷 M1 超时进入 lower M2 并交卷；另一账户看不到已存断点，原账户可续考并由已答 M1 路由 upper 至结果。另用真实 CTW 题面验证已输入字母在刷新续考后仍在；用真实 RDL 题面验证选项与题组内题号在刷新续考后仍在；用真实 LCR 题面验证听力选择在刷新、重进当前材料后仍在。普通模考旧断点键和来源／账户／模板隔离由单元测试确认。两条路线的预选题型配比、20题路由分母、35题结果分母和 extra 排除也由单元测试确认。

截图：

- `reading-cloud-failure.png`：组卷失败留在原入口。
- `reading-first-seen.png`：已见确认后的阅读真题。
- `reading-seen-retry.png`：已见写入失败重试后的真题。
- `reading-lower-result.png`：阅读 lower 路线与35题原始分。
- `listening-lower-result.png`：听力从新卷经过 lower 路线的结果。
- `listening-upper-module.png`、`listening-upper-result.png`：原账户断点续考进入 upper 并交卷。
- `reading-ctw-resumed-input.png`：刷新续考后 CTW 字母仍在。
- `reading-rdl-resumed-selection.png`：刷新续考后 RDL 已选项仍在。
- `listening-lcr-resumed-choice.png`：刷新续考后 LCR 已选项仍在。

浏览器样本用短计时核对超时与材料占用。真题断点在当前题组保存输入、已选项、题组内题号和听力答题倒计时；听力刷新后从当前材料重新开始，不能精确恢复音频播放位置。真实音频播放、云端租约并发、实际真题库存资格以及手机尺寸由整体验收另行覆盖；1–6 只按站内未校准公式展示。

## 写作、口语、入口与练习记录

`e2e/real-mock-linear.spec.js` 使用真实首页、`MockExamShell`、`SpeakingExamShell`、写作任务组件及真题练习记录组件。固定组卷快照由本地 `/api/real-mock-exam` 浏览器桩提供，全部外部域与其他 `/api/*` 请求都被截断，未调用付费 AI、STT 或真实 Supabase。写作使用 10 道 BS、1 道邮件、1 道讨论题，空作文由明确未作答规则记 0 分。

浏览器用例首次运行 5/5，通过了桌面／移动四科入口与 Pro 门、BS 逐题云端已见门、写作 10+1+1 到交卷并记录、口语录音中断后阻止重显已见套，以及四科模考历史的逐题回顾。新增邮件任务计时刷新用例单独复跑 1/1：刷新后经过原有任务转场，倒计时继续使用保存的剩余时间。`__tests__/real-mock-linear.test.js` 4/4，覆盖失败任务单独重试、写作原始分 20、口语原始分 55、空作文不调用 AI 和仅按已见题统计覆盖率。

截图：`mobile-real-mock-entry.png`、`writing-bs-first-question.png`、`writing-full-result-blank-essays.png`、`writing-timer-reload.png`、`speaking-interrupted-recovery.png`、`real-mock-history-four-subjects.png`。口语任务中断不能恢复录音与逐句评分，因此界面要求重新组卷，避免重显已见套；当前录音任务没有可靠的“明确跳过”与“设备／转写失败”区分，缺分时保持成绩不可用，不将其误记为 0。真题 1–6 是本站未校准估分，未经 ETS 等值。

## 最终统一验收

2026-10-02，产品文件冻结后统一完成以下检查：

| 检查 | 结果 |
|---|---|
| 完整 Jest | 298 套 / 3,522 项全部通过 |
| 两份真题模考 Playwright 合并运行 | 14/14 通过，约 1.2 分钟 |
| 全项目 ESLint | exit 0，保留现有非阻断警告 |
| TypeScript | exit 0 |
| Next.js 14.2.35 生产构建 | exit 0，页面与新 API 均成功生成 |
| 迁移 SQL | 本地 PGlite 连续执行两次，预留、路由释放、永久已见、租约过期与权限检查通过 |
| 变更格式 | `git diff --check` 通过 |

组卷测试直接加载真实题库 mapper，检查阅读两路均 50 展示 / 35 计分、听力两路均 47 / 35、写作 10+1+1、口语 7+4；残缺题组和未配齐音频字段的套不用于模考。新增真实 Interview 跨套共享单问回归，整套指纹不同也按逐问内容及子题 ID 排除重复。后台已有页面组件测试确认四类模考可见，且与原 12 题型独立统计。

生产构建使用临时预加载配置，仅将输出目录改为 `.codex-tmp/real-mock-build` 并将构建 worker 设为 2，避开本机已有 `.next` 文件占用；产品 `next.config.js` 未改。构建期间外部 Google 字体样式下载失败，Next 跳过字体优化后构建成功。构建自动增加的临时 TypeScript include、测试结果目录和类型缓存已清理。

数据库迁移文件为 `scripts/sql/real-mock-exam.sql`，用户于 2026-10-02 确认已在 Supabase 执行成功，已登记到迁移台账，尚未推送或部署。此状态来自用户确认，尚未独立远程核验；跨设备真实预留、真实音频与录音评分链路仍需联调，本地网络桩的 14 项浏览器结果不替代这些验证。

推送前复核（2026-10-02）：已快进同步至远程 `main` 的 `c492fb19`，保留五条自动题库与监控更新；同步后完整 Jest 再次 298 套 / 3,522 项通过，生产构建、其中的 ESLint 与类型检查再次通过。本次 API 复用已在用的 Supabase 管理端配置，无新增环境变量或需手动开启的功能开关。上段“尚未推送或部署”记录的是本地验收完成时点，部署及真实链路验证需另行确认。
