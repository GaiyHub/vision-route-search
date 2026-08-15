## 1. 项目初始化

- [x] 1.1 创建 Android 项目（Kotlin，Empty Activity 模板，minSdk 31）
- [x] 1.2 配置 Gradle（仅 AndroidX 基础库，无第三方依赖）
- [x] 1.3 创建 res/xml/accessibility_service_config.xml（事件类型 + flag + canRetrieveWindowContent + canTakeScreenshots + packageNames 空）
- [x] 1.4 定义存储目录结构（<外部存储>/vision-route-search/scenarios/<scenario_id>/recordings/<recording_id>/）

## 2. AccessibilityService 实现

- [x] 2.1 创建 AccessibilityService 子类，实现 onAccessibilityEvent() 和 onServiceConnected()
- [x] 2.2 在 AndroidManifest.xml 声明 Service，绑定 BIND_ACCESSIBILITY_SERVICE 权限，meta-data 指向 config XML
- [x] 2.3 实现采集状态控制（isCapturing 标志位，悬浮窗通过它控制启停）
- [x] 2.4 实现服务启用状态检测（AccessibilityManager 检查本服务是否已开启）

## 3. 事件提取与文件存储

- [x] 3.1 定义事件日志条目数据类（eventType, packageName, eventTime, text, contentDescription, className, viewIdResourceName, bounds, isClickable, sourceNull）
- [x] 3.2 在 onAccessibilityEvent 中实现事件提取逻辑（调 getSource()，提取各字段，source 为 null 时标记 sourceNull=true）
- [x] 3.3 实现 JSONL 文件写入（事件实时追加写入 events.jsonl，按场景和录制 ID 组织目录）
- [x] 3.4 实现录制开始时创建录制目录、停止时关闭文件流

## 4. 自动截图

- [x] 4.1 在 TYPE_WINDOW_STATE_CHANGED 事件回调中触发 takeScreenshot()
- [x] 4.2 截图结果保存为 PNG 到 screenshots 子目录，文件名含序号和时间戳
- [x] 4.3 截图失败时记录到事件日志，不中断录制
- [x] 4.4 记录截图与事件的关联关系（事件序号 <-> 截图文件名，screenshots/index.jsonl）

## 5. 场景管理

- [x] 5.1 定义场景数据模型（id, name, description, created_at）和持久化（meta.json 文件存储）
- [x] 5.2 实现主页面场景列表 UI（RecyclerView，每项显示名称和描述）
- [x] 5.3 实现"新建场景"入口和表单（名称必填、描述选填、空名称校验）
- [x] 5.4 实现场景列表的加载和刷新（App 启动时从文件系统读取已有场景）

## 6. 悬浮录制窗

- [x] 6.1 实现"开始录制"按钮逻辑（点击后隐藏主页面、创建录制目录、显示悬浮窗）
- [x] 6.2 用 WindowManager 实现半透明悬浮窗（TYPE_APPLICATION_OVERLAY，FLAG_NOT_TOUCH_MODAL + FLAG_NOT_FOCUSABLE）
- [x] 6.3 悬浮窗 UI：开始/停止录制切换按钮
- [x] 6.4 点击"开始"时设置 isCapturing=true 启动 AccessibilityService 采集
- [x] 6.5 点击"停止"时设置 isCapturing=false 停止采集、移除悬浮窗、返回主页面
- [x] 6.6 录制期间 Service 设为前台 Service（startForeground + 持续通知）
- [x] 6.7 申请 SYSTEM_ALERT_WINDOW 权限并引导用户授权

## 7. 轨迹回看

- [x] 7.1 主页面场景详情中展示录制记录列表（录制时间、事件数、截图数）
- [x] 7.2 实现轨迹详情页：按时间顺序展示事件序列（类型、包名、时间戳、元素信息摘要）
- [x] 7.3 实现单条事件展开详情（全部字段含 sourceNull、bounds、isClickable）
- [x] 7.4 实现截图缩略图展示（在 TYPE_WINDOW_STATE_CHANGED 事件处关联显示）
- [x] 7.5 实现截图大图全屏查看
- [x] 7.6 实现"导出"功能（打包 events.jsonl + 截图目录，通过 Share Intent 分享）

## 8. 权限引导

- [x] 8.1 进入录制模式时检测无障碍服务是否已启用，未启用则引导跳转设置
- [x] 8.2 检测 SYSTEM_ALERT_WINDOW 权限，未授权则引导用户开启"显示在其他应用上层"

## 9. 测试与验证

- [ ] 9.1 在系统设置 App 上测试（基线）：录制 3-4 步操作，回看轨迹验证事件覆盖与元素信息
- [ ] 9.2 在微信上测试：录制 3-4 步操作，回看轨迹验证
- [ ] 9.3 在目标 App-A 上测试：录制典型操作，回看轨迹验证
- [ ] 9.4 在目标 App-B（如有 Flutter App）上测试：录制典型操作，回看轨迹验证
- [ ] 9.5 验证截图是否在页面切换时正确触发保存
- [ ] 9.6 验证悬浮窗不阻挡目标 App 操作
- [ ] 9.7 验证录制数据持久化（杀 App 后重新打开仍可回看）
- [ ] 9.8 填写测试矩阵表（App × 事件覆盖率 × 元素信息完整度 × 截图成功率 × 判定）
- [ ] 9.9 根据矩阵结果确定各 App 类别的采集策略

## 实现状态

1–8 的代码已全部实现（2026-08-12），本机无 Android SDK / Gradle / 联网环境，未编译验证；需在 Android Studio 中打开本项目构建 APK 后，再执行第 9 项真机测试。
