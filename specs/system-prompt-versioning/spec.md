# 系统提示词版本化

## 目标

将系统提示词从“当前版本 + 单个 previous 快照”升级为可持续追加的版本机制。历史版本集中保存在独立文件中，能够按版本号读取、审计和回滚，同时不改变生产环境实际发送给模型的稳定提示词文本。

## 设计

- 使用 TypeScript 保存版本记录，字段包含 `version`、`createdAt`、`changeSummary` 和完整 `prompt`。
- 版本号使用递增整数，历史记录按版本号升序排列且不可重复。
- `agentSystemPrompt.ts` 只维护当前版本，并统一导出当前版本号、历史列表和按版本查询接口。
- 每次任务根 Trace 写入 `systemPromptVersion`，用于关联评测结果与提示词版本。
- 删除仅能保存一个快照的 `previousAgentSystemPrompt.ts`。

## 验收标准

- 已知历史提示词完整进入独立版本文件。
- 当前版本和所有历史版本均可通过版本号查询。
- 新任务 Trace 包含当前 `systemPromptVersion`。
- 当前版本唯一，历史版本号唯一且严格递增。
- 生产系统提示词内容保持为当前优化版本，不影响 Prefix Cache。
- 提示词版本测试与 TypeScript 类型检查通过。

## 验证命令

- `npm test -- --runInBand --silent src/agent/__tests__/agentSystemPromptVersions.test.ts`
- `npm run typecheck`
