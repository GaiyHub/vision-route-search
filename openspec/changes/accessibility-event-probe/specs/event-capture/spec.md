## ADDED Requirements

### Requirement: 服务订阅全部关键无障碍事件类型
AccessibilityService SHALL 订阅以下事件类型：typeViewClicked、typeViewLongClicked、typeViewScrolled、typeViewTextChanged、typeViewSelected、typeViewFocused、typeWindowStateChanged、typeWindowContentChanged。服务 SHALL NOT 按包名过滤（packageNames 留空 = 所有 App）。

#### Scenario: 从外部 App 收到点击事件
- **WHEN** 用户在任意外部 App 中点击一个可点击元素
- **THEN** 服务收到 TYPE_VIEW_CLICKED 事件，包含来源 App 的包名

#### Scenario: 收到文本输入事件
- **WHEN** 用户在任意外部 App 的输入框中输入文字
- **THEN** 服务收到 TYPE_VIEW_TEXT_CHANGED 事件

#### Scenario: 检测到页面切换
- **WHEN** 用户导航到新页面或弹出新对话框
- **THEN** 服务收到 TYPE_WINDOW_STATE_CHANGED 事件

### Requirement: 服务从事件源提取元素元数据
对每条收到的事件，服务 SHALL 尝试从 event.getSource() 提取以下字段：text、contentDescription、className、viewIdResourceName、boundsInScreen、isClickable。无论 source 是否可用，服务 SHALL 记录事件时间戳（eventTime）、事件类型和来源包名。

#### Scenario: 元素信息可用
- **WHEN** 收到事件且 getSource() 返回非 null 的 AccessibilityNodeInfo
- **THEN** 日志条目包含 text、contentDescription、className、viewIdResourceName、bounds、isClickable

#### Scenario: 元素信息不可用
- **WHEN** 收到事件但 getSource() 返回 null
- **THEN** 日志条目标记 sourceNull=true，但仍包含事件类型、包名和时间戳

### Requirement: 开启 flagReportViewIds
服务配置 SHALL 设置 flagReportViewIds，使 getViewIdResourceName() 返回源元素的资源 ID。

#### Scenario: 捕获资源 ID
- **WHEN** 被点击的元素定义了资源 ID
- **THEN** 日志条目的 viewIdResourceName 字段包含完整资源名（如 "com.example:id/btn_search"）

### Requirement: 采集的事件写入目标目录
录制期间，所有事件条目 SHALL 以 JSONL 格式（每行一个 JSON 对象）实时写入目标目录中的 events.jsonl 文件。目标目录按场景和录制 ID 组织。

#### Scenario: 事件实时写入文件
- **WHEN** 采集正在进行且收到一条事件
- **THEN** 该事件被追加写入 <存储>/scenarios/<scenario_id>/recordings/<recording_id>/events.jsonl

#### Scenario: 录制停止后文件完整
- **WHEN** 用户停止录制
- **THEN** events.jsonl 文件包含本次录制的全部事件，按时间顺序排列

### Requirement: 页面切换时自动截图
当收到 TYPE_WINDOW_STATE_CHANGED 事件时，服务 SHALL 调用 takeScreenshot() 截取当前屏幕，保存为 PNG 文件到录制的 screenshots 子目录。截图文件名 SHALL 包含序号和时间戳。

#### Scenario: 页面切换触发截图
- **WHEN** 采集期间收到 TYPE_WINDOW_STATE_CHANGED 事件
- **THEN** takeScreenshot() 被调用，截图保存为 <recording_id>/screenshots/NNN_<timestamp>.png

#### Scenario: 截图失败不中断录制
- **WHEN** takeScreenshot() 返回错误
- **THEN** 记录截图失败到事件日志，录制继续不受影响
