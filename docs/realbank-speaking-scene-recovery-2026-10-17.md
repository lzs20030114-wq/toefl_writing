# 真题口语复述配图恢复审计（2026-10-17）

本次只补配图及可重放修复账本，不改题文、句子 ID、题序、音频或答题 UI。新增 85 条逐句图绑定：75 条跨源已核对映射 + 10 条原图绑定；逐句帧从 175 增至 260，底图从 16 增至 17。尚有明确缺口，不能称为全库补齐。未推送，未发布。

## 最终覆盖口径

以 data/realBank/speaking/repeat.json 的全部 50 组、464 句为分母。多场景合订条目仍按一个组计，不能把组数理解成独立的七句考试场景数。

| 指标 | 数量 |
| --- | ---: |
| 逐句图绑定 | 260/464（56.0%） |
| 有底图或至少一个逐句帧的组 | 39/50（78.0%） |
| 具有底图的组 | 17/50 |
| 按真实 pickSceneFrame 逻辑可显示任一图的句子 | 279/464（60.1%） |
| 完全无图的组 | 11/50 |
| 无可显示图的句子 | 185/464 |
| 无逐句图绑定、但由底图兜底的句子 | 19 |

“逐句图绑定”不等于“逐句高亮”：rp0729 的 s15–s21 共用一张无高亮旅行社原图，7 条均标记 unhighlighted_scene_shared_by_sentences。121a 的恢复图为无高亮场景图；228 的两帧为对应句的高亮图。其余旧帧没有 frame_kind 标注，不能单凭帧数宣称全是独立高亮。

可显示任一图的句子从 199/464 增至 279/464，净增 80 句；新增的 85 条逐句图绑定里，有 5 句原本已有底图兜底，因此不能把 85 全算作新增可显示句。

## 来源与安全约束

- 跨源映射逐条固定目标/供体 item ID、sentence ID、原文与供体帧元数据，重放时不做模糊匹配。现有目标帧保持原样。
- 4 个本地 WebP 共 130,484 bytes，按内容 SHA-1 命名；CLI 在任何写入前核对字节哈希、实际 WebP 格式及宽高。资源见 public/real-bank/speaking/recovered/，哈希：25935c65944d0805b19a70741c993139d533f9cb、2e6b0b80365158f20b085065f3a3b99fb7264fbe、bd9509e1bb6f3fef674d8cb43ee184d7cd9b0947、15b697400b9003afc84a30da6f532e667e049185。
- 所有验证成功后写同目录唯一临时文件，以 rename 替换成品；异常清理临时文件。原子替换避免直接覆盖导致半个 JSON，未额外声称断电 fsync 持久性。
- 既有 carrySceneImages 在同 item ID、句子文本序列一致时保留本地与远程图；句子 ID 不存在的帧不沿用。相对地址通过 materialImageSrc 保持原样，进入现成 AssetPreloadGate。
- 不给多于 7 句的混合场景条目设置整组底图，避免跨场景错误兜底。此次没有改生产 UI。

## 尚未补齐的清单

下表逐句缺口按实际 sentence ID 列出；sN 只表示 ID 后缀，不推定原卷题号。表内“无图句”已扣除底图兜底。无逐句帧共 204 句，其中 19 句仍可显示底图、185 句没有可显示图。

| item ID | 已绑定帧/句数 | 底图 | 无图句 | 缺逐句帧的 ID 后缀 |
| --- | ---: | --- | ---: | --- |
| real_repeat_128a_1 | 5/7 | 无 | 2 | s4, s7 |
| real_repeat_21b_1 | 0/7 | 有 | 0 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_32b_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_518_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0610_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0620_1 | 0/7 | 有 | 0 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0622_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0629_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0708_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0713_1 | 5/7 | 无 | 2 | s4, s7 |
| real_repeat_rf0716_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0808_1 | 0/7 | 无 | 7 | s1, s2, s3, s4, s5, s6, s7 |
| real_repeat_rf0826_1 | 0/5 | 有 | 0 | s1, s2, s3, s4, s5 |
| real_repeat_rp0704_1 | 7/28 | 无 | 21 | s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28, s29, s30, s31, s32, s33, s34, s35 |
| real_repeat_rp0705_1 | 2/16 | 无 | 14 | s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28 |
| real_repeat_rp0711_1 | 7/28 | 无 | 21 | s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s22, s23, s24, s25, s26, s27, s28 |
| real_repeat_rp0718_1 | 15/31 | 无 | 16 | s2, s22, s23, s24, s25, s26, s27, s28, s31, s36, s37, s38, s39, s40, s41, s42 |
| real_repeat_rp0719_1 | 7/22 | 无 | 15 | s1, s2, s3, s4, s5, s6, s7, s15, s16, s17, s18, s19, s20, s21, s23 |
| real_repeat_rp0725_1 | 0/21 | 无 | 21 | s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21 |
| real_repeat_rp0819_1 | 0/8 | 无 | 8 | s8, s9, s10, s11, s12, s13, s14, s16 |
| real_repeat_rp0822_1 | 13/14 | 无 | 1 | s19 |
| real_repeat_rp0830_1 | 0/8 | 无 | 8 | s20, s22, s23, s24, s25, s26, s27, s28 |

全库扫描与来源依据：.codex-tmp/realbank/repeat-scenes/manifest.json；.codex-tmp/realbank/scene-recovery/recovery-manifest.json；rp-source-manifest.json；rp-recovery-manifest.json。前者是旧提取清单，后者是本轮原卷复核记录，不把“未提取到”解释成“原卷一定没有”。

已确认的源料缺陷：128a 的 Q4/Q7 截图裁边；32b 各句原截图裁掉场景底部；518 各句截图工具栏遮挡场景。这些不补画、不臆造。rf0713 尚缺的 s4/s7 不能因别卷有相似话题便直接绑定。rp 合订条目的已核对局部场景只绑定对应句，不拿一张图覆盖整条。其余缺口保留待来源核对状态；当前账本没有足够可用证据，不声称已经证明其原卷无图。

## 验证与交付状态

- 原有 191 个唯一远程 URL 经主线程外沙盒 HEAD 检查全部 200；共享引用增加不等于新增远程资源。该检查证明检查时可达，不能保证今后服务状态。
- 最终脚本 dry：added_frames=0、added_bases=0、unchanged_repairs=85、total_frames=260。重放幂等，既有 175 帧、16 底图及所有非图字段与原版本保持一致。
- 本审计独立运行 3 套相关 Jest：49/49 通过（scene-repairs、repeat-scene-image.component、scene-image-carry）。主线程最终运行 4 套共 52 项测试全部通过，二者测试选择范围不同，不相加。
- 主线程 IAB 挂载真实组件验证：121a 的真实 RepeatTask 引入屏配图与 390px 窄屏；rp0729 s1 课程平台 → s8 自行车 → s15 旅行社图片均成功解码；228 s2 新恢复高亮图显示 945×1125、Afternoon 高亮。截图 .codex-tmp/realbank/scene-recovery/browser-weather-recovered.png。
- 临时 app/zz-scene-probe/page.js 已在浏览器验证结束后删除，44798 开发服务已停止。没有改 BACKLOG，没有 git 提交、推送或部署。
