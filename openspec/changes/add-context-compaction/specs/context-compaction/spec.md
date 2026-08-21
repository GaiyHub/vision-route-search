## ADDED Requirements

### Requirement: 单类内聚上下文管理
系统 MUST 将固定规则卸载、Token 估算、摘要、检查点和有效历史选择内聚到 `ContextCompressionManager`，AgentLoop 只通过一个请求前入口使用该能力。

#### Scenario: 构建主模型请求
- **WHEN** AgentLoop 准备下一次主推理
- **THEN** AgentLoop 将完整安全轮次一次性交给上下文管理器，并使用其单次返回结果构建请求

### Requirement: L2 单遍固定规则卸载
系统 MUST 在启用新策略时于每次请求前按工具类型、历史位置和固定大小规则执行一次工具结果卸载，不得使用 Token 触发阈值或清理目标。

#### Scenario: 历史包含旧观察结果
- **WHEN** 截图、页面结构或浏览器正文位于最近 4 个完整轮次之前
- **THEN** 系统在单次遍历中将符合规则的结果替换为有界占位数据，同时保留工具调用与结果配对

#### Scenario: 同一请求完成 L2
- **WHEN** 单遍候选处理结束
- **THEN** 系统不得因仍超过某个目标值而重新选择候选或再次进入 L2

#### Scenario: 保留事实源
- **WHEN** 工具结果在有效上下文中被卸载
- **THEN** 原始 AgentEvent、用户展示和任务日志不得被修改或删除

### Requirement: 单一摘要阈值
系统 MUST 仅使用一个基于有效模型窗口的阈值决定是否调用 LLM 摘要，L2 不得共享或新增独立阈值。

#### Scenario: L2 后低于阈值
- **WHEN** 单遍卸载后的最终请求估算低于阈值
- **THEN** 系统直接调用主模型，不产生摘要请求

#### Scenario: L2 后达到阈值
- **WHEN** 单遍卸载后的最终请求估算达到阈值
- **THEN** 系统在该主决策轮次最多调用一次摘要模型

### Requirement: 自然语言摘要
系统 MUST 要求摘要模型只输出自然语言摘要正文，并将校验后的文本直接保存为 `ContextCheckpoint.summary`。

#### Scenario: 摘要成功
- **WHEN** 模型返回非空、未超长且不含工具调用的自然语言结果
- **THEN** 系统仅执行 trim 和边界校验后原子提交检查点，不进行 JSON 解析或语义重写

#### Scenario: 手机 UI 历史被摘要
- **WHEN** 历史包含 nodeId、ref、selector、坐标或旧截图定位
- **THEN** 摘要提示词要求只保留稳定语义状态，不把临时定位信息表达为下一轮可复用依据

#### Scenario: 历史包含高风险确认
- **WHEN** 压缩范围内存在 confirm_action 结果
- **THEN** 摘要不得把历史确认表达为后续持续授权

### Requirement: 摘要作为 user 级历史注入
系统 MUST 在下一轮用 `<context_summary>` 包装 `ContextCheckpoint.summary`，并作为动态 user 级历史发送，不修改静态 system prompt。

#### Scenario: 构建压缩后请求
- **WHEN** 当前存在有效检查点
- **THEN** 请求包含 `<context_summary>\n{summary}\n</context_summary>`、未进入摘要的最近 4 个完整模型轮次及检查点后新产生的原始轮次

### Requirement: 最近对话原样保留
系统 MUST 只摘要较早历史前缀，并将最近 4 个完整模型轮次排除在摘要输入之外，以降低最新指令、工具配对和当前状态被摘要遗漏的风险。

#### Scenario: 首次生成摘要
- **WHEN** 会话首次达到摘要阈值
- **THEN** 摘要只覆盖最近 4 轮之前的连续历史前缀，最近 4 轮继续以原始角色和工具协议发送

