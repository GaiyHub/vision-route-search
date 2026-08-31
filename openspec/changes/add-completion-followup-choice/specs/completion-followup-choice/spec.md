## ADDED Requirements

### Requirement: Three-way completion decision
The primary task-completion dialog SHALL present 完成, 继续, and 补充信息 as separate choices whenever the model claims the task is complete.

#### Scenario: Confirm completion
- **WHEN** the user selects 完成
- **THEN** the completion gate SHALL settle as complete and the task SHALL end

#### Scenario: Continue immediately
- **WHEN** the user selects 继续
- **THEN** the completion verdict SHALL be treated as rejected and the same task SHALL resume immediately with a continuation correction

#### Scenario: Enter supplemental input
- **WHEN** the user selects 补充信息
- **THEN** the completion verdict SHALL be treated as not yet accepted and the system SHALL show a text-entry phase without resuming the agent

### Requirement: Supplemental information submission
The system SHALL resume the same task from the pending completion gate only after the user submits valid supplemental information.

#### Scenario: Submit valid information
- **WHEN** the user submits non-empty supplemental text within the length limit
- **THEN** the system SHALL inject the attributed user information into a continuation correction and resume the same task

#### Scenario: Reject empty information
- **WHEN** the supplemental text is empty or whitespace-only
- **THEN** the system SHALL keep the gate pending and SHALL NOT resume the agent

#### Scenario: Reject overlong information
- **WHEN** the supplemental text exceeds the configured length limit
- **THEN** the system SHALL show validation feedback, keep the gate pending, and SHALL NOT resume the agent

#### Scenario: Return to choices
- **WHEN** the user leaves the supplemental phase without submitting
- **THEN** the system SHALL return to the three completion choices and SHALL NOT resume the agent

### Requirement: Completion gate lifecycle safety
The completion gate SHALL remain single-settlement and SHALL preserve safe timeout and cancellation behavior across decision phases.

#### Scenario: Timeout while choosing
- **WHEN** the three-choice decision phase receives no answer before its timeout
- **THEN** the existing completion-timeout policy SHALL settle the gate once

#### Scenario: Compose without accidental timeout
- **WHEN** the user is in the supplemental text-entry phase
- **THEN** the decision timeout SHALL be suspended so the task is not marked complete while the user is composing

#### Scenario: Stop during supplemental input
- **WHEN** the task is stopped while supplemental input is pending
- **THEN** the system SHALL clear the pending dialog and release the completion gate without resuming the task

### Requirement: 外部 App 原地文本输入
系统 SHALL 在外部 App 前台时，优先通过可聚焦悬浮弹窗收集完成补充信息和
`ask_user` 回答，而不切换到豆泡主界面。

#### Scenario: 原地提交完成补充信息
- **WHEN** 用户在完成确认弹窗中选择补充信息并提交合法文本
- **THEN** 系统 SHALL 将文本记录为用户消息、恢复不可聚焦悬浮状态，并在当前外部 App 继续同一 AgentLoop

#### Scenario: 原地回答 ask_user
- **WHEN** `ask_user` 在外部 App 前台等待回答且悬浮输入可用
- **THEN** 系统 SHALL 在当前 App 上层展示问题和输入框，并将提交文本同时写入对话历史和工具结果

#### Scenario: 原地输入不可用时降级
- **WHEN** 悬浮窗未显示、权限不可用或输入弹窗展示失败
- **THEN** 系统 SHALL 拉起豆泡主界面的既有输入界面，并在提交后返回先前的外部 App

### Requirement: UI 工具执行时隔离豆泡悬浮窗
系统 SHALL 在执行手机 UI 工具期间，从视觉截图和 Android 无障碍窗口中临时移除豆泡
悬浮窗，并在执行结束后恢复原状态。

#### Scenario: UI 工具正常完成
- **WHEN** 任一 `ui_*`、`open_app` 或 `wait` 工具开始执行
- **THEN** 系统 SHALL 先暂停悬浮窗、再执行工具，并在工具完成后恢复悬浮窗

#### Scenario: UI 工具失败
- **WHEN** UI 工具返回失败、超时或抛出异常
- **THEN** 系统 SHALL 仍恢复悬浮窗，不得使其永久消失或保持不可触摸

#### Scenario: 非 UI 工具执行
- **WHEN** 系统执行 Shell、应用列表、笔记、Todo 或其他非 UI 工具
- **THEN** 系统 SHALL 不因该工具调用暂停悬浮窗

### Requirement: 运行态悬浮窗默认位置与拖动
系统 SHALL 默认在屏幕底部中央显示运行态豆泡悬浮窗，并允许用户自由拖动。

#### Scenario: 首次显示运行态悬浮窗
- **WHEN** Agent 在外部 App 中首次创建运行态悬浮窗
- **THEN** 悬浮窗 SHALL 位于导航栏或手势区域上方的屏幕水平中央

#### Scenario: 用户拖动悬浮窗
- **WHEN** 用户拖动运行态悬浮窗
- **THEN** 悬浮窗 SHALL 跟随手势移动并停留在用户选择的位置，仅限制在屏幕可见范围内

#### Scenario: 显示门控弹窗
- **WHEN** 系统显示完成确认、风险确认或原地文本输入
- **THEN** 门控卡片 SHALL 继续在全屏遮罩内居中，不继承运行态悬浮窗的底部位置
