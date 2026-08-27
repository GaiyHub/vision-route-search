## ADDED Requirements

### Requirement: GUI 子 Agent 由默认关闭的运行时开关控制
系统 SHALL 提供持久化的 `guiSubagentEnabled` 开关。对于新安装和已有安装，在用户未明确启用实验能力时，其默认值 SHALL 为 false。

#### Scenario: 已有安装升级
- **WHEN** 没有保存过 GUI 子 Agent 设置的已有安装加载新版本
- **THEN** 委派能力保持关闭，并继续使用当前直接 GUI 工具链

#### Scenario: 用户启用实验能力
- **WHEN** 用户打开 GUI 子 Agent 开关
- **THEN** 后续主 Agent 任务可以注册委派工具，且不得替换现有直接 GUI 工具

### Requirement: 关闭状态形成硬短路
当开关关闭时，系统 MUST NOT 注册或描述 `delegate_ui_task`、实例化 GUI Provider 或子 Agent、读取 GUI API 凭证、获取设备租约或发起 GUI 模型网络请求。

#### Scenario: 任务在关闭状态下启动
- **WHEN** 主 Agent 任务创建时 `guiSubagentEnabled` 为 false
- **THEN** 其工具集合和 GUI 执行行为与当前直接工具链等价，且不包含委派工具

#### Scenario: 检查关闭链路
- **WHEN** 诊断程序检测在功能关闭状态下启动的任务
- **THEN** GUI 子 Agent 客户端构造次数和请求次数都为零

### Requirement: 运行时总开关安全停止活动委派
委派 handler SHALL 在初始化前及每个 GUI 动作前重新检查开关。在活动委派期间关闭开关 SHALL 取消后续子 Agent 工作，并把控制权交还给正在等待的主 Agent。

#### Scenario: 第一个动作前关闭开关
- **WHEN** 用户在工具已被选择、但尚未执行任何 GUI 动作时关闭开关
- **THEN** 子 Agent 不执行动作，并返回 `GUI_SUBAGENT_DISABLED` 和 `fallbackAllowed: true`

#### Scenario: 产生副作用后关闭开关
- **WHEN** 用户在一个 GUI 动作已被尝试后关闭开关
- **THEN** 系统不再启动后续动作，结果标明 `sideEffectsStarted: true`，并要求直接工具链在继续前获取最新观察

### Requirement: 失败时安全降级到当前链路且不重复执行
启用委派时，系统 SHALL 始终保留现有直接 GUI 工具。动作前发生的可用性故障 SHALL 返回允许主 Agent 使用这些工具继续执行的可恢复结果；动作后的故障 MUST NOT 自动重新启动或重放委派任务。

#### Scenario: Provider 预检失败
- **WHEN** 配置、鉴权、连接或模型可用性在任何 GUI 动作前失败
- **THEN** 主 Agent 收到稳定错误和 `fallbackAllowed: true`，并可使用现有直接 GUI 工具继续执行

#### Scenario: 动作执行后失败
- **WHEN** 已尝试动作后发生超时、解析错误或 Provider 故障
- **THEN** 主 Agent 收到 `fallbackAllowed: false`，且必须获取最新观察后才能决定如何恢复

### Requirement: 灰度遥测不得包含隐私
系统 SHALL 记录是否提供、选择、完成、取消、超时或降级 GUI 委派，以及耗时、步数和稳定错误码。灰度遥测 MUST NOT 记录 API Key、原始截图、输入文字、委派任务正文或模型隐藏推理。

#### Scenario: 委派执行结束
- **WHEN** GUI 子 Agent 调用进入任意终止状态
- **THEN** 系统只发送一个终止灰度事件，其中包含结果、耗时、步数、副作用标记和降级资格

#### Scenario: 功能处于关闭状态
- **WHEN** 普通任务通过关闭状态的硬短路链路运行
- **THEN** 诊断数据能够区分关闭状态实验组，且不记录用户内容或屏幕内容
