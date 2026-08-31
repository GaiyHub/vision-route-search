## Why

doupao 系统计划用 AccessibilityService 采集外部 App 的操作轨迹。在投入完整架构前，需要一个场景化录制工具来实测验证：AccessibilityService 能否从外部 App 采到有用的操作轨迹（事件覆盖率 + 元素信息丰富度），同时验证 takeScreenshot() 的可用性。本工具以"分析场景"为组织单位，支持用户创建场景、通过悬浮窗控制录制、录制后回看轨迹，为后续架构决策提供实测依据。

## What Changes

- 新建 Android App（Kotlin），支持创建分析场景（名称 + 描述）
- 场景创建后进入录制模式：隐藏主页面，生成半透明悬浮窗
- 悬浮窗提供开始/停止录制开关；点击开始后才真正启动 AccessibilityService 采集
- 采集期间持续记录操作轨迹（事件 + 元素信息 + 截图），写入目标目录
- 用户点击停止后返回主页面，展示该场景的录制记录
- 用户可选择任意录制记录查看轨迹详情，开始分析
- 不包含：多模态模型调用、引导逻辑、轨迹数据模型的最终格式、云端通信

## Capabilities

### New Capabilities

- `scenario-management`: 分析场景管理。用户可新建场景（输入名称和描述）、查看场景列表。每个场景是录制记录的容器。
- `floating-recorder`: 悬浮录制窗。场景创建后点击"开始录制"隐藏主页面并显示半透明悬浮窗，悬浮窗上有开始/停止录制开关，控制 AccessibilityService 采集的启停。
- `event-capture`: AccessibilityService 事件采集。订阅关键事件类型，提取元素元数据，录制期间持续记录操作轨迹并写入目标目录（含截图）。
- `trajectory-review`: 轨迹回看。录制停止后主页面展示录制记录列表，用户可选择任意记录查看轨迹详情（事件序列 + 元素信息）。

### Modified Capabilities

（无 -- 全新项目，无已有 spec）

## Impact

- 新建 Android 项目（Kotlin + Gradle），minSdk 31
- 依赖：仅 AndroidX 基础库，无第三方依赖
- 权限：BIND_ACCESSIBILITY_SERVICE（无障碍服务）、SYSTEM_ALERT_WINDOW（悬浮窗）、外部存储写入
- 产出物：可 sideload 的 APK + 录制的轨迹文件 + 测试矩阵结果
- 不影响任何现有代码（全新仓库）
