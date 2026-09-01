# 豆泡 Android App

豆泡是一个基于 React Native、Android AccessibilityService、WebView、BusyBox 与大模型工具调用构建的通用移动端 AI Agent。

模型可以直接回答问题，也可以按需调用联网搜索、Android UI、内置浏览器、Shell、Todo、经验库和用户卡控工具。主 AgentLoop 不默认注入截图或无障碍树，不依赖固定“问答/操作”意图分类器。

完整项目说明见 [../Readme.md](../Readme.md)，面试与项目介绍材料见 [../PROJECT_EXPERIENCE.md](../PROJECT_EXPERIENCE.md)。

## 核心模块

```text
App.tsx
├── app/chat             对话、执行过程、内嵌用户卡控
├── app/history          会话历史
├── app/settings         通用、模型、工具、经验配置
├── src/agent            App/AgentLoop 桥接、提示词、完成确认
├── src/device-agent     AgentLoop、Provider、工具协议、循环熔断
├── src/browser          内置 WebView 浏览器工具
├── src/web-search       Tavily 联网搜索工具
├── src/modelCatalog     云端模型目录、缓存与 Suggest
├── src/shell            shell_execute 工具协议
├── src/store            轻量 Store 与持久化
└── plugins/android      Android 服务、Receiver 与 Shell 运行时
```

## 当前关键设计

- 模型自主选择直接回答、澄清或调用工具。
- `AgentLoop` 不默认读取截图和无障碍树。
- 截图同时返回对应的无障碍树，并在当前 UI 状态有效期间复用。
- 内部使用 Provider 无关的结构化 `tool_call/tool_result` 历史。
- 固定 system、任务级 `<runtime_context>` 和轮次动态状态分层，支持 Prefix Cache。
- 默认使用 `ContextCompressionManager`：单次固定规则卸载旧工具结果，达到单一 Token 阈值后摘要较早历史；保留近 4 轮和最新 UI 观察。
- 智能压缩可在设置中关闭；关闭后保留完整可用上下文，不再回退到旧滑动窗口。最大步骤默认 50、上限 200。
- 超大工具结果会保存到应用私有文件，模型历史仅保留预览和路径；内置 `file_read` 可以按 offset 分页读回完整内容。
- `tap` 采用 nodeId 优先、坐标兜底和页面变化后验验证。
- 普通工具可独立启停、修改显示名称和模型描述，并配置循环熔断阈值；内置 `file_read` 始终启用且不允许用户修改。
- `shell_execute` 使用 BusyBox，并通过 Android Host 命令扩展确定性系统能力。
- 云端模型输入支持关键词 Suggest；每次 App 启动刷新一次 `models.dev` 与 Provider 目录，也允许完全手动输入模型 ID。
- 高风险动作必须经过 `confirm_action`，必要信息通过 `ask_user` 补充。

## 环境要求

- Node.js 18+
- JDK 17
- Android SDK
- Android API 26+
- 本地依赖：`../react-native-accessibility-controller`
- 本地依赖：`../../react-native-executorch/packages/react-native-executorch`

## 开发与验证

```bash
npm install
npm run typecheck
npm test -- --runInBand --forceExit
npm start
```

## 构建与安装

```bash
cd android
NODE_ENV=production ./gradlew :app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

独立装机请使用 Release APK；Debug APK 依赖 Metro。ADB 只用于开发装机和调试，豆泡在手机上的正常运行不依赖 ADB。

## 首次运行权限

- Android 无障碍服务
- 悬浮窗权限
- 通知权限
- MediaProjection（截图时）
- 麦克风权限（语音时）
- MIUI/HyperOS 建议关闭电池优化

## License

MIT。第三方 Shell 运行时来源与许可证见 [assets/shell/NOTICE.md](assets/shell/NOTICE.md)。
