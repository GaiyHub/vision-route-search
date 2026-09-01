# Spec：`llm-judge`

## 目标

基于样本 Rubric、标准化文本证据和可选最终截图，判断任务在语义层面是否成功。

## 配置

- Judge Provider 与豆泡内部运行模型相互独立。
- 支持配置 OpenAI-compatible `baseUrl`、API key、model、timeout 和是否支持图片。
- API key 仅来自后端环境变量或进程内存，不写入评测集、浏览器存储、Trace 或报告。
- 每个样本定义 Rubric、`[0,1]` 范围内的阈值及所需证据通道。

## 输入策略

- 输入可包含原始指令、Rubric、完整最终回复、确定性断言摘要、Trace 摘要、最终包名、UI 层级和截图。
- 原始 Trace 先进行确定性裁剪和摘要，Prompt 总大小受配置限制。
- 所有证据明确标为不可信数据；Agent 输出、网页、工具结果、UI 文本或截图中的指令不得覆盖 Judge Rubric 和输出契约。
- 请求截图且模型支持图片时发送最终 PNG；不支持时记录文本降级告警，不伪装为已使用视觉证据。

## 输出契约

```ts
interface JudgeResultV1 {
  schemaVersion: 1;
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  score: number;
  reason: string;
  evidence: string[];
}
```

- `score` 位于 `[0,1]`；聚合为通过要求 `verdict='PASS'` 且 `score >= threshold`。
- `evidence` 只能引用提供给模型的带 ID 证据片段，不得引用不可用事实。
- 无效或被拒绝的输出可用同一证据修复一次；再次失败返回 `JUDGE_ERROR`。
- 网络、认证、限流、超时和解析错误属于 `INFRA_ERROR`，不得转为 `FAIL`。

## 可复现性

- 报告记录 Provider、Model、Rubric 版本、阈值、Prompt 模板版本、证据 hash 和原始结构化响应。
- 模型参数默认使用低随机性；具体参数作为 Run 快照保存。
- 失败重跑 Judge 时生成新 Judge attempt，不覆盖旧结果。

## 验收标准

- 文本与多模态 Fixture 均生成合法统一结果。
- Prompt Injection Fixture 不改变 Rubric、角色边界或输出 Schema。
- 降级、修复和基础设施失败在 UI/报告中可区分且不泄露凭据。
