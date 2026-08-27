## ADDED Requirements

### Requirement: 主 Agent 可同步委派有界 GUI 任务
当 GUI 子 Agent 委派能力可用时，系统 SHALL 暴露一个 `delegate_ui_task` 工具，接收任务描述、可选目标应用和有界步数限制。主 Agent SHALL 在再次进行模型决策前等待该工具返回结果。

#### Scenario: 同步委派成功
- **WHEN** 主 Agent 调用 `delegate_ui_task`，且 GUI 子 Agent 完成了请求的界面操作
- **THEN** 子 Agent 返回前不得发生新的主 Agent 决策或工具派发，并且主 Agent 下一轮收到结构化完成结果

#### Scenario: 达到步数上限
- **WHEN** GUI 子 Agent 在配置的最大步数内未完成任务
- **THEN** 子 Agent 停止执行动作，并返回包含已执行步数和最后安全状态的有界失败结果

### Requirement: GUI 子 Agent 具有隔离的模型状态和受限权限
GUI 子 Agent SHALL 使用独立配置的视觉模型、系统提示词、消息历史和步数计数器。它 MUST 只获得完成委派任务所需的截图观察和获准 GUI 动作能力。

#### Scenario: 子 Agent 开始任务
- **WHEN** 一个 GUI 委派任务开始执行
- **THEN** 子 Agent 获得委派意图和当前截图，但不得获得主 Agent 对话历史、Skills、Shell 工具、浏览器工具、笔记或完成控制能力

#### Scenario: 模型提出不支持的动作
- **WHEN** GUI 模型响应无法解析成白名单内的 GUI 动作或终止结果
- **THEN** 系统不执行任何动作，并返回结构化协议错误

### Requirement: GUI 动作通过现有设备能力执行
GUI 子 Agent SHALL 通过由现有截图与 Android 无障碍控制能力支撑的窄接口动作执行器完成操作。委派期间，系统 MUST 阻止多个执行方同时操作同一前台设备。

#### Scenario: 设备租约可用
- **WHEN** 委派任务启动时没有其他 GUI 执行方占用前台设备
- **THEN** 子 Agent 在其生命周期内获取设备租约，并在成功、失败、超时或取消时释放租约

#### Scenario: 设备租约繁忙
- **WHEN** 委派任务启动时已有其他执行方占用前台设备
- **THEN** 该任务不得执行 GUI 动作，并返回稳定的设备繁忙错误

### Requirement: 委派执行过程可观察且可取消
系统 SHALL 在同步工具调用期间发布不含隐私的进度，并 SHALL 将主任务取消信号传播到活动 GUI 子 Agent、待处理模型请求、等待和动作执行器。

#### Scenario: 子 Agent 推进一个步骤
- **WHEN** 子 Agent 完成一次观察或执行步骤
- **THEN** host 进度界面更新步数和非敏感状态，且不得把子 Agent 内部推理加入主 Agent 历史

#### Scenario: 用户停止主任务
- **WHEN** 用户在 GUI 委派期间停止任务
- **THEN** 活动子 Agent 被取消，在下一个动作边界前停止，释放设备租约，并通过标准工具结果链路返回或传播取消状态

### Requirement: 委派返回结构化且安全的结果
委派工具 SHALL 通过标准 ToolResult 协议返回结果。成功数据 SHALL 包含终止状态、摘要和已执行步数；失败结果 SHALL 使用稳定错误码，并包含副作用和降级元数据，同时不得暴露 API 凭证、base64 截图或模型隐藏推理。

#### Scenario: 委派任务完成
- **WHEN** GUI 模型在完成任务后输出有效终止结果
- **THEN** 主 Agent 收到 `status: completed`、简洁摘要、已执行步数和任务明确要求抽取的数据

#### Scenario: 尝试动作后发生失败
- **WHEN** 子 Agent 在尝试一个或多个改变界面的动作后失败
- **THEN** 结果标明 `sideEffectsStarted: true` 和 `fallbackAllowed: false`，包含最后安全观察引用，且不得自动重放原任务

### Requirement: 风险确认机制保持权威
GUI 子 Agent MUST NOT 绕过现有的敏感或不可逆动作确认策略。确认被拒绝或超时后，系统 SHALL 阻止受保护动作执行。

#### Scenario: 敏感动作需要确认
- **WHEN** GUI 子 Agent 提出支付、提交、删除或授予权限等受保护动作
- **THEN** 执行暂停在确认边界，只有通过现有确认机制获得批准后才能继续

#### Scenario: 确认被拒绝
- **WHEN** 用户拒绝受保护动作，或未在期限前批准
- **THEN** 系统不执行该动作，子 Agent 向主 Agent 返回已阻止或已取消结果

