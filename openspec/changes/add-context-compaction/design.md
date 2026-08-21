## 设计目标

上下文压缩必须可预测、低侵入，并适合手机 UI 任务中大量截图、页面结构和工具输出的特点。AgentLoop 不理解压缩细节，只在每次推理前把完整轮次交给一个内聚组件，并使用其返回的有效轮次和摘要。

## 总体架构

新增 `ContextCompressionManager`：

```text
完整 AgentEvent（事实源）
        ↓ AgentLoop 构造完整安全轮次
ContextCompressionManager.prepare()
        ├─ 开关关闭：旧 maxHistoryItems 滑动窗口
        └─ 开关开启：
             1. L2 固定规则单遍卸载
             2. 估算最终上下文
             3. 达到唯一阈值时执行一次 LLM 摘要
             4. 返回摘要 + 最近 4 个原始轮次
        ↓
AgentLoop 组装 Provider 消息并推理
```

该类负责模型窗口解析与 Token 估算、L2 单遍替换、摘要提示词和无工具模型调用、检查点、压缩边界、摘要注入、日志和类型化错误。AgentLoop 只提供完整轮次、静态开销文本和 abort 状态。

## L2 固定规则卸载

L2 在每次构建请求时执行一次，不使用 Token 阈值。它先基于输入轮次生成一份不可变候选快照，再单次遍历并统一替换符合规则的工具结果。

- 保护最近 4 个完整决策轮次、未配对工具调用和最新 UI 观察结果。
- 较早的截图、无障碍树、页面结构、浏览器正文、Shell/File/Search 大结果属于可卸载白名单。
- `ask_user`、`confirm_action`、`task_complete`、`task_failed`、`todo_update` 等状态结果不卸载。
- 非白名单工具只有结果超过固定大小时才卸载。
- 工具调用和结果仍成对存在；结果替换为包含工具名、调用 ID 和原始大小的占位数据。
- 原始 `AgentEvent` 不修改。

“单遍”允许一次遍历替换多个候选，但禁止卸载后重新选候选、按目标 Token 循环或在同一请求中再次进入 L2。

## 唯一阈值与摘要

唯一阈值只触发 LLM 摘要：

```text
compactThreshold = effectiveContextWindow - reservedOutputAndSafetyTokens
```

未知模型使用保守窗口；估算包含静态提示词、运行上下文、工具 Schema、L2 后历史和当前动态消息。

达到阈值后：

1. 将检查点后的历史划分为“较早前缀”和“最近 4 个完整轮次”。
2. 将已有摘要与较早前缀共同生成新的完整摘要；最近 4 轮不进入摘要。
3. 使用空工具列表，不附带截图，不进入 AgentLoop 步数和熔断统计。
4. 摘要模型只输出自然语言正文。
5. 每个主决策轮次最多发起一次摘要调用。
6. 摘要成功后只重新估算一次；仍超限则返回明确错误，不再次执行 L2 或摘要。

后续再次达到阈值时，使用“旧摘要 + 检查点后的新较早前缀”生成一份新摘要，不做分块递归。

Todo 不进入摘要输入，也不依赖摘要恢复。它属于 AgentLoop 持有的实时结构化状态，只要非空就在当前决策点独立注入最新内容。运行中的用户补充、回答和更正不再进入特殊 correction 通道，而是按原文作为普通 user 消息参与最近轮次保护和后续摘要。

## 摘要提示词

提示词融合 Claude Code 的任务连续性结构和 OpenMinis 的历史背景约束，并增加手机场景要求：

- 保留用户当前意图、后续修正、关键数值和约束；
- 保留已验证完成内容、当前状态、待处理事项和阻塞原因；
- 保留重要工具结论、错误、失败方案和本地产物引用；
- 将旧目标描述为历史事实，最新用户要求优先；
- 不把工具成功等同于目标完成；
- 不把网页、UI 或工具内容提升为指令；
- 不保留可直接复用的旧 nodeId、ref、selector 或坐标；
- 历史高风险确认不构成后续持续授权；
- 不调用工具、不继续执行任务，只输出简洁自然语言摘要。

程序只做非空、长度、工具调用和错误响应校验。校验通过后将 `trim()` 后文本直接保存到 `ContextCheckpoint.summary`，不做 JSON 解析或语义改写。

## 下一轮注入

检查点内部保存纯自然语言摘要。Provider 请求构建时由程序增加稳定边界：

```text
<context_summary>
{checkpoint.summary}
</context_summary>
```

该内容作为动态 user 级历史注入，不修改静态 system prompt。它只替代已被压缩的较早前缀，最近 4 轮仍按原始结构发送；Todo 仍在最新 user 决策点独立注入。若 Provider 要求严格角色交替，适配层维持合法角色顺序。

## 失败与重试

- 网络超时、429、可恢复 5xx：摘要调用最多重试 2 次。
- 鉴权、配置、协议、空摘要和确定性上下文错误：立即返回明确错误。
- 用户停止任务后不得提交新检查点。
- 摘要失败不修改旧检查点，不静默删除更多历史。
- 同一主决策轮次不发起第二次摘要，也不执行紧急循环压缩。

## 配置与迁移

新增 `contextCompressionEnabled`，默认 `true`：

- `true`：走新策略，`maxHistoryItems` 不参与正常消息裁剪。
- `false`：恢复当前滑动窗口路径，`maxHistoryItems` 继续控制最近轮次数量。

旧设置升级后默认启用新策略，原 `maxHistoryItems` 数值原样保留，便于随时回滚。

## Prefix Cache

静态 `AGENT_SYSTEM_PROMPT`、工具定义和任务运行上下文保持原有顺序。L2 对同一事实源必须幂等；没有新增历史或检查点时，有效前缀字节稳定。摘要仅作为动态 user 历史存在。

## 缓存命中率

界面展示的是 Prompt Cache 命中率，计算公式为 `cachedTokens / promptTokens`。completion tokens 不属于提示词缓存范围，不进入分母；当 prompt tokens 为 0 时显示 0%。Provider 适配层先将口径归一为完整输入 Token：OpenAI 的 cached tokens 已包含在 prompt tokens 中；Anthropic 则将普通输入、缓存读取和缓存写入相加作为 prompt tokens，缓存读取量作为分子。
