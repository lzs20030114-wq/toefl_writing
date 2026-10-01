# 单词本语境释义契约

一个词仍只有一张卡；阅读及听力 FSRS 状态、已复习次数和调度公式保持原样。用户明确采用后，`def` 是最新首选释义，`definitionLocked` 防止自动词典补全覆盖；`defFull` 保存原词典备份，`baseDef` 保存采用前通用释义。

`contextSenses` 按实际英文原句精确绑定 `{sentence, def, updatedAt}`，仅保留主句及最多三句额外语境。复习以本轮 `activeSentence` 或听力 `listeningContext.text` 查绑定释义；另一原句使用通用备份，不能借用其他句子的特殊义。裸词卡使用最新 `def`。若没有可靠通用释义则留空，不错配。

采用当前句会将它升为主句；原主句优先留在额外池，其余保留最近可容纳的句子。容量不足时 UI 在采用前说明“采用后以这句复习，其他语境保留最近3句”；移出句子的释义同时剪枝，不留孤立映射。

`definitionUpdatedAt` 单独追踪明确释义选择，复习评分更新 `updatedAt` 不得覆盖它。每句释义以自身 `updatedAt` 合并；无语境的全局词典反选清空绑定并写 `contextSenseResetAt` 水位，跨设备旧绑定不能复活。有语境绑定的卡在另一原句点选词典义项，也只更新当前句并将其升为主句，其余绑定保留。采用新听力原句时优先使用这次有效的音频语境；阅读采用保留已存听力原句和进度。

`adoptContextSense(entry, definition, sentence, now, expectedAccount)` 同步返回新卡或更新卡；账户变化返回 null。空释义、仅省略号、超过300字释义、超过400字原句或整卡超过8KB抛中文错误，验证完成前不写入。复用现有本地优先持久化和 JSONB 同步，无新迁移、flag或环境变量。
