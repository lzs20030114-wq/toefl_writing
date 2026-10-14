# 个人题库新增导入下线记录（2026-10-14）

生产 Supabase 只读核查：现存个人题库 36 条，归属 5 个账号；按各科个人题 ID 字段识别的练习记录 35 条。最后导入及练习均在 2026-07-31，近 30 天导入和练习均为 0。账号未确认是否包含内部测试账号，不能直接称为 5 个外部用户。

首页内嵌入口没有独立访问埋点：page_views 只记 pathname，切换 `?section=my-bank` 仍记 `/`。因此 `/my-bank` 访问数为 0 不能证明无人打开。上述数字只代表当前保留的数据，不代表已删除数据或失败导入。

用户批准的边界：移除桌面/移动首页入口及引导，`/my-bank` 跳回首页；`POST /api/user-bank` 和 extract、extract-image、verify、render-audio 的 POST 均返回 HTTP 410，统一 `{ok:false, code:"USER_BANK_RETIRED", error:...}`，不解析请求体、不调用 AI/TTS、不写入新增题目。

保留 `GET /api/user-bank`、用户自主 DELETE、各科 practice picker 的「我的」存量题加载、已有音频及练习历史。没有删除数据库记录、Storage 对象或修改 schema；共享管理员抽题解析器保持可用。无需迁移、新环境变量或手动 flag。

这是实施与核查记录，不表示已经部署。发布状态须以最终 QA、推送及生产部署验证为准。
