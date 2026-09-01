# Spec：`assertion-engine`

## 目标

基于标准化证据执行确定、可复现且无需 LLM 的结果判断。

## 首版断言

- `outcome`：匹配 `CommandExecutionResult.outcome`。
- `finalResponse`：包含、排除文本，或匹配经安全校验的正则表达式。
- `toolCalled`：要求或禁止标准化工具名，并可限制调用次数。
- `toolResult`：指定工具至少一次返回成功或指定错误码。
- `duration`：限制样本总耗时。
- `steps`：限制 Agent 步数。
- `tokens`：限制 prompt、completion、total 或 cached Token。
- `foregroundPackage`：最终前台包名匹配指定值。
- `uiText`：最终 UIAutomator 层级包含、排除文本或匹配正则。
- `blockedInteraction`：要求或禁止指定 `RISK`、`ASK_USER`、`USER_ACTION` 阻塞类型。

## 结果契约

```ts
interface AssertionResultV1 {
  schemaVersion: 1;
  assertionId: string;
  type: string;
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  reason: string;
  evidence: string[];
}
```

- 条件不满足为 `FAIL`；所需证据缺失、损坏或无法安全执行为 `ERROR`。
- `ERROR` 不得猜测为通过或失败，并在最终聚合中与产品失败区分。
- 所有断言均执行，单条失败或错误不得短路后续断言。

## 安全与确定性

- 使用受限正则实现或设置执行预算，防止灾难性回溯。
- 文本匹配默认区分大小写与标准化策略必须写入 Schema，不依赖运行环境 Locale。
- 工具名使用 Trace 标准化后的 canonical name，不匹配 UI 展示名称。
- 相同证据包和相同断言配置必须产生字节等价的结果顺序。

## 验收标准

- 测试覆盖每类断言的通过、失败和证据缺失。
- 现有 OTel 中工具错误、Token Cache 字段和最终 outcome 可正确映射。
- 正则超限返回 `ERROR`，不会阻塞评测进程。
