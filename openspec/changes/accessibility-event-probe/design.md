## Context

doupao 系统计划用 AccessibilityService 采集外部 App 的操作轨迹。AOSP 源码已确认 packageNames=null 时可接收所有 App 事件、takeScreenshot() 可用（API 31+）、getSource() 可提取元素元数据。但不同 App（尤其 Flutter/WebView）无障碍树质量差异大。本设计定义一个场景化录制工具，让用户以"分析场景"为单位录制操作并回看轨迹，实测验证采集能力。

## Goals / Non-Goals

**Goals:**
- 支持用户创建分析场景（名称 + 描述），以场景为单位组织录制
- 通过悬浮窗在任意 App 上方控制录制启停，录制时用户正常操作目标 App
- 持续记录操作轨迹（事件 + 元素信息 + 截图）并写入文件目录
- 录制后可回看轨迹详情，为分析提供依据
- 验证不同 App 的事件覆盖率与元素信息丰富度

**Non-Goals:**
- 不调用多模态模型分析轨迹（"分析"指人工查看，模型分析是后续能力）
- 不实现引导/定位逻辑
- 不定义轨迹的最终数据模型格式（本阶段产出原始记录即可）
- 不做云端通信
- 不处理视频
- 不上架应用商店

## Decisions

### D1: minSdk 31（Android 12）
takeScreenshot() 需要 API 31+。AccessibilityService 本身 API 14+ 可用，但截图是轨迹的重要组成部分，低于 31 的设备无法完整验证。

### D2: 事件类型全覆盖
订阅 typeViewClicked / typeViewLongClicked / typeViewScrolled / typeViewTextChanged / typeViewSelected / typeViewFocused / typeWindowStateChanged / typeWindowContentChanged。宁可多收再过滤，不可漏收导致误判。

### D3: 开启 flagReportViewIds + flagRetrieveInteractiveWindows + flagIncludeNotImportantViews
flagReportViewIds 是拿到资源 ID 的前提；不开启会误判元素信息缺失。

### D4: packageNames 留空（监听所有 App）
实验需要测试多个不同 App，不能锁定包名。

### D5: getSource() 可能为 null，需优雅处理
事件源节点可能因视图回收返回 null。记录 sourceNull 标记，null 发生率本身是有价值的数据点。

### D6: 录制期间自动截图
在 TYPE_WINDOW_STATE_CHANGED（页面切换）事件触发时自动调用 takeScreenshot()，为每个关键状态保存视觉快照。不在每个事件上都截图（避免性能问题和延迟），仅在页面级变化时截图。截图保存为 PNG 文件，与事件日志一同存入录制目录。

### D7: 轨迹存储为文件目录结构
每次录制生成一个目录，内含事件日志（JSONL）和截图文件（PNG）。目录按场景组织：

```
<app外部存储>/doupao/
  └── scenarios/
      └── <scenario_id>/
          ├── meta.json          # 场景名称+描述
          └── recordings/
              └── <recording_id>/
                  ├── events.jsonl   # 事件流（每行一条）
                  └── screenshots/
                      ├── 001_1234567890.png
                      └── 002_1234567895.png
```

不引入数据库，纯文件存储，最小依赖，方便人工查看和分析。

### D8: 悬浮窗用 SYSTEM_ALERT_WINDOW
录制模式下用 WindowManager 添加一个半透明悬浮 View（TYPE_APPLICATION_OVERLAY），上面放置开始/停止录制按钮。悬浮窗不拦截触摸事件（FLAG_NOT_TOUCH_MODAL + FLAG_NOT_FOCUSABLE），用户可正常操作下方的目标 App，同时悬浮窗保持可见。

### D9: 录制状态机
```
[场景已创建] --点击"开始录制"--> [悬浮窗显示，待录制]
      --点击悬浮窗"开始"--> [采集中] 
      --点击悬浮窗"停止"--> [录制完成，返回主页面]
```
"开始录制"（进入录制模式）和"开始采集"（AccessibilityService 实际启动）是两步：先显示悬浮窗让用户切到目标 App，再点悬浮窗上的开始按钮真正采集。这样用户可以先导航到目标 App 的起点再开始录制。

### D10: 纯 Kotlin + AndroidX，无第三方依赖
UI 用 RecyclerView + WindowManager 手写悬浮窗，不用 Compose。

## Risks / Trade-offs

- [悬浮窗被系统杀死] -> 录制中 Service 是前台 Service（startForeground），悬浮窗依赖 Service 存活；如被杀则录制中断，需提示用户
- [SYSTEM_ALERT_WINDOW 权限] -> 用户需手动授权"显示在其他应用上层"；App 引导用户开启
- [Flutter App 事件稀疏] -> 实验要验证的；稀疏结果直接反映在轨迹中，触发截图兜底策略
- [takeScreenshot 延迟影响录制] -> 仅在页面切换时截图，不在每个事件上截图，降低频率
- [getSource() 返回 null] -> 记录 null 率作为数据点
- [用户未开无障碍权限] -> 进入录制模式时检测，引导用户去设置开启
- [存储权限] -> Android 10+ 用 MediaStore 或 App 专属外部存储（无需额外权限）
