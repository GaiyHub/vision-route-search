## ADDED Requirements

### Requirement: 点击开始录制按钮进入录制模式
场景创建完成后，场景列表项或详情页 SHALL 提供"开始录制"按钮。点击后 App 主页面隐藏，并显示半透明悬浮窗。

#### Scenario: 进入录制模式
- **WHEN** 用户在某个场景下点击"开始录制"
- **THEN** App 主页面隐藏，屏幕上出现半透明悬浮窗

### Requirement: 悬浮窗显示录制控制开关
悬浮窗 SHALL 包含一个开始/停止录制切换按钮。悬浮窗 SHALL 半透明且不阻挡用户操作下方的目标 App（FLAG_NOT_TOUCH_MODAL + FLAG_NOT_FOCUSABLE）。

#### Scenario: 悬浮窗不阻挡操作
- **WHEN** 录制模式激活、悬浮窗显示时
- **THEN** 用户可正常操作悬浮窗下方的任意 App，触摸事件穿透到目标 App

### Requirement: 点击悬浮窗开始按钮后才启动采集
悬浮窗上的录制开关初始为"开始"状态。只有当用户点击"开始"后，AccessibilityService SHALL 开始采集事件。点击前 SHALL NOT 记录任何事件。

#### Scenario: 启动采集
- **WHEN** 用户在悬浮窗上点击"开始"按钮
- **THEN** AccessibilityService 开始采集事件，悬浮窗按钮切换为"停止"状态

#### Scenario: 未点击开始前不采集
- **WHEN** 录制模式已激活（悬浮窗已显示）但用户尚未点击"开始"
- **THEN** AccessibilityService 不采集任何事件

### Requirement: 点击悬浮窗停止按钮结束录制并返回主页面
用户点击悬浮窗"停止"后，AccessibilityService SHALL 停止采集，悬浮窗消失，App 主页面重新显示。

#### Scenario: 停止录制
- **WHEN** 用户在悬浮窗上点击"停止"按钮
- **THEN** AccessibilityService 停止采集，悬浮窗移除，App 主页面重新显示并展示本次录制记录

### Requirement: 录制中 Service 保持前台运行
录制期间 AccessibilityService SHALL 以前台 Service 运行（startForeground），携带持续通知，防止系统杀死服务导致录制中断。

#### Scenario: 录制中前台通知
- **WHEN** 采集正在进行
- **THEN** 状态栏显示持续通知表明正在录制