#### Scenario: 摘要后产生新历史
- **WHEN** 检查点之后又发生新的工具调用或用户消息
- **THEN** 新内容作为正常增量上下文参与推理；再次达到阈值时，仅把新的较早前缀并入摘要

### Requirement: 连续用户对话
系统 MUST 将运行中的用户补充、回答和更正作为普通 user 消息处理，不得使用“用户修正”“初始目标不变”等特殊提示块或优先级语义。

#### Scenario: 任务运行中收到用户输入
- **WHEN** 用户在 AgentLoop 运行期间发送非停止文本
- **THEN** 文本按原文进入下一决策点的 user 消息，并参与正常历史与摘要管理

### Requirement: Todo 独立保留
系统 MUST 将 Todo 视为检查点之外的实时状态；无论是否存在摘要，只要 Todo 非空，就在当前决策点独立注入最新 Todo，不依赖摘要恢复其状态。

#### Scenario: 摘要后 Todo 更新
- **WHEN** 已存在摘要且 Todo 内容发生变化
- **THEN** 下一次主推理收到最新 Todo，且无需重新生成摘要

### Requirement: 禁止同轮循环压缩
系统 MUST 保证每个主决策轮次最多执行一次 L2 和一次摘要调用。

#### Scenario: 摘要后仍超限
- **WHEN** 摘要成功后重新估算仍超过安全输入预算
- **THEN** 系统返回明确错误，不得再次执行 L2、再次摘要或递归拆分

### Requirement: 摘要失败处理
系统 MUST 仅对临时错误执行有界重试，并保证失败不破坏既有检查点。

#### Scenario: 临时错误
- **WHEN** 摘要请求遇到网络超时、429 或可恢复 5xx
- **THEN** 系统最多重试 2 次

#### Scenario: 确定性错误
- **WHEN** 摘要遇到鉴权、配置、协议、空响应或上下文错误
- **THEN** 系统停止摘要并向上返回明确错误，不执行额外清理

#### Scenario: 用户停止任务
- **WHEN** 摘要完成前任务被停止
- **THEN** 系统不得提交新检查点

### Requirement: 配置回滚到旧滑动窗口
系统 MUST 默认启用新上下文压缩，并保留配置开关回滚到原 `maxHistoryItems` 滑动窗口。

#### Scenario: 新安装或升级
- **WHEN** 设置中没有显式的上下文压缩开关
- **THEN** 系统默认 `contextCompressionEnabled=true`，同时保留原 `maxHistoryItems` 数值

#### Scenario: 用户关闭新策略
- **WHEN** `contextCompressionEnabled=false`
- **THEN** AgentLoop 不执行 L2 或摘要，按原逻辑仅保留最近 `maxHistoryItems` 个轮次并显示省略提示

#### Scenario: 用户重新开启新策略
- **WHEN** `contextCompressionEnabled=true`
- **THEN** 后续新建 AgentLoop 使用新策略，不需要恢复任何被删除的数据

### Requirement: Prefix Cache 稳定
系统 MUST 保持静态系统提示词不变，并保证没有新增历史或检查点时的压缩视图具备确定性。

#### Scenario: 连续构建同一历史
- **WHEN** 原始历史和检查点没有变化
- **THEN** L2 占位内容、摘要注入和稳定缓存边界保持字节一致

### Requirement: 缓存命中率口径
系统 MUST 使用缓存读取 Token 占提示词 Token 的比例展示 Prompt Cache 命中率，不得把输出 Token 纳入分母。

#### Scenario: 展示缓存命中率
- **WHEN** 当前累计 `promptTokens > 0`
- **THEN** 命中率等于 `cachedTokens / promptTokens * 100%`

#### Scenario: 归一不同 Provider 的输入口径
- **WHEN** Provider 将普通输入、缓存读取和缓存写入分别返回
- **THEN** 系统将三者相加作为完整 `promptTokens`，并仅以缓存读取 Token 作为 `cachedTokens`
